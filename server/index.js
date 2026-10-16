import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { Workspaces, newId } from './store.js';
import { termRecord } from './planner.js';
import { resolveStudent, resolveShortlist, shortlistBooks, classRanks, signalsOf, seedName, readBookIds, outsidePicks } from './profiles.js';
import { isWayIn } from './planner.js';
import { intake, plan, debrief } from './agent.js';
import { qlooStats } from './qloo.js';
import { modelStatus } from './llm.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const COOKIE = 'wayin_ws';
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  // Inline style attributes are allowed (the page sets avatar colors and spacing inline); scripts
  // are not, and every string from the server is HTML-escaped before rendering.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export const workspaces = new Workspaces(path.join(config.dataDir, 'workspaces'));
workspaces.sweep();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function cookieOf(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function wsCookie(id) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 3600}${secure}`;
}

// Behind Caddy the client address is the last X-Forwarded-For entry Caddy appended; directly it is
// the socket address. Only trust the header when the socket is local (the reverse proxy).
function clientIp(req) {
  const sock = req.socket.remoteAddress || '';
  const local = sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  if (local && xff) return String(xff).split(',').pop().trim();
  return sock;
}

// ---------- limits ----------
const hits = new Map(); // key -> timestamps
function within(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
const modelDay = { day: '', used: 0 };
// Returns false when today's model budget is spent; the run then uses fixed rules.
function modelBudget() {
  const today = new Date().toISOString().slice(0, 10);
  if (modelDay.day !== today) Object.assign(modelDay, { day: today, used: 0 });
  if (modelDay.used >= config.limits.modelRunsPerDay) return false;
  modelDay.used++;
  return true;
}
function checkRun(req) {
  if (!within(`run|${clientIp(req)}`, config.limits.runsPerIpPerHour, 3600_000)) throw new HttpError(429, 'This demo allows a limited number of runs per hour from one address. Please try again later.');
}
function checkLookup(req) {
  if (!within(`look|${clientIp(req)}`, config.limits.lookupsPerIpPerHour, 3600_000)) throw new HttpError(429, 'Too many lookups from this address. Please try again later.');
}
// One agent run at a time per workspace, so two tabs cannot write the same class at once.
const busy = new Set();
function lock(ws) {
  if (busy.has(ws.id)) throw new HttpError(409, 'Another run is still going for this class. Wait for it to finish.');
  busy.add(ws.id);
  return () => busy.delete(ws.id);
}

// Workspaces are created only when the app loads (GET /api/state). Other API calls need one.
function workspaceFor(req, res, { create = false } = {}) {
  const ws = workspaces.get(cookieOf(req, COOKIE));
  if (ws) return ws;
  if (!create) throw new HttpError(409, 'Your session expired. Reload the page.');
  if (!within(`ws|${clientIp(req)}`, config.limits.workspacesPerIpPerHour, 3600_000)) throw new HttpError(429, 'Too many new sessions from this address. Please try again later.');
  const fresh = workspaces.create();
  res.setHeader('Set-Cookie', wsCookie(fresh.id));
  return fresh;
}

// ---------- streaming ----------
// Agent runs stream newline-delimited JSON events so the page can show each Qloo call as it happens.
function stream(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...SECURITY_HEADERS });
  return (event) => res.write(JSON.stringify(event) + '\n');
}

// Model-backed runs per day for the whole demo. Past the cap a run still works, with fixed rules.
function modelAllowed(send) {
  if (config.aiMode !== 'azure-openai') return false;
  if (modelBudget()) return true;
  send({ type: 'event', kind: 'note', text: 'The demo reached its daily number of agent runs, so this run uses fixed rules.' });
  return false;
}

// ---------- view models ----------
function studentView(st) {
  const sig = signalsOf(st);
  return { ...st, seed_count: sig.seeds.length, needs_review: st.seeds.filter((s) => s.status === 'needs_review' || s.status === 'not_found').length };
}

function stateView(ws) {
  const ms = modelStatus();
  return {
    klass: ws.klass,
    students: ws.students.map(studentView),
    shortlist: ws.shortlist,
    units: [...ws.units].sort((a, b) => b.start.localeCompare(a.start)),
    term: termRecord(ws.students, ws.units),
    mode: { qloo: config.qlooMode, ai: config.aiMode, model: config.modelLabel, ai_available: config.aiMode === 'azure-openai' && ms.available, ai_reason: ms.reason },
  };
}

// The first two units in a fresh workspace were picked before Way In. Look back at them with Qloo
// once (who would have had a way in) and log plausible reactions, so the term record has something
// to show on the first visit.
const SAMPLE_REACTIONS = {
  u_1: { s_maya: 'not_engaged', s_jonah: 'not_engaged', s_amara: 'hooked', s_lucas: 'not_engaged', s_sofia: 'not_engaged', s_kenji: 'engaged', s_priya: 'engaged', s_ethan: 'not_engaged', s_zoe: 'engaged', s_malik: 'not_engaged', s_hana: 'engaged', s_owen: 'engaged', s_isabella: 'engaged', s_aiden: 'absent', s_grace: 'not_engaged', s_leo: 'hooked', s_nia: 'engaged' },
  u_2: { s_maya: 'not_engaged', s_jonah: 'not_engaged', s_amara: 'engaged', s_lucas: 'not_engaged', s_sofia: 'engaged', s_kenji: 'engaged', s_priya: 'hooked', s_ethan: 'not_engaged', s_zoe: 'not_engaged', s_malik: 'engaged', s_hana: 'engaged', s_owen: 'not_engaged', s_isabella: 'hooked', s_aiden: 'engaged', s_grace: 'not_engaged', s_leo: 'engaged', s_nia: 'engaged' },
};
const preparing = new Map();
async function prepareDemo(ws) {
  const todo = ws.units.filter((u) => u.seed_from_demo && !u.plan);
  const unresolved = ws.students.some((s) => s.seeds.some((x) => x.status === 'unresolved')) || ws.shortlist.some((b) => b.status === 'unresolved');
  if (!todo.length && !unresolved) return;
  if (preparing.has(ws.id)) return preparing.get(ws.id);
  const job = (async () => {
    await Promise.all(ws.students.map((st) => resolveStudent(st)));
    await resolveShortlist(ws);
    if (todo.length) {
      const students = ws.students.filter((st) => signalsOf(st).seeds.length);
      const ranks = await classRanks({ ...ws, units: [] }, students);
      for (const u of todo.sort((a, b) => a.start.localeCompare(b.start))) {
        const book = shortlistBooks(ws).find((b) => b.name === u.text_name);
        if (!book) continue;
        const k = ranks.ranked.k;
        const stud = {};
        const reactions = {};
        ws.students.forEach((st) => {
          const r = ranks.rankings[st.id]?.[book.entity_id];
          const wayIn = isWayIn(r, k);
          stud[st.id] = { rank: r?.rank ?? null, of: ranks.books.length, way_in: wayIn, via: wayIn && r.via ? seedName(st, r.via) : null, bridge: null, bridge_searched: false, no_favorites: !signalsOf(st).seeds.length };
          if (st.new_student) return; // joined after these units
          // Sample reactions: a fixed pattern for the demo, not derived from the Qloo ranks.
          reactions[st.id] = SAMPLE_REACTIONS[u.id]?.[st.id] || 'engaged';
        });
        u.plan = {
          k,
          shortlist_size: ranks.books.length,
          chosen: { entity_id: book.entity_id, name: book.name, year: book.year, author: book.author },
          decision: { by: 'teacher', reason: 'Picked by the teacher before using Way In. The ways in are Qloo looking back; bridge clips were not searched then. Reactions and notes in this unit are sample data for the demo.' },
          compared: [],
          ranking: ranks.ranked.rows.map((r) => ({ entity_id: r.entity_id, name: r.name, way_in: r.way_in.length, mean_rank: r.mean_rank })),
          students: stud,
          common_ground: [],
          doc: null,
        };
        u.requests = ranks.requests;
        u.reactions = reactions;
        u.roster = ws.students.filter((st) => !st.new_student).map((st) => st.id);
        const out = await debrief(ws, u, reactions, '', () => {}, { useModel: false }).catch(() => null);
        u.debrief = out ? { changes: out.changes, notes: out.notes, mode: 'rules' } : null;
        u.text = u.plan.chosen;
      }
    }
    workspaces.save(ws.id);
  })().finally(() => preparing.delete(ws.id));
  preparing.set(ws.id, job);
  return job;
}

function findStudent(ws, id) {
  const st = ws.students.find((x) => x.id === id);
  if (!st) throw new HttpError(404, 'No such student');
  return st;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = (re) => p.match(re);
  let mm;

  if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, qloo: qlooStats(), ai: config.aiMode, model: modelStatus() });

  if (req.method === 'GET' && p === '/api/state') {
    const ws = workspaceFor(req, res, { create: true });
    await prepareDemo(ws).catch((e) => console.error('demo prep:', e.message));
    return json(res, 200, stateView(ws));
  }

  const ws = workspaceFor(req, res);

  if (req.method === 'POST' && p === '/api/reset') {
    workspaces.reset(ws.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && (mm = m(/^\/api\/students\/([\w-]+)\/ranking$/))) {
    const st = findStudent(ws, mm[1]);
    checkLookup(req);
    const reqs = await resolveStudent(st);
    reqs.push(...(await resolveShortlist(ws)));
    const read = readBookIds(ws);
    const readTitle = new Map(ws.units.filter((u) => u.text?.entity_id).map((u) => [u.text.entity_id, u.title]));
    const all = shortlistBooks(ws);
    const unread = all.filter((b) => !read.has(b.entity_id));
    // The ranking is relative to the class, so the whole class is scored (cached after the first time).
    for (const other of ws.students) if (other.id !== st.id) reqs.push(...(await resolveStudent(other)));
    const cr = await classRanks(ws, ws.students.filter((x) => signalsOf(x).seeds.length), { skipRead: true });
    const ranking = cr.rankings[st.id] || {};
    reqs.push(...cr.requests.filter((r) => !r.cached));
    const o = await outsidePicks(st, all.map((b) => b.entity_id), 3);
    if (o.request) reqs.push({ ...o.request, label: `${st.first_name}: best books outside the list` });
    workspaces.save(ws.id);
    const rows = unread
      .map((b) => ({ ...b, rank: ranking[b.entity_id]?.rank ?? null, way_in: isWayIn(ranking[b.entity_id], cr.ranked.k), above: (ranking[b.entity_id]?.z ?? 0) > 0, via: ranking[b.entity_id]?.via ? seedName(st, ranking[b.entity_id].via) : null }))
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    const readRows = all.filter((b) => read.has(b.entity_id)).map((b) => ({ ...b, read_in: readTitle.get(b.entity_id) }));
    return json(res, 200, { rows, read: readRows, of: unread.length, outside: o.picks, requests: reqs });
  }

  if (req.method === 'POST' && (mm = m(/^\/api\/students\/([\w-]+)\/intake$/))) {
    const st = findStudent(ws, mm[1]);
    const body = await readJson(req);
    const text = str(body.text, 2000);
    if (!text) throw new HttpError(400, 'Paste the survey answer first');
    checkRun(req);
    const unlock = lock(ws);
    const send = stream(res);
    try {
      const out = await intake(ws, st, text, (e) => send({ type: 'event', ...e }), { useModel: modelAllowed(send) });
      workspaces.save(ws.id);
      send({ type: 'result', result: out, student: studentView(st) });
    } catch (e) {
      send({ type: 'error', message: publicMessage(e) });
    } finally {
      unlock();
    }
    return res.end();
  }

  if (req.method === 'POST' && (mm = m(/^\/api\/students\/([\w-]+)\/seeds$/))) {
    const st = findStudent(ws, mm[1]);
    const body = await readJson(req);
    const name = str(body.name, 200);
    const eid = str(body.entity_id, 80);
    if (body.action === 'choose') {
      const s = st.seeds.find((x) => x.name === name && x.status !== 'resolved');
      const c = s?.candidates?.find((x) => x.entity_id === eid);
      if (!c) throw new HttpError(400, 'Choose one of the listed matches');
      Object.assign(s, { status: 'resolved', entity_id: c.entity_id, matched_name: c.name, type: c.type || s.type, year: c.year });
      delete s.candidates;
      delete s.question;
    } else if (body.action === 'remove') {
      st.seeds = st.seeds.filter((x) => !(x.name === name && (eid ? x.entity_id === eid : true)));
    } else if (body.action === 'remove_avoid') {
      st.avoid = (st.avoid || []).filter((a) => a.label !== name);
    } else throw new HttpError(400, 'Unknown action');
    workspaces.save(ws.id);
    return json(res, 200, { student: studentView(st) });
  }

  if (req.method === 'POST' && p === '/api/plan') {
    const body = await readJson(req);
    const teacherNote = str(body.teacher_note, 600);
    const title = str(body.title, 80) || `Unit ${ws.units.length + 1}`;
    const start = body.start && !Number.isNaN(Date.parse(body.start)) ? new Date(body.start).toISOString() : new Date().toISOString();
    checkRun(req);
    const unlock = lock(ws);
    const send = stream(res);
    try {
      const out = await plan(ws, { teacherNote, title }, (e) => send({ type: 'event', ...e }), { useModel: modelAllowed(send) });
      const unit = { id: newId('u'), roster: ws.students.map((st) => st.id), title, start, end: new Date(Date.parse(start) + 25 * 24 * 3600 * 1000).toISOString(), status: 'planned', picked_by: 'way_in', teacher_note: teacherNote, text: out.plan.chosen, plan: out.plan, requests: out.requests, mode: out.mode, usage: out.usage, reactions: {}, created: new Date().toISOString() };
      ws.units.push(unit);
      workspaces.save(ws.id);
      send({ type: 'result', unit });
    } catch (e) {
      send({ type: 'error', message: publicMessage(e) });
    } finally {
      unlock();
    }
    return res.end();
  }

  if (req.method === 'POST' && (mm = m(/^\/api\/units\/([\w-]+)\/debrief$/))) {
    const unit = ws.units.find((x) => x.id === mm[1]);
    if (!unit || !unit.plan) throw new HttpError(404, 'No such unit');
    if (unit.status === 'done') throw new HttpError(409, 'This unit is already closed');
    const body = await readJson(req);
    const allowed = new Set(['hooked', 'engaged', 'not_engaged', 'absent']);
    const reactions = {};
    for (const st of ws.students) {
      const v = body.reactions?.[st.id];
      if (allowed.has(v)) reactions[st.id] = v;
    }
    if (!Object.keys(reactions).length) throw new HttpError(400, 'Log at least one student');
    const note = str(body.note, 1500);
    checkRun(req);
    const unlock = lock(ws);
    const send = stream(res);
    try {
      const out = await debrief(ws, unit, reactions, note, (e) => send({ type: 'event', ...e }), { useModel: modelAllowed(send) });
      Object.assign(unit, { reactions, teacher_note_after: note, status: 'done', end: new Date().toISOString(), debrief: { changes: out.changes, notes: out.notes, requests: out.requests, mode: out.mode } });
      workspaces.save(ws.id);
      send({ type: 'result', unit });
    } catch (e) {
      send({ type: 'error', message: publicMessage(e) });
    } finally {
      unlock();
    }
    return res.end();
  }

  throw new HttpError(404, 'Not found');
}

// Errors from our own checks and from Qloo are safe to show. Anything else is logged and replaced.
function publicMessage(e) {
  if (e instanceof HttpError || e.name === 'QlooError' || e.name === 'AiError' || /^(The shortlist|At least two)/.test(e.message)) return e.message;
  console.error(e);
  return 'Something went wrong on the server. Please try again.';
}

function serveStatic(res, p) {
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!path.extname(rel)) return serveStatic(res, '/');
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return serveStatic(res, url.pathname);
  } catch (e) {
    const status = e.status && e.status < 500 ? e.status : 500;
    if (res.headersSent) return res.end();
    json(res, status, { error: status >= 500 ? publicMessage(e) : e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) {
  server.listen(config.port, config.host, () => {
    console.log(`Way In on ${config.publicUrl} (listening ${config.host}:${config.port}) | Qloo: ${config.qlooMode} | AI: ${config.aiMode}${config.modelLabel ? ` (${config.modelLabel})` : ''}`);
  });
}
