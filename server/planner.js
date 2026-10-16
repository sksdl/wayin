// Choosing a class read. Pure functions: no network, no model.
//
// Inputs are Qloo results that were already fetched:
//   - per student: affinity of every listed book toward that student's favorites
//     (insights with filter.results.entities = the list), with explainability
//   - per book: films its readers also like; per student without a way in: those films scored
//     against the student's favorites (the bridge search)
// Nothing here turns an affinity into a claim about a person. The UI shows ranks, not percentages.

// A book is a student's way in when it is in their own top 3 of the unread approved books.
export const TOP_K = 3;
export function topK(listSize) {
  return Math.min(TOP_K, Math.max(1, listSize - 1));
}

// Bridge clip: a film both sides rank high. bookSide is what readers of the book also like
// (Qloo insights with the book as the only signal), in order. studentSide is the same films scored
// against one student's favorites (filter.results.entities = bookSide). The bridge is the film with
// the best combined place in both lists, and it must be in the student's own top BRIDGE_STUDENT_TOP.
export const BRIDGE_STUDENT_TOP = 5;

// Students who missed earlier units (nothing, or did not connect) count more in the next pick.
export const LEFT_OUT_WEIGHT = 0.5;

// Raw Qloo affinity is shared a lot between students: on live data the same three popular books
// were in the top 3 of 15 of 17 students. What tells a teacher something is how much better a book
// fits this student than it fits the class. So every affinity is turned into a z-score within its
// book (across the class), and each student's ranking is by that score.
//
// raw: { [studentId]: Qloo entities restricted to the list }
// Returns { [studentId]: { [bookId]: { rank, z, affinity, via } } } over bookIds only.
export function classRankings(raw, bookIds) {
  const allowed = new Set(bookIds);
  const aff = {};
  const via = {};
  for (const [sid, list] of Object.entries(raw)) {
    aff[sid] = {};
    via[sid] = {};
    for (const e of list || []) {
      if (!allowed.has(e.entity_id) || !Number.isFinite(e.affinity)) continue;
      aff[sid][e.entity_id] = e.affinity;
      via[sid][e.entity_id] = Object.entries(e.explain || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
  }
  const stats = {};
  for (const b of bookIds) {
    const vals = Object.values(aff).map((m) => m[b]).filter((v) => Number.isFinite(v));
    const mean = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length || 1)) || 1;
    stats[b] = { mean, sd };
  }
  const out = {};
  for (const sid of Object.keys(aff)) {
    const rows = Object.entries(aff[sid])
      .map(([b, a]) => ({ b, a, z: (a - stats[b].mean) / stats[b].sd }))
      .sort((x, y) => y.z - x.z || y.a - x.a);
    out[sid] = Object.fromEntries(rows.map((r, i) => [r.b, { rank: i + 1, z: round(r.z), affinity: r.a, via: via[sid][r.b] }]));
  }
  return out;
}

// A way in: the book is in the student's top K by fit over the class, and fits them better than
// the class average (z > 0). A student whose tastes match no book better than the class gets none.
export const isWayIn = (r, k) => Boolean(r && r.rank <= k && r.z > 0);

// rankings: { [studentId]: classRankings(...)[studentId] }
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
      if (isWayIn(r, k)) {
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

// studentSide is in the student's order: by fit over the other students when it comes from
// classRankings (so one blockbuster does not become everyone's bridge), else by raw affinity.
export function pickBridge(bookSide, studentSide, { skip = [], ordered = false } = {}) {
  const skipSet = new Set(skip);
  const bookRank = new Map(bookSide.map((e, i) => [e.entity_id, i + 1]));
  const ranked = studentSide.filter((e) => bookRank.has(e.entity_id) && !skipSet.has(e.entity_id));
  if (!ordered) ranked.sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
  let best = null;
  ranked.slice(0, BRIDGE_STUDENT_TOP).forEach((e, i) => {
    const score = bookRank.get(e.entity_id) + (i + 1);
    if (!best || score < best.score) best = { ...e, book_rank: bookRank.get(e.entity_id), student_rank: i + 1, of: bookSide.length, score };
  });
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
