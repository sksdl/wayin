import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
setup();
const { server } = await import('../server/index.js');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function client() {
  let cookie = '';
  return async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { ...(opts.headers || {}), cookie, 'Content-Type': 'application/json' } });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
}

test('each visitor gets their own class with two past units already looked back on', async () => {
  const a = client();
  const b = client();
  const sa = await (await a('/api/state')).json();
  await b('/api/state');
  assert.equal(sa.students.length, 18);
  assert.equal(sa.term.units.length, 2);
  assert.ok(sa.units.every((u) => u.plan && u.status === 'done'));
  assert.equal(sa.term.students.s_diego.units[0].status, 'not_enrolled');
  const r = await a('/api/students/s_sofia/seeds', { method: 'POST', body: JSON.stringify({ action: 'remove', name: 'Smile' }) });
  assert.equal(r.status, 200);
  const sb = await (await b('/api/state')).json();
  assert.ok(sb.students.find((x) => x.id === 's_sofia').seeds.some((s) => s.name === 'Smile'), 'b is not affected by a');
  assert.ok(sa.units.every((u) => u.seed_from_demo && /sample data/.test(u.plan.decision.reason)), 'past units are marked as sample data');
});

test('API calls without a session do not create workspaces', async () => {
  const res = await fetch(`${base}/api/students/s_maya/ranking`);
  assert.equal(res.status, 409);
  assert.equal(res.headers.get('set-cookie'), null);
  const h = await fetch(`${base}/api/health`);
  assert.equal(h.headers.get('set-cookie'), null);
});

test('a pick streams events and ends with a saved unit', async () => {
  const a = client();
  await a('/api/state');
  const res = await a('/api/plan', { method: 'POST', body: JSON.stringify({ title: 'Unit 3', teacher_note: 'Something lighter.' }) });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.type === 'event' && l.kind === 'qloo'));
  const result = lines.find((l) => l.type === 'result');
  assert.ok(result.unit.plan.chosen.name);
  assert.ok(!['Hatchet', 'The Giver'].includes(result.unit.plan.chosen.name), 'books already read are skipped');
  const state = await (await a('/api/state')).json();
  assert.ok(state.units.some((u) => u.id === result.unit.id && u.status === 'planned'));
});

test('security headers and safe errors', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const a = client();
  await a('/api/state');
  const bad = await a('/api/units/nope/debrief', { method: 'POST', body: '{}' });
  assert.equal(bad.status, 404);
  const trav = await fetch(`${base}/..%2f.env`);
  assert.notEqual((await trav.text()).includes('AZURE'), true);
});

test('student lookups do not use up the run limit', async () => {
  const a = client();
  await a('/api/state');
  for (let i = 0; i < 25; i++) {
    const r = await a('/api/students/s_maya/ranking');
    assert.equal(r.status, 200);
  }
  const j = await (await a('/api/students/s_maya/ranking')).json();
  assert.equal(j.of, 10, 'ranked among the unread books');
  assert.equal(j.read.length, 2);
});
