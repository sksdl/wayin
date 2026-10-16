// Student profiles and the shortlist: turning survey answers and titles into Qloo entities, and
// fetching the Qloo results a plan needs. Scoring lives in planner.js.
import * as qloo from './qloo.js';
import { classRankings, rankTexts, pickBridge, leftOutCounts } from './planner.js';

const MIN_FOR_RELATIVE = 4;
const AGE_OK = /^(middle grade|childrens?|children's|young adult|13-17|9-12)$/i;
const ADULT = /^(adult|erotica|romance|new adult|18\+)$/i;

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

// Book names carry a series note ("Holes (Holes, #1)"); compare without it.
export const baseTitle = (name) => String(name || '').replace(/\s*\([^()]*\)\s*$/, '').trim() || String(name || '');

// A search hit is taken without asking only when its name matches what the student wrote.
export function confidentMatch(query, hit) {
  if (!hit) return false;
  const a = norm(query);
  const b = norm(baseTitle(hit.name));
  return a === b || (a.length > 5 && (b.startsWith(a) || a.startsWith(b)));
}

// Exact title first (search can rank "Ghosts" above "Ghost (Track, #1)"), then a close one at the top.
export function bestMatch(query, results) {
  return results.find((r) => norm(baseTitle(r.name)) === norm(query)) || (confidentMatch(query, results[0]) ? results[0] : null);
}

export async function resolveSeed(seed) {
  const { results, request } = await qloo.search({ query: seed.name, types: [seed.type], take: 8 });
  const top = bestMatch(seed.name, results);
  if (top) {
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
      const { results, request } = await qloo.search({ query: b.name, types: ['book'], take: 8 });
      requests.push(request);
      // Prefer the hit whose title matches and whose disambiguation ("1998, Louis Sachar") names
      // the author; study guides and other books with the same title are skipped.
      const byAuthor = (r) => !b.author || !r.disambiguation || norm(r.disambiguation).includes(norm(b.author).split(' ').pop());
      const exact = results.filter((r) => norm(baseTitle(r.name)) === norm(b.name));
      const hit = exact.find(byAuthor) || results.find((r) => confidentMatch(b.name, r) && byAuthor(r)) || exact[0];
      return hit ? { ...b, status: 'resolved', entity_id: hit.entity_id, matched_name: hit.name } : { ...b, status: 'not_found' };
    }),
  );
  return requests;
}

// The teacher's own title and year are shown; Qloo's edition name and year can differ.
export const shortlistBooks = (ws) => ws.shortlist.filter((b) => b.status === 'resolved').map((b) => ({ entity_id: b.entity_id, name: b.name, year: b.year, author: b.author }));

export function signalsOf(student) {
  return {
    seeds: student.seeds.filter((s) => s.status === 'resolved' && s.entity_id).map((s) => s.entity_id),
    excluded: (student.excluded || []).map((x) => x.entity_id),
    avoidTags: (student.avoid || []).filter((a) => a.tag_id).map((a) => a.tag_id),
  };
}

export const seedName = (student, id) => {
  const s = student.seeds.find((x) => x.entity_id === id);
  return s ? baseTitle(s.matched_name || s.name) : null;
};

// One Qloo call per student: every book on the approved list scored against that student's
// favorites. The whole list is always asked for (one cache entry per student), and books already
// read are filtered out afterwards.
export async function studentRaw(student, books) {
  const sig = signalsOf(student);
  if (!sig.seeds.length || !books.length) return { entities: [], request: null };
  const ids = books.map((b) => b.entity_id);
  const r = await qloo.insights({ type: 'book', seeds: sig.seeds, only: ids, explain: true, take: ids.length });
  return { entities: r.entities, request: r.request };
}

// The student's strongest books from all of Qloo, not just the approved list. Shown as an
// independent-reading idea, and as a check on whether the list itself fits the student at all.
export async function outsidePicks(student, skipIds, take = 3) {
  const sig = signalsOf(student);
  if (!sig.seeds.length) return { picks: [], request: null };
  const r = await qloo.insights({ type: 'book', seeds: sig.seeds, excludeEntities: [...new Set([...skipIds, ...sig.seeds])], explain: true, take: 30 });
  // Only books Qloo tags for young readers; this is for a 13-year-old.
  const young = r.entities.filter((e) => (e.tags || []).some((t) => AGE_OK.test(t.name)) && !(e.tags || []).some((t) => ADULT.test(t.name)));
  return { picks: young.slice(0, take).map((e) => ({ entity_id: e.entity_id, name: e.name, year: e.year, via: topSeed(student, e) })), request: r.request };
}

// Books already read by this class in an earlier unit are left out of a new pick.
export const readBookIds = (ws) => new Set(ws.units.filter((u) => u.text?.entity_id).map((u) => u.text.entity_id));

export async function classRanks(ws, students, { skipRead = false } = {}) {
  const read = skipRead ? readBookIds(ws) : new Set();
  const all = shortlistBooks(ws);
  const books = all.filter((b) => !read.has(b.entity_id));
  const raw = {};
  const bookTags = {};
  const requests = [];
  await Promise.all(
    students.map(async (st) => {
      const { entities, request } = await studentRaw(st, all);
      raw[st.id] = entities;
      for (const e of entities) if (!bookTags[e.entity_id]?.length) bookTags[e.entity_id] = e.tags || [];
      if (request) requests.push({ ...request, label: `${st.first_name}: approved list against their favorites` });
    }),
  );
  const rankings = classRankings(raw, books.map((b) => b.entity_id));
  const ranked = rankTexts(books, rankings, leftOutCounts(ws.students, ws.units));
  return { books, rankings, ranked, bookTags, requests };
}

// Bridge clips for one book. First the films the book's readers also like (one call per book,
// within the class's ratings), then, for each student without a way in, those same films scored
// against that student's favorites. Films only: on live data the TV results for book readers were
// mostly reality shows.
export async function bridgesFor(ws, book, students) {
  const requests = [];
  const out = {};
  const side = await qloo.insights({ type: 'movie', seeds: [book.entity_id], contentRatings: ws.klass.ratings, take: 25 });
  if (side.request) requests.push({ ...side.request, label: `Films readers of ${book.name} also like` });
  // Qloo filters by rating already; titles with no rating or one outside the class's list are
  // dropped here too, in case the filter does not apply to a rating system.
  const bookSide = side.entities.filter((e) => e.content_rating && ws.klass.ratings.includes(e.content_rating));
  // Score the book's films against each student's favorites.
  const scored = {};
  await Promise.all(
    students.map(async (st) => {
      const sig = signalsOf(st);
      const ids = bookSide.map((e) => e.entity_id).filter((id) => !sig.seeds.includes(id) && !sig.excluded.includes(id));
      if (!sig.seeds.length || !ids.length) return;
      const r = await qloo.insights({ type: 'movie', seeds: sig.seeds, only: ids, excludeTags: sig.avoidTags, explain: true, take: ids.length });
      if (r.request) requests.push({ ...r.request, label: `${st.first_name}: those films against their favorites` });
      scored[st.id] = r.entities.filter((e) => !e.content_rating || ws.klass.ratings.includes(e.content_rating));
    }),
  );
  // With enough students, order each student's films by fit over the others, as for books.
  const relative = Object.keys(scored).length >= MIN_FOR_RELATIVE ? classRankings(scored, bookSide.map((e) => e.entity_id)) : null;
  for (const st of students) {
    const list = scored[st.id];
    if (!list?.length) {
      out[st.id] = null;
      continue;
    }
    const byId = new Map(list.map((e) => [e.entity_id, e]));
    const ordered = relative
      ? Object.entries(relative[st.id] || {})
          .filter(([, r]) => r.z > 0)
          .sort((a, b) => a[1].rank - b[1].rank)
          .map(([id]) => byId.get(id))
          .filter(Boolean)
      : list;
    const b = pickBridge(bookSide, ordered, { ordered: Boolean(relative) });
    out[st.id] = b
      ? { entity_id: b.entity_id, name: b.name, type: 'movie', year: b.year, content_rating: b.content_rating || bookSide.find((x) => x.entity_id === b.entity_id)?.content_rating, description: b.description, book_rank: b.book_rank, student_rank: b.student_rank, of: b.of, via: topSeed(st, b) }
      : null;
  }
  return { bridges: out, requests };
}

function topSeed(student, entity) {
  const ids = new Set(signalsOf(student).seeds);
  const best = Object.entries(entity.explain || {})
    .filter(([id]) => ids.has(id))
    .sort((a, b) => b[1] - a[1])[0];
  return best ? seedName(student, best[0]) : null;
}
