// The three agent jobs. Each runs as a tool loop on Azure OpenAI when the model is available, and
// as a fixed pipeline with templates when it is not, so the app keeps working end to end.
//
//   intake:  a student's interest survey -> Qloo entities and things to keep away from
//   plan:    the shortlist + the class -> per-student Qloo rankings -> bridges -> a choice -> plan
//   debrief: how each student took the book + a teacher note -> profile updates and short notes
//
// The model never invents an entity: every id it saves must have come back from a Qloo call in
// the same run, and every student it names must be in the class. Those checks are in this file.
import { config } from './config.js';
import { runTools, S, modelStatus } from './llm.js';
import * as qloo from './qloo.js';
import { termRecord, isWayIn } from './planner.js';
import { resolveStudent, resolveShortlist, shortlistBooks, classRanks, bridgesFor, signalsOf, seedName, norm, readBookIds, containsName, outsidePicks, baseTitle, bestMatch } from './profiles.js';

export const modelOn = () => config.aiMode === 'azure-openai' && modelStatus().available;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const SEARCH_TYPES = ['tv_show', 'movie', 'artist', 'videogame', 'book', 'person'];
const GENERIC_TAGS = /^(fiction|nonfiction|classics?|childrens?|children's|middle grade|young adult|teen|adult|\d+-\d+|complex|contemporary|hardcover|paperback|audiobook|ebook|novels?|books?|literature)$/i;
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TYPE_WORD = { tv_show: 'show', movie: 'film', artist: 'music', videogame: 'game', book: 'book', person: 'creator' };

function compact(e) {
  return { entity_id: e.entity_id, name: e.name, type: e.type, year: e.year };
}

// ======================= intake =======================

const INTAKE_SYSTEM = `You help an 8th grade English teacher turn one student's interest survey into a taste profile in Qloo.
Steps:
1. Find every specific title or name the student likes: shows, films, singers and bands, games, books, creators. Search Qloo for each with the most likely type (games are videogame, YouTubers are person). If nothing fits, try one other type.
2. Pick the result that is clearly what the student meant. If two results could both be it, leave it for the teacher with a short question.
3. Find things the student does not want (for example "not into scary movies"). Look up a Qloo tag with find_qloo_tags and pick the matching genre tag. Use a short label like "horror".
4. Call save_profile once. Only use entity ids and tag ids that Qloo returned in this run.
Only add what the student wrote about their own taste. A title a family member likes counts only if the student says they like it too. Never search for the student's own name or anyone else's name unless it is a creator they follow.`;

export async function intake(ws, student, text, onEvent = () => {}, { useModel = true } = {}) {
  const seen = new Map();
  const seenTags = new Map();
  const requests = [];
  let saved = null;
  const tools = [
    {
      name: 'search_qloo_entities',
      description: 'Search Qloo entities by name. type is one of tv_show, movie, artist, videogame, book, person.',
      parameters: S.obj({ query: S.str, type: S.oneOf(SEARCH_TYPES) }),
      run: async ({ query, type }) => {
        if (containsName(query, ws.students)) return { error: 'Searches may not contain a person\'s name from the class or a teacher. Search titles only.' };
        const { results, request } = await qloo.search({ query, types: [type], take: 5 });
        requests.push({ ...request, label: `Search "${query}"` });
        onEvent({ kind: 'qloo', request });
        results.forEach((e) => seen.set(e.entity_id, e));
        return { results: results.map(compact) };
      },
    },
    {
      name: 'find_qloo_tags',
      description: 'Search Qloo tags (genres, themes) by keyword, for things the student does not want.',
      parameters: S.obj({ query: S.str }),
      run: async ({ query }) => {
        const { tags, request } = await qloo.findTags({ query, take: 6 });
        requests.push({ ...request, label: `Tags "${query}"` });
        onEvent({ kind: 'qloo', request });
        tags.forEach((t) => seenTags.set(t.id, t));
        return { tags };
      },
    },
    {
      name: 'save_profile',
      description: 'Save the result. favorites: confirmed matches. questions: names that need the teacher to choose. avoid: dislikes with a tag id and a short label.',
      parameters: S.obj({
        favorites: S.arr(S.obj({ student_wrote: S.str, entity_id: S.str })),
        questions: S.arr(S.obj({ student_wrote: S.str, question: S.str, candidate_ids: S.arr(S.str) })),
        avoid: S.arr(S.obj({ label: S.str, tag_id: S.str })),
      }),
      run: async (args) => {
        const bad = [
          ...args.favorites.filter((f) => !seen.has(f.entity_id)).map((f) => f.entity_id),
          ...args.avoid.filter((a) => !seenTags.has(a.tag_id)).map((a) => a.tag_id),
          ...args.questions.flatMap((q) => q.candidate_ids).filter((id) => !seen.has(id)),
        ];
        if (bad.length) return { error: `These ids did not come from Qloo in this run: ${bad.join(', ')}. Use ids from search results.` };
        saved = args;
        return { ok: true };
      },
    },
  ];

  let usage = null;
  if (useModel && modelOn()) {
    try {
      const out = await runTools({
        job: 'intake',
        instructions: INTAKE_SYSTEM,
        input: [{ role: 'user', content: `Student: ${student.first_name}, grade ${ws.klass.grade}.\nSurvey answer:\n${text}` }],
        tools,
        maxSteps: 12,
        onEvent,
      });
      usage = out.usage;
    } catch (e) {
      onEvent({ kind: 'note', text: `The agent stopped (${e.message}). Finishing with title matching.` });
    }
  }
  if (!saved) saved = await intakeWithoutModel(ws, student, text, tools, onEvent, { seen, requests });

  const added = [];
  for (const f of saved.favorites) {
    const e = seen.get(f.entity_id);
    if (student.seeds.some((s) => s.entity_id === e.entity_id)) continue;
    const seed = { name: f.student_wrote, type: e.type, source: 'survey', status: 'resolved', entity_id: e.entity_id, matched_name: e.name, year: e.year };
    student.seeds.push(seed);
    added.push(seed);
  }
  const pending = saved.questions.map((q) => ({ name: q.student_wrote, question: q.question, candidates: q.candidate_ids.map((id) => compact(seen.get(id))) }));
  for (const p of pending) {
    if (!student.seeds.some((s) => s.name === p.name)) student.seeds.push({ name: p.name, type: p.candidates[0]?.type || 'movie', source: 'survey', status: 'needs_review', candidates: p.candidates, question: p.question });
  }
  for (const a of saved.avoid) {
    const t = seenTags.get(a.tag_id);
    if ((student.avoid || []).some((x) => x.tag_id === t.id)) continue;
    (student.avoid ||= []).push({ label: a.label, tag_id: t.id, tag_name: t.name, reason: 'Survey' });
  }
  student.survey = text;
  student.new_student = false;
  student.history.push({ at: new Date().toISOString(), kind: 'intake', text: `Read the survey: ${plural(added.length, 'favorite')} found, ${pending.length} to confirm, ${plural(saved.avoid.length, 'thing')} to keep away from.` });
  return { added, pending, avoid: saved.avoid.map((a) => ({ label: a.label, tag: seenTags.get(a.tag_id)?.name })), requests, usage, mode: usage ? 'agent' : 'rules' };
}

// Without a model: read "Label: title" pairs and titles that look like names, search each one, and
// keep exact matches. Capped at 10 searches; the student's own name and phrases with family words
// are never sent to Qloo.
const FAMILY_WORDS = /\b(mom|mum|mama|dad|papa|mother|father|sister|brother|cousin|cousins|aunt|uncle|grandma|grandpa|grandmother|grandfather|friend|friends|teacher|named?)\b/i;
const STOP = /^(I|I'm|Im|Not|The|A|An|My|And|But|So|Also|Me|We|It|Its|It's)$/;
export function surveyPhrases(text, student, classmates = []) {
  const out = [];
  const people = [student, ...classmates];
  const add = (raw, { single = true } = {}) => {
    for (const part of raw.split(/\s+and\s+/i)) {
      const t = part.trim().replace(/[.,;!?]+$/, '');
      if (t.length < 2 || t.length > 60 || STOP.test(t)) continue;
      const n = norm(t);
      if (!n || containsName(t, people)) continue;
      if (FAMILY_WORDS.test(t)) continue;
      // A lone capitalized word in free text is too often a person's name ("with Marco").
      if (!single && !/\s/.test(t) && !/\d/.test(t)) continue;
      if (!out.some((x) => norm(x) === n)) out.push(t);
    }
  };
  // Structured answers: "Show: Stranger Things · Game: Minecraft"
  for (const m of text.matchAll(/(?:show|movie|film|music|game|book|follows?)\s*:\s*([^·\n|;]+)/gi)) add(m[1]);
  if (out.length) return out.slice(0, 10);
  // Free text: runs of capitalized words, skipping any that follow a family word ("my cousin Marco").
  for (const sentence of text.split(/[.!?\n]+/)) {
    for (const m of sentence.matchAll(/\b[A-Z0-9][\w'’:-]*(?:\s+(?:(?:of|the|and|&|in|vs\.?|a)\s+)?[A-Z0-9][\w'’:-]*)*/g)) {
      const before = sentence.slice(0, m.index).trim().split(/\s+/).slice(-2).join(' ');
      if (FAMILY_WORDS.test(before)) continue;
      // Single words count only right after like / love / play / watch / read ("I play Minecraft").
      add(m[0], { single: /\b(like|likes|love|loves|play|plays|watch|watches|read|reads|into)\b/i.test(before) });
    }
  }
  return out.slice(0, 10);
}

async function intakeWithoutModel(ws, student, text, tools, onEvent, { seen, requests }) {
  const [, findTags, save] = tools;
  const favorites = [];
  const questions = [];
  // One search per phrase across all types, at most ten phrases.
  for (const p of surveyPhrases(text, student, ws.students)) {
    const { results, request } = await qloo.search({ query: p, types: SEARCH_TYPES, take: 8 });
    requests.push({ ...request, label: `Search "${p}"` });
    onEvent({ kind: 'qloo', request });
    results.forEach((e) => seen.set(e.entity_id, e));
    const hit = bestMatch(p, results);
    if (hit && !favorites.some((f) => f.entity_id === hit.entity_id)) favorites.push({ student_wrote: p, entity_id: hit.entity_id });
    else if (!hit) {
      // Close but not exact ("FC 24" -> "EA Sports FC 24"): let the teacher choose.
      const near = results.filter((r) => norm(baseTitle(r.name)).includes(norm(p)) || norm(p).split(' ').every((w) => norm(r.name).includes(w))).slice(0, 3);
      if (near.length) questions.push({ student_wrote: p, question: 'Which one did the student mean?', candidate_ids: near.map((r) => r.entity_id) });
    }
  }
  const avoid = [];
  const m = text.match(/(?:not into|no|hate|hates|don't like|do not like|nothing)\s+(?:gory or\s+)?(scary|horror|gory|sad)\b/i);
  if (m) {
    const q = /scary|gory/i.test(m[1]) ? 'horror' : m[1].toLowerCase();
    const { tags } = await findTags.run({ query: q });
    if (tags?.[0]) avoid.push({ label: q, tag_id: tags[0].id });
  }
  await save.run({ favorites, questions, avoid });
  onEvent({ kind: 'note', text: 'Used title matching instead of the agent.' });
  return { favorites, questions, avoid };
}

// ======================= plan =======================

const PLAN_SYSTEM = `You help an 8th grade English teacher pick the class's next novel from the department's approved shortlist. The goal: every student has a way in. A student has a way in when the book fits them better than it fits the class on average (Qloo affinity to their favorites, compared with the class) and is among their top 3 such books. A student without one can get a bridge clip: a film (within the class's ratings) that ranks high both among films the book's readers like and for that student's favorites.
Tools:
- get_class: students, their favorites, how earlier units went for each of them, the shortlist, and the teacher's note.
- rank_texts: Qloo ranks the shortlist for every student. Returns each book with who has a way in, who does not, and which previously left-out students it reaches.
- find_bridges(book_id): for the students without a way in to that book, finds a bridge clip for each and reports who is still left with nothing.
- look_at_book(book_id): the book's Qloo genre tags and the class favorites that lead students into it. Use it for the opening day.
- choose_text(book_id, reason): your decision.
- submit_unit_plan: the plan for the teacher.
How to decide: call get_class and rank_texts. Take the top two or three books and call find_bridges on each. Prefer the book that leaves the fewest students with nothing, then the one that reaches students left out of earlier units, then the most direct ways in. Follow the teacher's note when it rules a book out or asks for something (for example a different genre from last unit), and say so in the reason. The reason names the numbers you compared.
Plan rules:
- way_in_notes: one line for each student with a way in, using the leads_in favorite that choose_text returns for them ("Maya: Stranger Things leads into this book"). If leads_in is empty, say the book is their #N of the list.
- Refer to students by first name only. Do not use he, she, his or her for students.
- bridge_notes: one line per bridged student: the bridge clip title, which of their favorites it connects (connects_favorite from choose_text), and how to use it (a short clip before chapter 1, watched with a partner). Do not describe the film's plot. Use only bridges returned for the chosen book.
- opening: two or three sentences for day one, built on the book's tags and the favorites that lead into it (from look_at_book). Do not describe the plot.
- discussion_starters: three open questions about the book's themes. Use only the book's title, year, description and tags from the tools. Do not invent plot details or character names.
- teacher_notes: at most four short items, only of these kinds: students still without a way in or a bridge (suggest a one-to-one check-in), students with no favorites on file yet, and what to keep away from for whom. If none apply, return an empty list. No comments about the tools, the data or these rules.
Plain, short sentences. No marketing words, no em dashes.`;

const PLAN_SCHEMA = S.obj({
  opening: S.str,
  way_in_notes: S.arr(S.obj({ student_id: S.str, note: S.str })),
  bridge_notes: S.arr(S.obj({ student_id: S.str, entity_id: S.str, note: S.str })),
  discussion_starters: S.arr(S.str),
  teacher_notes: S.arr(S.str),
});

export async function plan(ws, { teacherNote = '', title = '' } = {}, onEvent = () => {}, { useModel = true } = {}) {
  const requests = [];
  const log = (q, label) => {
    if (!q) return;
    const r = label ? { ...q, label } : q;
    requests.push(r);
    onEvent({ kind: 'qloo', request: r });
  };
  for (const st of ws.students) (await resolveStudent(st)).forEach((q) => log(q, `Look up ${st.first_name}'s favorites`));
  (await resolveShortlist(ws)).forEach((q) => log(q, 'Look up the shortlist'));
  const read = readBookIds(ws);
  const books = shortlistBooks(ws).filter((b) => !read.has(b.entity_id));
  if (books.length < 2) throw new Error('The shortlist needs at least two unread books Qloo can find');
  const students = ws.students.filter((st) => signalsOf(st).seeds.length);
  if (students.length < 2) throw new Error('At least two students need favorites first');
  const record = termRecord(ws.students, ws.units);

  let ranks = null;
  const bridgeCache = {};
  let choice = null;
  let draft = null;
  let ground = null;
  // Opening-day material from data already fetched: the book's Qloo tags (minus format and age
  // labels) and the favorites that explain each student's way in.
  const groundFor = (bookId) => {
    const tags = (ranks.bookTags[bookId] || []).map((t) => t.name).filter((n) => !GENERIC_TAGS.test(n)).slice(0, 5);
    const lead = new Map();
    for (const st of students) {
      const r = ranks.rankings[st.id]?.[bookId];
      if (!isWayIn(r, ranks.ranked.k) || !r.via) continue;
      const n = seedName(st, r.via);
      if (!lead.has(n)) lead.set(n, []);
      lead.get(n).push(st.first_name);
    }
    return { book_id: bookId, tags, lead_ins: [...lead.entries()].map(([name, who]) => ({ name, students: who })).sort((a, b) => b.students.length - a.students.length).slice(0, 5) };
  };

  const runRank = async () => {
    if (!ranks) {
      ranks = await classRanks(ws, students, { skipRead: true });
      ranks.requests.forEach((q) => log(q));
    }
    return ranks;
  };
  const runBridges = async (bookId) => {
    if (bridgeCache[bookId]) return bridgeCache[bookId];
    await runRank();
    const row = ranks.ranked.rows.find((r) => r.entity_id === bookId);
    if (!row) throw new Error('Not a shortlisted book id');
    const book = books.find((b) => b.entity_id === bookId);
    const without = students.filter((st) => row.without.includes(st.id));
    const { bridges, requests: reqs } = await bridgesFor(ws, book, without);
    reqs.forEach((q) => log(q));
    bridgeCache[bookId] = { row, book, bridges };
    return bridgeCache[bookId];
  };
  const name = (sid) => ws.students.find((s) => s.id === sid)?.first_name || sid;
  const stillNone = (b) => Object.entries(b.bridges).filter(([, v]) => !v).map(([sid]) => sid);

  const tools = [
    {
      name: 'get_class',
      description: 'Students, favorites, how earlier units went, the shortlist and the teacher note.',
      parameters: S.obj({}),
      run: async () => ({
        teacher_note: teacherNote || '(none)',
        clip_ratings_allowed: ws.klass.ratings,
        earlier_units: record.units.map((u) => `${u.title}: ${u.text} (already read, not on the list for this pick)`),
        students: ws.students.map((st) => ({
          id: st.id,
          first_name: st.first_name,
          favorites: st.seeds.filter((s) => s.status === 'resolved').map((s) => `${s.matched_name || s.name} (${TYPE_WORD[s.type] || s.type}${s.source === 'reaction' ? ', loved in class' : ''})`),
          keep_away_from: (st.avoid || []).map((a) => a.label),
          earlier_units: (record.students[st.id]?.units || []).map((u) => u.status),
          no_favorites_yet: !signalsOf(st).seeds.length,
        })),
        shortlist: books.map((b) => ({ id: b.entity_id, title: b.name, author: b.author, year: b.year })),
      }),
    },
    {
      name: 'rank_texts',
      description: 'Qloo ranks the shortlist for every student. Returns each book with who has a way in.',
      parameters: S.obj({}),
      run: async () => {
        const r = await runRank();
        return {
          way_in_means: `book is in the student's top ${r.ranked.k} of ${books.length} by fit over the class average, and above that average`,
          books: r.ranked.rows.map((row) => ({
            book_id: row.entity_id,
            title: row.name,
            way_in: row.way_in.length,
            without: row.without.map(name),
            reaches_previously_left_out: row.priority_reached.map(name),
            mean_rank: row.mean_rank,
          })),
        };
      },
    },
    {
      name: 'find_bridges',
      description: 'For students without a way in to this book, find a film or show bridge for each.',
      parameters: S.obj({ book_id: S.str }),
      run: async ({ book_id }) => {
        const b = await runBridges(book_id);
        return {
          title: b.book.name,
          way_in: b.row.way_in.length,
          bridged: Object.entries(b.bridges).filter(([, v]) => v).map(([sid, v]) => ({ student: name(sid), student_id: sid, bridge_id: v.entity_id, bridge: `${v.name} (film, ${v.year}, ${v.content_rating})`, place_among_films_book_readers_like: `#${v.book_rank} of ${v.of}`, place_for_this_student: `#${v.student_rank}`, via_favorite: v.via })),
          still_left_out: stillNone(b).map(name),
        };
      },
    },
    {
      name: 'look_at_book',
      description: "The book's Qloo genre tags and the favorites that lead students into it.",
      parameters: S.obj({ book_id: S.str }),
      run: async ({ book_id }) => {
        await runRank();
        if (!books.some((b) => b.entity_id === book_id)) return { error: 'Not a shortlisted book id' };
        ground = groundFor(book_id);
        return { tags: ground.tags, favorites_that_lead_in: ground.lead_ins.map((l) => `${l.name} (${l.students.join(', ')})`) };
      },
    },
    {
      name: 'choose_text',
      description: 'Record the decision with the reason and the numbers compared.',
      parameters: S.obj({ book_id: S.str, reason: S.str }),
      run: async ({ book_id, reason }) => {
        if (!bridgeCache[book_id]) return { error: 'Call find_bridges for this book before choosing it.' };
        choice = { book_id, reason, by: 'agent' };
        const b = bridgeCache[book_id];
        return {
          ok: true,
          way_in: b.row.way_in.map((sid) => {
            const r = ranks.rankings[sid]?.[book_id];
            const st = ws.students.find((x) => x.id === sid);
            return { student_id: sid, first_name: st.first_name, rank: r?.rank, of: books.length, leads_in: r?.via ? seedName(st, r.via) : null };
          }),
          bridges: Object.entries(b.bridges).filter(([, v]) => v).map(([sid, v]) => ({ student_id: sid, bridge_id: v.entity_id, bridge: v.name, book_readers_rank: v.book_rank, student_rank: v.student_rank, connects_favorite: v.via })),
        };
      },
    },
    {
      name: 'submit_unit_plan',
      description: 'The plan for the teacher.',
      parameters: PLAN_SCHEMA,
      run: async (args) => {
        const errors = checkPlan(args, choice, bridgeCache, ws.students);
        if (errors.length) return { error: errors.join(' ') };
        draft = args;
        return { ok: true };
      },
    },
  ];

  let usage = null;
  if (useModel && modelOn()) {
    try {
      const out = await runTools({
        job: 'plan',
        instructions: PLAN_SYSTEM,
        input: [{ role: 'user', content: `Pick the next class read${title ? ` for "${title}"` : ''}. Teacher note: ${teacherNote || '(none)'}` }],
        tools,
        maxSteps: 12,
        effort: 'low',
        onEvent,
      });
      usage = out.usage;
    } catch (e) {
      onEvent({ kind: 'note', text: `The agent stopped (${e.message}). Finishing with fixed rules.` });
    }
  }

  // Fixed-rule path (also finishes a run the model left incomplete).
  if (!choice) {
    await runRank();
    // Without the model the note is not interpreted, except that a listed title next to "skip",
    // "not", "no", "avoid" or "already" takes that book out of the running.
    const skipped = teacherNote
      ? books.filter((b) => new RegExp(`\\b(skip|not|no|avoid|already|without)\\b[^.]{0,40}${escapeRe(b.name)}|${escapeRe(b.name)}[^.]{0,25}\\b(is out|already)\\b`, 'i').test(teacherNote)).map((b) => b.entity_id)
      : [];
    const rows = ranks.ranked.rows.filter((r) => !skipped.includes(r.entity_id));
    for (const row of rows.slice(0, 3)) await runBridges(row.entity_id);
    const lo = Object.fromEntries(Object.entries(record.students).map(([sid, r]) => [sid, r.missed]));
    const cost = (b) => stillNone(b).reduce((sum, sid) => sum + 1 + (lo[sid] || 0), 0);
    const best = Object.values(bridgeCache).filter((b) => !skipped.includes(b.book.entity_id)).sort((a, b) => cost(a) - cost(b) || b.row.weighted - a.row.weighted)[0];
    const noteLine = teacherNote
      ? skipped.length
        ? ` The agent was off, so the note was only checked for books to skip: ${skipped.map((id) => books.find((b) => b.entity_id === id).name).join(', ')}.`
        : ' The agent was off, so the teacher note was not read.'
      : '';
    choice = {
      book_id: best.book.entity_id,
      by: 'rules',
      reason: `Compared ${Object.values(bridgeCache).filter((b) => !skipped.includes(b.book.entity_id)).length} books. ${best.book.name}: ${best.row.way_in.length} of ${students.length} students have a way in and ${stillNone(best).length} are left without a bridge clip, the fewest of the books compared.${noteLine}`,
    };
    if (teacherNote && !skipped.length) onEvent({ kind: 'note', text: 'The teacher note was not read because the agent is off.' });
  }
  const chosen = bridgeCache[choice.book_id];
  if (!ground || ground.book_id !== choice.book_id) ground = groundFor(choice.book_id);
  if (!draft) draft = templatePlan(ws, chosen, ground, ranks);

  // Students the chosen book leaves with nothing get Qloo's top book outside the list, as an
  // independent-reading idea for the one-to-one check-in.
  const outside = {};
  const skipIds = [...read, ...books.map((b) => b.entity_id)];
  for (const sid of stillNone(chosen)) {
    const st = ws.students.find((x) => x.id === sid);
    const o = await outsidePicks(st, skipIds, 1);
    log(o.request, `${st.first_name}: best book outside the list`);
    outside[sid] = o.picks[0] || null;
  }

  // What the page shows: per student, rank and way in or bridge.
  const studentsOut = {};
  for (const st of ws.students) {
    const r = ranks.rankings[st.id]?.[choice.book_id];
    const wayIn = chosen.row.way_in.includes(st.id);
    studentsOut[st.id] = {
      rank: r?.rank ?? null,
      of: books.length,
      way_in: wayIn,
      via: wayIn && r?.via ? seedName(st, r.via) : null,
      bridge: wayIn ? null : chosen.bridges[st.id] || null,
      outside: outside[st.id] || null,
      no_favorites: !signalsOf(st).seeds.length,
    };
  }
  return {
    plan: {
      k: ranks.ranked.k,
      shortlist_size: books.length,
      chosen: { entity_id: chosen.book.entity_id, name: chosen.book.name, year: chosen.book.year, author: chosen.book.author },
      decision: choice,
      compared: Object.values(bridgeCache).map((b) => ({ entity_id: b.book.entity_id, name: b.book.name, way_in: b.row.way_in.length, bridged: Object.values(b.bridges).filter(Boolean).length, left_out: stillNone(b).length })),
      ranking: ranks.ranked.rows.map((r) => ({ entity_id: r.entity_id, name: r.name, way_in: r.way_in.length, mean_rank: r.mean_rank, reaches_left_out: r.priority_reached.length })),
      students: studentsOut,
      book_tags: ground.tags,
      lead_ins: ground.lead_ins,
      doc: draft,
    },
    requests,
    usage,
    mode: usage && choice.by === 'agent' ? 'agent' : 'rules',
  };
}

export function checkPlan(p, choice, bridgeCache, students) {
  const errors = [];
  if (!choice) return ['Call choose_text first.'];
  const chosen = bridgeCache[choice.book_id];
  const ids = new Set(students.map((s) => s.id));
  for (const n of p.way_in_notes) {
    if (!ids.has(n.student_id)) errors.push(`Unknown student ${n.student_id}.`);
    else if (!chosen.row.way_in.includes(n.student_id)) errors.push(`${n.student_id} has no way in to this book; use a bridge note or a teacher note.`);
  }
  for (const n of p.bridge_notes) {
    const b = chosen.bridges[n.student_id];
    if (!b) errors.push(`No bridge was found for ${n.student_id}.`);
    else if (b.entity_id !== n.entity_id) errors.push(`The bridge for ${n.student_id} is ${b.entity_id}, not ${n.entity_id}.`);
  }
  if (p.discussion_starters.length > 5) errors.push('At most five discussion starters.');
  if (JSON.stringify(p).includes('—')) errors.push('Remove em dashes.');
  return errors;
}

export function templatePlan(ws, chosen, ground, ranks) {
  const name = (sid) => ws.students.find((s) => s.id === sid)?.first_name || sid;
  const st = (sid) => ws.students.find((s) => s.id === sid);
  const tags = (ground?.tags || []).map((t) => t.toLowerCase());
  const leads = (ground?.lead_ins || []).slice(0, 3).map((l) => l.name);
  const wayIn = chosen.row.way_in.map((sid) => {
    const r = ranks.rankings[sid]?.[chosen.book.entity_id];
    const via = r?.via ? seedName(st(sid), r.via) : null;
    return { student_id: sid, note: via ? `${name(sid)}: ${via} leads into this book (their #${r.rank} of ${ranks.books.length}).` : `${name(sid)}: their #${r?.rank} of ${ranks.books.length}.` };
  });
  const bridges = Object.entries(chosen.bridges)
    .filter(([, b]) => b)
    .map(([sid, b]) => ({ student_id: sid, entity_id: b.entity_id, note: `${name(sid)}: show a short scene from ${b.name} (${b.content_rating || 'check rating'}) before chapter 1${b.via ? `; it connects ${b.via} to the book` : ''}.` }));
  const none = Object.entries(chosen.bridges).filter(([, b]) => !b).map(([sid]) => name(sid));
  return {
    opening: leads.length
      ? `Put ${joinNames(leads)} on the board: those are favorites in this class that lead into ${chosen.book.name}.${tags.length ? ` Qloo tags the book ${joinNames(tags.slice(0, 3))}.` : ''} Ask pairs what a story like that needs, then read the first page aloud.`
      : `Ask each student to name a story they could not put down, then read the first page of ${chosen.book.name} aloud.`,
    way_in_notes: wayIn,
    bridge_notes: bridges,
    discussion_starters: [
      `Which character in ${chosen.book.name} would you want on your side, and why?`,
      'What does the main character want most, and what is in the way?',
      'Where did the story surprise you?',
    ],
    teacher_notes: [
      ...(none.length ? [`No way in or bridge yet for ${joinNames(none)}. Plan a one-to-one check-in in the first week.`] : []),
      ...ws.students.filter((s) => !signalsOf(s).seeds.length).map((s) => `${s.first_name} has no favorites on file yet. Read their survey so the next pick includes them.`),
      ...ws.students.flatMap((s) => (s.avoid || []).map((a) => `${s.first_name}: keep away from ${a.label}.`)),
    ],
  };
}

// ======================= debrief =======================

const DEBRIEF_SYSTEM = `A unit just ended. The teacher logged how each student took the class book (hooked = finished or asked for more, engaged = kept up and joined in, not_engaged = did not connect, absent = missed most of the unit) and wrote a short note.
Your jobs:
1. If the note mentions a new favorite for a student (for example "Jonah said it reminded him of The Last of Us"), search Qloo for it and add it with add_favorite. Only add what the note says.
2. Write one short note per student who was not absent, for the teacher's own records: how they took the book and one idea for next time that builds on it. Facts only from the log and the note. No grades, no behavior labels, nothing about health or family. Refer to the student by first name; do not use he, she, him, her or his. Vary the wording. No em dashes.
3. Call save_notes once at the end.`;

export async function debrief(ws, unit, reactions, teacherNote, onEvent = () => {}, { useModel = true } = {}) {
  const changes = [];
  const book = unit.plan?.chosen;
  for (const st of ws.students) {
    const v = reactions[st.id];
    if (v === 'hooked' && book && !st.seeds.some((s) => s.entity_id === book.entity_id)) {
      st.seeds.push({ name: book.name, type: 'book', source: 'reaction', status: 'resolved', entity_id: book.entity_id, matched_name: book.name, year: book.year, added: unit.end });
      changes.push({ student_id: st.id, change: `${book.name} is now one of their favorites` });
    }
  }

  const seen = new Map();
  const requests = [];
  let notes = null;
  const present = ws.students.filter((st) => reactions[st.id] && reactions[st.id] !== 'absent');
  const tools = [
    {
      name: 'search_qloo_entities',
      description: 'Search Qloo entities by name.',
      parameters: S.obj({ query: S.str, type: S.oneOf(SEARCH_TYPES) }),
      run: async ({ query, type }) => {
        if (containsName(query, ws.students)) return { error: 'Searches may not contain a person\'s name from the class or a teacher. Search titles only.' };
        const { results, request } = await qloo.search({ query, types: [type], take: 5 });
        requests.push({ ...request, label: `Search "${query}"` });
        onEvent({ kind: 'qloo', request });
        results.forEach((e) => seen.set(e.entity_id, e));
        return { results: results.map(compact) };
      },
    },
    {
      name: 'add_favorite',
      description: 'Add a Qloo entity to a student profile because the teacher note mentions it. Quote the words from the note.',
      parameters: S.obj({ student_id: S.str, entity_id: S.str, note_quote: S.str }),
      run: async ({ student_id, entity_id, note_quote }) => {
        const st = ws.students.find((x) => x.id === student_id);
        const e = seen.get(entity_id);
        if (!st) return { error: 'Student not in this class' };
        if (!e) return { error: 'Use an entity id from a search in this run' };
        const q = note_quote.trim().toLowerCase();
        if (q.length < 8 || !teacherNote.toLowerCase().includes(q)) return { error: 'The quote must be at least 8 characters copied from the teacher note' };
        if (!st.seeds.some((s) => s.entity_id === entity_id)) {
          st.seeds.push({ name: e.name, type: e.type, source: 'teacher', status: 'resolved', entity_id, matched_name: e.name, year: e.year, added: unit.end });
          changes.push({ student_id, change: `${e.name} added from the teacher note` });
        }
        return { ok: true };
      },
    },
    {
      name: 'save_notes',
      description: 'One note per student who was not absent.',
      parameters: S.obj({ notes: S.arr(S.obj({ student_id: S.str, note: S.str })) }),
      run: async (args) => {
        const bad = args.notes.filter((n) => !present.some((st) => st.id === n.student_id));
        if (bad.length) return { error: `Not present or unknown: ${bad.map((b) => b.student_id).join(', ')}` };
        notes = args.notes;
        return { ok: true };
      },
    },
  ];

  let usage = null;
  if (useModel && modelOn() && present.length) {
    try {
      const table = present.map((st) => ({ student_id: st.id, first_name: st.first_name, took_the_book: reactions[st.id], had: unit.plan?.students?.[st.id]?.way_in ? 'way in' : unit.plan?.students?.[st.id]?.bridge ? `bridge: ${unit.plan.students[st.id].bridge.name}` : 'nothing' }));
      const out = await runTools({
        job: 'debrief',
        instructions: DEBRIEF_SYSTEM,
        input: [{ role: 'user', content: `Unit: ${unit.title}, book: ${book?.name}.\nLog: ${JSON.stringify(table)}\nTeacher note: ${teacherNote || '(none)'}` }],
        tools,
        maxSteps: 8,
        onEvent,
      });
      usage = out.usage;
    } catch (e) {
      onEvent({ kind: 'note', text: `The agent stopped (${e.message}). Writing notes from templates.` });
    }
  } else if (teacherNote) {
    onEvent({ kind: 'note', text: 'The teacher note was saved. It is read for new favorites only when the agent is on.' });
  }
  if (!notes) notes = templateNotes(present, reactions, book, unit);

  const at = new Date().toISOString();
  for (const n of notes) ws.students.find((x) => x.id === n.student_id)?.history.push({ at, kind: 'unit_note', unit_id: unit.id, text: n.note });
  return { changes, notes, requests, usage, mode: usage ? 'agent' : 'rules' };
}

const NEXT = {
  hooked: 'Offer a related title for independent reading.',
  engaged: 'Keep them in a discussion role next unit.',
  not_engaged: 'Check their survey favorites before the next pick.',
};
function templateNotes(present, reactions, book, unit) {
  return present.map((st) => {
    const v = reactions[st.id];
    const had = unit.plan?.students?.[st.id];
    const how = { hooked: `was hooked by ${book?.name || 'the book'}`, engaged: `kept up with ${book?.name || 'the book'}`, not_engaged: `did not connect with ${book?.name || 'the book'}` }[v] || 'took part';
    const via = had?.way_in && had.via ? ` (way in: ${had.via})` : had?.bridge ? ` (bridge: ${had.bridge.name})` : '';
    return { student_id: st.id, note: `${how.charAt(0).toUpperCase()}${how.slice(1)}${via}. ${NEXT[v] || ''}`.trim() };
  });
}
