import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
setup();
const { topK, classRankings, isWayIn, rankTexts, pickBridge, termRecord, unitStatus } = await import('../server/planner.js');

const e = (id, affinity, explain = {}) => ({ entity_id: id, name: id, affinity, explain });

test('a way in is the top 3 of the unread list (fewer only when the list is tiny)', () => {
  assert.equal(topK(12), 3);
  assert.equal(topK(9), 3);
  assert.equal(topK(3), 2);
});

test('rankings are by fit over the class, not raw affinity, and keep the strongest seed', () => {
  // Everyone scores P highest (a popular book); s2 stands out on Q.
  const raw = {
    s1: [e('P', 0.9, { a: 1 }), e('Q', 0.5, { a: 1 }), e('x', 0.99)],
    s2: [e('P', 0.85, { b: 0.3, c: 0.7 }), e('Q', 0.8, { b: 0.9, c: 0.1 })],
    s3: [e('P', 0.88), e('Q', 0.45)],
  };
  const r = classRankings(raw, ['P', 'Q']);
  assert.equal(r.s2.Q.rank, 1, 'Q fits s2 far better than the class, so it ranks first for s2');
  assert.equal(r.s2.Q.via, 'b');
  assert.ok(r.s2.Q.z > 0);
  assert.equal(r.s1.x, undefined, 'books off the list are ignored');
  assert.ok(!isWayIn(r.s3.Q, 3) || r.s3.Q.z > 0, 'a way in needs a fit above the class average');
  assert.equal(isWayIn({ rank: 1, z: -0.2 }, 3), false);
  assert.equal(isWayIn({ rank: 3, z: 0.1 }, 3), true);
});

test('ranking counts ways in and weights students left out before', () => {
  const books = [{ entity_id: 'A', name: 'A' }, { entity_id: 'B', name: 'B' }, { entity_id: 'C', name: 'C' }, { entity_id: 'D', name: 'D' }, { entity_id: 'E', name: 'E' }];
  const rankings = {
    s1: { A: { rank: 1, z: 1 }, B: { rank: 3, z: 0.2 } },
    s2: { B: { rank: 1, z: 1 }, A: { rank: 4, z: -0.5 } },
    s3: { B: { rank: 2, z: 0.4 }, A: { rank: 5, z: -1 } },
  };
  const { k, rows } = rankTexts(books, rankings, { s1: 2 });
  assert.equal(k, 3);
  const A = rows.find((r) => r.entity_id === 'A');
  const B = rows.find((r) => r.entity_id === 'B');
  assert.deepEqual(A.way_in, ['s1']);
  assert.deepEqual(B.way_in, ['s1', 's2', 's3']);
  assert.equal(A.weighted, 2, 's1 counts double after missing two units');
  assert.equal(rows[0].entity_id, 'B');
  assert.deepEqual(A.priority_reached, ['s1']);
});

test('a bridge clip is the film both lists rank highest, within the student top 5', () => {
  const bookSide = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'].map((id) => e(id, null));
  const studentSide = [e('f7', 0.95), e('f3', 0.9), e('f1', 0.5), e('f6', 0.4), e('f5', 0.3), e('f2', 0.2), e('x', 0.99)];
  const b = pickBridge(bookSide, studentSide);
  assert.equal(b.entity_id, 'f1', 'book #1 + student #3 (4) beats book #3 + student #2 (5) and book #7 + student #1 (8)');
  assert.equal(b.book_rank, 1);
  assert.equal(b.student_rank, 3);
  assert.equal(pickBridge(bookSide, [e('x', 0.9)]), null, 'films off the book list do not count');
  assert.equal(pickBridge(bookSide, studentSide, { skip: ['f1'] }).entity_id, 'f3');
});

test('term record: absent and not enrolled are not counted; did-not-connect counts as missed', () => {
  const units = [
    { id: 'u1', start: '2026-09-01', status: 'done', roster: ['a', 'b', 'c'], reactions: { b: 'absent', c: 'not_engaged' }, plan: { students: { a: { way_in: true }, b: {}, c: { bridge: { name: 'X' } } } } },
    { id: 'u2', start: '2026-10-01', status: 'done', roster: ['a', 'b', 'c', 'd'], reactions: {}, plan: { students: { a: {}, b: {}, c: {}, d: {} } } },
  ];
  const students = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const t = termRecord(students, units);
  assert.deepEqual(t.students.a.units.map((u) => u.status), ['way_in', 'none']);
  assert.deepEqual(t.students.b.units.map((u) => u.status), ['absent', 'none']);
  assert.equal(t.students.b.left_out, 1);
  assert.equal(t.students.c.reached, 1);
  assert.equal(t.students.c.missed, 2, 'bridge but did not connect, then nothing');
  assert.equal(t.students.c.streak, 2);
  assert.equal(t.students.a.streak, 1);
  assert.equal(t.students.b.streak, 1, 'absent units are skipped, not counted');
  assert.equal(unitStatus(units[0], 'd'), 'not_enrolled');
});
