import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
setup();
const { topK, studentRanking, rankTexts, pickBridge, termRecord, unitStatus } = await import('../server/planner.js');

const e = (id, affinity, explain = {}) => ({ entity_id: id, name: id, affinity, explain });

test('a way in is the top 3 of the unread list (fewer only when the list is tiny)', () => {
  assert.equal(topK(12), 3);
  assert.equal(topK(9), 3);
  assert.equal(topK(3), 2);
});

test('a student ranking orders the shortlist by Qloo affinity and keeps the strongest seed', () => {
  const r = studentRanking([e('b2', 0.4), e('b1', 0.9, { s1: 0.2, s2: 0.8 }), e('x', 0.99)], ['b1', 'b2']);
  assert.deepEqual(Object.keys(r), ['b1', 'b2']);
  assert.equal(r.b1.rank, 1);
  assert.equal(r.b1.via, 's2');
  assert.equal(r.x, undefined, 'books off the list are ignored');
});

test('ranking counts ways in and weights students left out before', () => {
  const books = [{ entity_id: 'A', name: 'A' }, { entity_id: 'B', name: 'B' }, { entity_id: 'C', name: 'C' }, { entity_id: 'D', name: 'D' }, { entity_id: 'E', name: 'E' }];
  const rankings = {
    s1: { A: { rank: 1 }, B: { rank: 3 } },
    s2: { B: { rank: 1 }, A: { rank: 4 } },
    s3: { B: { rank: 2 }, A: { rank: 5 } },
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

test('a bridge needs both the book and the student behind it', () => {
  const cands = [
    e('onlyBook', 0.9, { BOOK: 0.95, s1: 0.05 }),
    e('onlyStudent', 0.9, { BOOK: 0.1, s1: 0.9 }),
    e('both', 0.7, { BOOK: 0.5, s1: 0.3, s2: 0.2 }),
  ];
  const b = pickBridge(cands, 'BOOK', ['s1', 's2']);
  assert.equal(b.entity_id, 'both');
  assert.equal(b.student_share, 0.5);
  assert.equal(pickBridge([cands[0], cands[1]], 'BOOK', ['s1']), null);
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
