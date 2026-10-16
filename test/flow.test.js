// The whole loop on mock Qloo with AI off: survey, pick, close the unit, next pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
setup();
const { demoClass } = await import('../server/demo-data.js');
const { intake, plan, debrief, checkPlan, surveyPhrases } = await import('../server/agent.js');
const { resolveStudent, resolveShortlist } = await import('../server/profiles.js');

const ws = demoClass(new Date());
ws.units = []; // start without the demo history
const byId = (id) => ws.students.find((s) => s.id === id);

test('survey titles resolve to Qloo entities and dislikes to tags', async () => {
  for (const st of ws.students) await resolveStudent(st);
  await resolveShortlist(ws);
  assert.equal(byId('s_sofia').seeds.filter((s) => s.status === 'resolved').length, 4);
  assert.equal(byId('s_ethan').avoid[0].tag_id, 'urn:tag:genre:media:horror');
  assert.equal(ws.shortlist.filter((b) => b.status === 'resolved').length, 12);
});

test('title matching never sends a name from the class, a teacher or family to Qloo', () => {
  const st = { first_name: 'Diego', last_initial: 'M' };
  const classmates = ws.students;
  const p = surveyPhrases("I'm Diego Morales. I like Spider-Verse and Bad Bunny. My cousin Marco plays FC 24 with me. Me and Maya watch Wednesday. Ask Mr. Thompson. Jordan says Fortnite is better. I play Minecraft.", st, classmates);
  for (const bad of [/diego/i, /marco/i, /cousin/i, /maya/i, /thompson/i, /\bmr\b/i, /^jordan$/i]) assert.ok(!p.some((x) => bad.test(x)), `${bad} in ${p.join(' | ')}`);
  assert.ok(p.includes('Bad Bunny'), p.join(' | '));
  assert.ok(p.includes('Minecraft'), 'single word right after "play" is kept');
  assert.ok(p.length <= 10);
});

test('intake without a model reads titles and the dislike from a free-text survey', async () => {
  const d = byId('s_diego');
  const out = await intake(ws, d, d.survey);
  const names = d.seeds.map((s) => s.matched_name);
  assert.ok(names.includes('Olivia Rodrigo'), names.join(', '));
  assert.ok(names.includes('The Wild Robot'), names.join(', '));
  assert.ok(d.seeds.some((s) => s.status === 'needs_review' && s.name === 'FC 24'), 'near match goes to the teacher');
  assert.equal(out.mode, 'rules');
  assert.ok(d.avoid.some((a) => a.tag_id === 'urn:tag:genre:media:horror'));
});

let first;
test('a pick compares books, bridges students without a way in and respects ratings and dislikes', async () => {
  first = await plan(ws, { title: 'Unit 1' });
  const p = first.plan;
  assert.ok(p.compared.length >= 2, 'compared more than one book');
  assert.equal(p.decision.by, 'rules');
  const chosen = p.compared.find((c) => c.entity_id === p.chosen.entity_id);
  for (const c of p.compared) assert.ok(chosen.left_out <= c.left_out, 'chosen book leaves the fewest with nothing');
  for (const [sid, s] of Object.entries(p.students)) {
    if (s.bridge) {
      assert.ok(ws.klass.ratings.includes(s.bridge.content_rating), `${sid} bridge rating ${s.bridge.content_rating}`);
      assert.ok(!s.way_in, 'bridges only for students without a way in');
    }
    if (s.way_in) assert.ok(s.rank <= p.k);
  }
  assert.ok(!p.students.s_ethan.bridge || !/Stranger Things|Wednesday|Coraline/.test(p.students.s_ethan.bridge.name), 'no horror bridge for Ethan');
  for (const s of Object.values(p.students)) if (s.bridge) assert.ok(s.bridge.book_rank >= 1 && s.bridge.student_rank <= 5, 'bridge ranks recorded');
  assert.ok(p.clips.length <= 3, 'at most three clip films for the class');
  for (const s of Object.values(p.students)) if (s.bridge) assert.ok(p.clips.includes(s.bridge.entity_id));
  assert.ok(Array.isArray(p.lead_ins) && Array.isArray(p.book_tags));
});

test('closing a unit turns a hooked book into a favorite, and the next pick skips books already read', async () => {
  const unit = { id: 'u1', title: 'Unit 1', start: new Date().toISOString(), end: new Date().toISOString(), plan: first.plan, text: first.plan.chosen, status: 'planned' };
  ws.units.push(unit);
  const out = await debrief(ws, unit, { s_maya: 'hooked', s_jonah: 'not_engaged', s_lucas: 'absent' }, '');
  assert.ok(byId('s_maya').seeds.some((s) => s.entity_id === first.plan.chosen.entity_id && s.source === 'reaction'));
  assert.ok(!out.notes.some((n) => /^Maya\b/.test(n.note)), 'notes do not repeat the name');
  assert.equal(out.notes.length, 2, 'no note for the absent student');
  unit.status = 'done';
  const next = await plan(ws, { title: 'Unit 2' });
  assert.notEqual(next.plan.chosen.entity_id, first.plan.chosen.entity_id);
  assert.ok(!next.plan.ranking.some((r) => r.entity_id === first.plan.chosen.entity_id));
});

test('outside-list ideas leave out what the student asked to avoid', async () => {
  const { outsidePicks } = await import('../server/profiles.js');
  const e = byId('s_ethan');
  const o = await outsidePicks(e, [], 5);
  for (const b of o.picks) assert.ok(!/Coraline|Stranger|Five Nights/.test(b.name), b.name);
  assert.match(o.request.query, /filter.exclude.tags=urn%3Atag%3Agenre%3Amedia%3Ahorror/);
});

test('plan checks catch invented bridges and students without a way in', () => {
  const choice = { book_id: first.plan.chosen.entity_id };
  const bridges = Object.fromEntries(Object.entries(first.plan.students).map(([sid, s]) => [sid, s.bridge]));
  const row = { way_in: Object.entries(first.plan.students).filter(([, s]) => s.way_in).map(([sid]) => sid) };
  const cache = { [choice.book_id]: { row, bridges } };
  const noWay = Object.keys(first.plan.students).find((sid) => !row.way_in.includes(sid));
  const errs = checkPlan({ way_in_notes: [{ student_id: noWay, note: 'x' }], bridge_notes: [{ student_id: noWay, entity_id: 'made-up', note: 'x' }], discussion_starters: [], teacher_notes: [] }, choice, cache, ws.students);
  assert.ok(errs.some((e) => e.includes('has no way in')));
  assert.ok(errs.some((e) => /bridge/i.test(e)));
});

test('without the model, a teacher note that rules out a book is still honored', async () => {
  const top = (await plan(ws, { title: 'probe' })).plan.chosen;
  const out = await plan(ws, { title: 'Unit 3', teacherNote: `Skip ${top.name}, another class is reading it.` });
  assert.notEqual(out.plan.chosen.entity_id, top.entity_id);
  assert.match(out.plan.decision.reason, /checked for books to skip/);
});
