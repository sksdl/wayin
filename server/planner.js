// Choosing a class read. Pure functions: no network, no model.
//
// Inputs are Qloo results that were already fetched:
//   - per student: affinity of every shortlisted book toward that student's favorites
//     (insights with filter.results.entities = the shortlist), with explainability
//   - per student without a way in: films and TV scored against the book plus that student's
//     favorites, with explainability (the bridge search)
// Nothing here turns an affinity into a claim about a person. A student "has a way in" when a book
// is near the top of their own ranking of the shortlist; the UI shows ranks, not percentages.

// A book is a student's way in when it is in their own top 3 of the unread approved books.
export const TOP_K = 3;
export function topK(listSize) {
  return Math.min(TOP_K, Math.max(1, listSize - 1));
}

// Bridge: a film or show both the book and the student's favorites pushed up. Each side must
// account for at least this share of Qloo's explainability for the item.
export const BRIDGE_MIN_SHARE = 0.2;

// Students who missed earlier units (nothing, or did not connect) count more in the next pick.
export const LEFT_OUT_WEIGHT = 0.5;

// results: Qloo entities for one student, already restricted to the shortlist.
// Returns { [bookId]: { rank, affinity, via } } where via is the seed id that explained it most.
export function studentRanking(results, shortlistIds) {
  const allowed = new Set(shortlistIds);
  const ranked = results.filter((e) => allowed.has(e.entity_id)).sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
  const out = {};
  ranked.forEach((e, i) => {
    const via = Object.entries(e.explain || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    out[e.entity_id] = { rank: i + 1, affinity: e.affinity ?? null, via };
  });
  return out;
}

// rankings: { [studentId]: studentRanking(...) }
// leftOut: { [studentId]: number of earlier units with no way in and no bridge }
export function rankTexts(shortlist, rankings, leftOut = {}) {
  const k = topK(shortlist.length);
  const studentIds = Object.keys(rankings);
  const rows = shortlist.map((book) => {
    const wayIn = [];
    const without = [];
    let weighted = 0;
    let rankSum = 0;
    let ranked = 0;
    for (const sid of studentIds) {
      const r = rankings[sid][book.entity_id];
      if (r) {
        rankSum += r.rank;
        ranked++;
      }
      if (r && r.rank <= k) {
        wayIn.push(sid);
        weighted += 1 + LEFT_OUT_WEIGHT * (leftOut[sid] || 0);
      } else without.push(sid);
    }
    return {
      entity_id: book.entity_id,
      name: book.name,
      year: book.year ?? null,
      way_in: wayIn,
      without,
      weighted: round(weighted),
      mean_rank: ranked ? round(rankSum / ranked) : null,
      priority_reached: wayIn.filter((sid) => (leftOut[sid] || 0) > 0),
    };
  });
  rows.sort((a, b) => b.weighted - a.weighted || (a.mean_rank ?? 99) - (b.mean_rank ?? 99));
  return { k, rows };
}

// candidates: Qloo films/TV scored against [bookId, ...studentSeeds] with explainability.
export function pickBridge(candidates, bookId, studentSeedIds, { skip = [] } = {}) {
  const seeds = new Set(studentSeedIds);
  const skipSet = new Set(skip);
  let best = null;
  for (const c of candidates) {
    if (skipSet.has(c.entity_id) || seeds.has(c.entity_id)) continue;
    const bookShare = c.explain?.[bookId] || 0;
    const studentShare = Object.entries(c.explain || {}).reduce((sum, [id, v]) => (seeds.has(id) ? sum + v : sum), 0);
    if (bookShare < BRIDGE_MIN_SHARE || studentShare < BRIDGE_MIN_SHARE) continue;
    const score = Math.min(bookShare, studentShare) * (c.affinity ?? 0.5);
    if (!best || score > best.score) best = { ...c, book_share: round(bookShare), student_share: round(studentShare), score: round(score) };
  }
  return best;
}

// Per unit and student: way_in, bridge, none or absent. Absent comes from the reactions logged
// when the unit closed, so a student who missed the unit is not counted either way.
export function unitStatus(unit, sid) {
  if (unit.roster && !unit.roster.includes(sid)) return 'not_enrolled';
  if (unit.reactions?.[sid] === 'absent') return 'absent';
  const s = unit.plan?.students?.[sid];
  if (!s) return 'none';
  if (s.way_in) return 'way_in';
  if (s.bridge) return 'bridge';
  return 'none';
}

// A student "missed" a unit when they had nothing (no way in, no bridge) or had something but did
// not connect with the book. Missed units count extra in the next pick.
function missedUnit(unit, sid, status) {
  return status === 'none' || ((status === 'way_in' || status === 'bridge') && unit.reactions?.[sid] === 'not_engaged');
}

// Term record for the dashboard: per student, the status in each finished unit, in order.
export function termRecord(students, units) {
  const done = units.filter((u) => u.status === 'done').sort((a, b) => a.start.localeCompare(b.start));
  const record = {};
  for (const st of students) {
    const row = done.map((u) => {
      const status = unitStatus(u, st.id);
      return { unit_id: u.id, status, reaction: u.reactions?.[st.id] || null, missed: missedUnit(u, st.id, status) };
    });
    // Consecutive missed units counting back from the latest one the student was there for.
    let streak = 0;
    for (const r of [...row].reverse()) {
      if (r.status === 'absent' || r.status === 'not_enrolled') continue;
      if (!r.missed) break;
      streak++;
    }
    record[st.id] = {
      units: row,
      present: row.filter((r) => r.status !== 'absent' && r.status !== 'not_enrolled').length,
      reached: row.filter((r) => r.status === 'way_in' || r.status === 'bridge').length,
      left_out: row.filter((r) => r.status === 'none').length,
      missed: row.filter((r) => r.missed).length,
      streak,
    };
  }
  return {
    units: done.map((u) => ({ id: u.id, title: u.title, text: u.text?.name, k: u.plan?.k ?? null, of: u.plan?.shortlist_size ?? null, picked_by: u.picked_by, sample: Boolean(u.seed_from_demo) })),
    students: record,
  };
}

export function leftOutCounts(students, units) {
  const rec = termRecord(students, units);
  return Object.fromEntries(Object.entries(rec.students).map(([sid, r]) => [sid, r.missed]));
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
