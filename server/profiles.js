// Student profiles and the shortlist: turning survey answers and titles into Qloo entities, and
// fetching the Qloo results a plan needs. Scoring lives in planner.js.
import * as qloo from './qloo.js';
import { studentRanking, rankTexts, pickBridge, leftOutCounts } from './planner.js';

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Searches never carry a person's name from the class: any word that is a classmate's first name,
// and any word after Mr., Ms., Mrs. or Dr., blocks the search.
export function containsName(query, students) {
  const words = new Set(norm(query).split(' '));
  if (students.some((st) => words.has(norm(st.first_name)))) return true;
  if (['mr', 'ms', 'mrs', 'miss', 'dr'].some((w) => words.has(w))) return true;
  return /\b(mr|ms|mrs|miss|dr)\.?\s+[a-z]/i.test(String(query));
}

// A search hit is taken without asking only when its name matches what the student wrote.
export function confidentMatch(query, hit) {
  if (!hit) return false;
  const a = norm(query);
  const b = norm(hit.name);
  return a === b || (a.length > 5 && (b.startsWith(a) || a.startsWith(b)));
}

export async function resolveSeed(seed) {
  const { results, request } = await qloo.search({ query: seed.name, types: [seed.type], take: 5 });
  const top = results[0];
  if (confidentMatch(seed.name, top)) {
    return { ...seed, status: 'resolved', entity_id: top.entity_id, matched_name: top.name, type: top.type || seed.type, year: top.year, request };
  }
  return { ...seed, status: results.length ? 'needs_review' : 'not_found', candidates: results.slice(0, 4).map((r) => ({ entity_id: r.entity_id, name: r.name, type: r.type, year: r.year })), request };
}

export async function resolveAvoid(avoid) {
  if (avoid.tag_id || !avoid.query) return avoid;
  const { tags, request } = await qloo.findTags({ query: avoid.query, take: 5 });
  const exact = tags.find((t) => norm(t.name) === norm(avoid.query)) || tags[0];
  return exact ? { ...avoid, tag_id: exact.id, tag_name: exact.name, request } : { ...avoid, status: 'not_found', request };
}

// Resolves whatever is still unresolved in one student. Returns the Qloo requests it made.
export async function resolveStudent(student) {
  const requests = [];
  student.seeds = await Promise.all(
    student.seeds.map(async (s) => {
      if (s.status !== 'unresolved') return s;
      const r = await resolveSeed(s);
      if (r.request) requests.push(r.request);
      delete r.request;
      return r;
    }),
  );
  student.avoid = await Promise.all(
    (student.avoid || []).map(async (a) => {
      if (a.tag_id || a.status === 'not_found') return a;
      const r = await resolveAvoid(a);
      if (r.request) requests.push(r.request);
      delete r.request;
      return r;
    }),
  );
  return requests;
}

export async function resolveShortlist(ws) {
  const requests = [];
  ws.shortlist = await Promise.all(
    ws.shortlist.map(async (b) => {
      if (b.status === 'resolved') return b;
      const { results, request } = await qloo.search({ query: b.name, types: ['book'], take: 5 });
      requests.push(request);
      // Prefer the hit whose name matches; Qloo's book disambiguation carries the author.
      const hit = results.find((r) => confidentMatch(b.name, r) && (!b.author || !r.disambiguation || norm(r.disambiguation).includes(norm(b.author).split(' ').pop()))) || results.find((r) => confidentMatch(b.name, r));
      return hit ? { ...b, status: 'resolved', entity_id: hit.entity_id, matched_name: hit.name, year: hit.year } : { ...b, status: 'not_found' };
    }),
  );
  return requests;
}

export const shortlistBooks = (ws) => ws.shortlist.filter((b) => b.status === 'resolved').map((b) => ({ entity_id: b.entity_id, name: b.matched_name || b.name, year: b.year, author: b.author }));

export function signalsOf(student) {
  return {
    seeds: student.seeds.filter((s) => s.status === 'resolved' && s.entity_id).map((s) => s.entity_id),
    excluded: (student.excluded || []).map((x) => x.entity_id),
    avoidTags: (student.avoid || []).filter((a) => a.tag_id).map((a) => a.tag_id),
  };
}

export const seedName = (student, id) => {
  const s = student.seeds.find((x) => x.entity_id === id);
  return s ? s.matched_name || s.name : null;
};

// One Qloo call per student: how every shortlisted book ranks against that student's favorites.
export async function studentRanks(student, books) {
  const sig = signalsOf(student);
  if (!sig.seeds.length || !books.length) return { ranking: {}, request: null };
  const ids = books.map((b) => b.entity_id);
  const r = await qloo.insights({ type: 'book', seeds: sig.seeds, only: ids, explain: true, take: ids.length });
  const tags = Object.fromEntries(r.entities.map((e) => [e.entity_id, e.tags || []]));
  return { ranking: studentRanking(r.entities, ids), tags, request: r.request };
}

// The student's strongest books from all of Qloo, not just the approved list. Shown as an
// independent-reading idea, and as a check on whether the list itself fits the student at all.
export async function outsidePicks(student, skipIds, take = 3) {
  const sig = signalsOf(student);
  if (!sig.seeds.length) return { picks: [], request: null };
  const r = await qloo.insights({ type: 'book', seeds: sig.seeds, excludeEntities: [...new Set([...skipIds, ...sig.seeds])], take: 10 });
  return { picks: r.entities.slice(0, take).map((e) => ({ entity_id: e.entity_id, name: e.name, year: e.year, via: topSeed(student, e) })), request: r.request };
}

// Books already read by this class in an earlier unit are left out of a new pick.
export const readBookIds = (ws) => new Set(ws.units.filter((u) => u.text?.entity_id).map((u) => u.text.entity_id));

export async function classRanks(ws, students, { skipRead = false } = {}) {
  const read = skipRead ? readBookIds(ws) : new Set();
  const books = shortlistBooks(ws).filter((b) => !read.has(b.entity_id));
  const rankings = {};
  const bookTags = {};
  const requests = [];
  await Promise.all(
    students.map(async (st) => {
      const { ranking, tags, request } = await studentRanks(st, books);
      rankings[st.id] = ranking;
      for (const [id, t] of Object.entries(tags || {})) if (!bookTags[id]?.length) bookTags[id] = t;
      if (request) requests.push({ ...request, label: `${st.first_name}: shortlist ranking` });
    }),
  );
  const ranked = rankTexts(books, rankings, leftOutCounts(ws.students, ws.units));
  return { books, rankings, ranked, bookTags, requests };
}

// Bridges for one book: for each student without a way in, the film or show that both the book
// and that student's favorites pushed up (from explainability), within the class's ratings.
export async function bridgesFor(ws, book, students, bookTags = {}) {
  const requests = [];
  const out = {};
  await Promise.all(
    students.map(async (st) => {
      const sig = signalsOf(st);
      if (!sig.seeds.length) {
        out[st.id] = null;
        return;
      }
      const candidates = [];
      for (const type of ['movie', 'tv_show']) {
        const r = await qloo.insights({
          type,
          seeds: [book.entity_id, ...sig.seeds],
          contentRatings: ws.klass.ratings,
          excludeEntities: [...sig.excluded, ...sig.seeds],
          excludeTags: sig.avoidTags,
          explain: true,
          take: 20,
        });
        if (r.request) requests.push({ ...r.request, label: `${st.first_name}: bridge clip to ${book.name} (${type === 'movie' ? 'films' : 'TV'})` });
        // Qloo filters by rating already; titles with no rating or one outside the class's list are
        // dropped here too, in case the filter does not apply to a rating system.
        candidates.push(...r.entities.filter((e) => e.content_rating && ws.klass.ratings.includes(e.content_rating)).map((e) => ({ ...e, type: e.type || type })));
      }
      const b = pickBridge(candidates, book.entity_id, sig.seeds);
      const bookTagNames = new Set((bookTags?.[book.entity_id] || []).map((t) => t.name));
      out[st.id] = b
        ? { entity_id: b.entity_id, name: b.name, type: b.type, year: b.year, content_rating: b.content_rating, description: b.description, book_share: b.book_share, student_share: b.student_share, via: topSeed(st, b), shared_tags: (b.tags || []).map((t) => t.name).filter((n) => bookTagNames.has(n)).slice(0, 3) }
        : null;
    }),
  );
  return { bridges: out, requests };
}

function topSeed(student, entity) {
  const ids = new Set(signalsOf(student).seeds);
  const best = Object.entries(entity.explain || {})
    .filter(([id]) => ids.has(id))
    .sort((a, b) => b[1] - a[1])[0];
  return best ? seedName(student, best[0]) : null;
}

// What this class's favorites and the book's audience have in common, from Qloo's compare.
export async function commonGround(students, book) {
  const seeds = [...new Set(students.flatMap((st) => signalsOf(st).seeds))].slice(0, 30);
  try {
    const { shared, request } = await qloo.compare({ a: seeds, b: [book.entity_id], take: 6 });
    return { shared, request };
  } catch (e) {
    return { shared: [], request: e.request || null, error: e.message };
  }
}
