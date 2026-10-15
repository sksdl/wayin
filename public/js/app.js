// Way In front end. No framework: hash routes, one render function per page.

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $foot = document.getElementById('side-foot');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const joinNames = (n) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);

const ICONS = {
  artist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  movie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v14M17 5v14M2 12h20"/></svg>',
  tv_show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="m8 3 4 4 4-4"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  videogame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.6 4.6 4.5"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
};
const TYPE_LABEL = { artist: 'Music', movie: 'Film', tv_show: 'TV', book: 'Book', person: 'Creator', videogame: 'Game' };
const SOURCE_LABEL = { survey: 'from the survey', reaction: 'loved in class', teacher: 'from a teacher note' };
const STATUS_LABEL = { way_in: 'Way in', bridge: 'Bridge clip', none: 'Nothing', absent: 'Absent', not_enrolled: 'Not in class yet', nofav: 'No favorites yet' };
const COLORS = ['#2f5d50', '#b8642f', '#5a6f9a', '#8a5a83', '#6b7d3a', '#a0523d', '#3d7480', '#7a6340', '#4f6b5c'];
const colorOf = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const avatar = (p, sm) => `<span class="avatar${sm ? ' sm' : ''}" style="background:${colorOf(p.id)}">${esc((p.first_name || '?')[0])}</span>`;
const typeIcon = (t) => ICONS[t] || ICONS.spark;
const student = (id) => STATE.students.find((s) => s.id === id);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function getJson(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
// Agent runs stream one JSON object per line.
async function postStream(url, body, onEvent) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'event') onEvent(ev);
      else if (ev.type === 'error') throw new Error(ev.message);
      else if (ev.type === 'result') result = ev;
    }
  }
  if (!result) throw new Error('The run ended without a result');
  return result;
}

// ---------- trace and requests ----------
function prettyQuery(q) {
  return [...new URLSearchParams(q || '')].map(([k, v]) => `${k}=${v.length > 120 ? `${v.slice(0, 117)}…` : v}`).join('  ');
}
function traceRow(ev) {
  if (ev.kind === 'qloo') {
    const q = ev.request || {};
    const tag = q.cached ? ' (cached)' : q.mock ? ' (mock)' : '';
    return `<div class="t-row"><span class="t-kind q">Qloo</span><span>${q.label ? `<span class="t-label">${esc(q.label)}</span> · ` : ''}<span class="t-path">${esc(q.method)} ${esc(q.path)}${tag}</span><br><span class="t-q">${esc(prettyQuery(q.query))}</span></span></div>`;
  }
  if (ev.kind === 'model') return `<div class="t-row"><span class="t-kind">Agent</span><span>step ${ev.step + 1} · ${(ev.ms / 1000).toFixed(1)} s</span></div>`;
  if (ev.kind === 'tool_call') return `<div class="t-row"><span class="t-kind">Tool</span><span>${esc(ev.name)}(${esc(JSON.stringify(ev.args || {}).slice(0, 200))})</span></div>`;
  if (ev.kind === 'tool_result') {
    const r = ev.result || {};
    let s = r.error ? `error: ${r.error}` : 'ok';
    if (r.books) s = r.books.slice(0, 4).map((b) => `${b.title}: ${b.way_in} ways in`).join(' · ');
    else if (r.bridged) s = `${r.title}: ${r.way_in} ways in, ${r.bridged.length} bridged, left out: ${r.still_left_out.join(', ') || 'nobody'}`;
    else if (r.shared_tags) s = `shared: ${r.shared_tags.join(', ') || 'none'}`;
    else if (r.results) s = `${r.results.length} results${r.results[0] ? `, top: ${r.results[0].name}` : ''}`;
    else if (r.tags) s = `${r.tags.length} tags${r.tags[0] ? `, top: ${r.tags[0].name}` : ''}`;
    else if (r.students) s = `${r.students.length} students, ${r.shortlist.length} books`;
    return `<div class="t-row"><span class="t-kind n">Result</span><span>${esc(s)}</span></div>`;
  }
  if (ev.kind === 'note') return `<div class="t-row"><span class="t-kind n">Note</span><span>${esc(ev.text)}</span></div>`;
  return '';
}
function reqList(reqs) {
  if (!reqs?.length) return '<div class="empty">No Qloo requests recorded.</div>';
  return `<div class="reqs">${reqs.map((q) => `<div class="req"><b>${esc(q.label || '')}</b><br>${esc(q.method)} ${esc(q.path)}<br>${esc(prettyQuery(q.query))}${q.cached ? ' <i>(cached)</i>' : ''}</div>`).join('')}</div>`;
}

// ---------- shell ----------
let STATE = null;
async function loadState() {
  STATE = await getJson('/api/state');
  return STATE;
}

function renderNav(route) {
  const items = [
    ['#/', 'This term', ICONS.today, route === 'today'],
    ['#/students', 'Students', ICONS.people, route === 'students' || route === 'student'],
    ['#/plan', 'Pick the next read', ICONS.plan, route === 'plan'],
    ['#/units', 'Units', ICONS.list, route === 'units' || route === 'unit'],
  ];
  $nav.innerHTML = items.map(([href, label, ico, on]) => `<a href="${href}" class="${on ? 'on' : ''}">${ico}<span>${label}</span></a>`).join('');
  const m = STATE?.mode || {};
  const ai = m.ai_available ? `<span class="badge teal"><span class="dot"></span>${esc(m.model || 'AI on')}</span>` : m.ai === 'azure-openai' ? '<span class="badge clay" title="The model is not answering; runs use fixed rules"><span class="dot"></span>AI paused</span>' : '<span class="badge"><span class="dot"></span>AI off</span>';
  $foot.innerHTML = `
    <div>${esc(STATE?.klass?.name || '')}<br>${esc(STATE?.klass?.school || '')}</div>
    <div class="row"><span class="badge ${m.qloo === 'live' ? 'teal' : 'clay'}"><span class="dot"></span>Qloo ${m.qloo === 'live' ? 'live' : 'mock data'}</span>${ai}</div>
    <div>All students are fictional. Your changes stay in your own copy.</div>
    <button class="btn small ghost" id="reset">Reset demo data</button>`;
  document.getElementById('reset').onclick = async () => {
    if (!confirm('Reset the class to the starting demo data?')) return;
    await postJson('/api/reset');
    toast('Demo data reset');
    location.hash = '#/';
    await loadState();
    route_();
  };
}

const seedChip = (s, removable) => {
  const cls = s.status !== 'resolved' ? 'review' : s.source === 'reaction' ? 'reaction' : s.source === 'teacher' ? 'staff' : '';
  const title = s.status === 'resolved' ? `${TYPE_LABEL[s.type] || s.type}${s.year ? `, ${s.year}` : ''} · ${SOURCE_LABEL[s.source] || ''}` : 'Needs a check';
  return `<span class="chip ${cls}" title="${esc(title)}">${typeIcon(s.type)}${esc(s.matched_name || s.name)}${removable ? `<button data-remove="${esc(s.name)}" data-eid="${esc(s.entity_id || '')}" aria-label="Remove">×</button>` : ''}</span>`;
};
const statusChip = (status, extra = '') => `<span class="st ${status}">${esc(STATUS_LABEL[status] || status)}${extra}</span>`;

// ---------- pages ----------
function pageToday() {
  const S = STATE;
  const planned = S.units.filter((u) => u.status === 'planned');
  const nextNo = S.units.length + 1;
  const newcomer = S.students.find((s) => s.new_student);
  const todo = S.students.filter((s) => s.new_student || s.needs_review || s.seed_count < 2);
  const units = S.term.units;
  const recs = S.students.map((st) => ({ st, r: S.term.students[st.id] }));
  const streak = recs.filter(({ r }) => r.streak >= 2);
  const unitCounts = units.map((u, i) => {
    const present = recs.filter(({ r }) => !['absent', 'not_enrolled'].includes(r.units[i]?.status));
    const reached = present.filter(({ r }) => ['way_in', 'bridge'].includes(r.units[i]?.status));
    return `${esc(u.text)}: ${reached.length} of ${present.length} reached`;
  });
  const anySample = units.some((u) => u.sample);
  return `
  <div class="page-head">
    <div><h1>${esc(S.klass.name)}</h1><div class="sub">${esc(S.klass.school)} · ${S.students.length} students · ${esc(S.klass.term)}</div></div>
    <a class="btn primary" href="#/plan">${ICONS.plan} Pick the next read</a>
  </div>

  <div class="callout no-print" style="margin-bottom:18px">
    <h3>New here? Try the whole loop in three steps</h3>
    <ol class="steps">
      <li><div><b>Read a survey.</b> ${newcomer ? `${esc(newcomer.first_name)} transferred in this week and answered the interest survey in a few lines.` : 'Every student has a profile now.'} The agent finds each title in Qloo and notes what to keep away from. <a href="#/students/${newcomer?.id || 's_diego'}">Open ${esc(newcomer?.first_name || 'Diego')}’s profile</a></div></li>
      <li><div><b>Pick the next class read.</b> Qloo ranks the department’s approved list for every student. The agent compares the top books, finds a bridge clip (a film or show) for students a book doesn’t reach, and explains its choice. <a href="#/plan">Pick the Unit ${nextNo} read</a></div></li>
      <li><div><b>Close the unit.</b> Mark who was hooked and who didn’t connect. Both change the next pick.${planned[0] ? ` <a href="#/units/${planned[0].id}">Open ${esc(planned[0].title)}</a>` : ''}</div></li>
    </ol>
  </div>

  <div class="grid cols-main">
    <section class="card">
      <div class="card-head"><h2>Who had a way in this term?</h2><span class="tiny">${esc(unitCounts.join(' · '))}</span></div>
      <p class="small muted" style="margin-bottom:10px">Way in: the class book was in the student’s own top 3 of the unread approved books. Bridge clip: a film or show Qloo ties to both the book and the student’s favorites. Students who had nothing, or had something and didn’t connect, count extra in the next pick.</p>
      ${anySample ? '<p class="tiny" style="margin-bottom:10px">Units 1 and 2 were picked before Way In. Their ways in are Qloo looking back; the reactions in them are sample data for the demo.</p>' : ''}
      ${streak.length ? `<div class="coverage warn" style="margin-bottom:10px">${ICONS.alert}<span>${streak.length} student${streak.length > 1 ? 's' : ''} missed the last ${Math.min(...streak.map(({ r }) => r.streak))} or more units in a row: ${esc(joinNames(streak.map(({ st }) => st.first_name)))}. The next pick counts them extra.</span></div>` : ''}
      <div class="table-wrap"><table class="term"><thead><tr><th>Student</th>${units.map((u) => `<th>${esc(u.text)}${u.sample ? ' <span class="tiny">(sample)</span>' : ''}</th>`).join('')}<th>Favorites</th></tr></thead><tbody>
      ${recs
        .map(({ st, r }) => `<tr class="${r.streak >= 2 ? 'flag' : ''}"><td><a href="#/students/${st.id}" class="row nowrap" style="gap:8px;color:inherit">${avatar(st, true)}${esc(st.first_name)} ${esc(st.last_initial)}.</a></td>${r.units.map((u) => `<td>${statusChip(u.status, u.reaction === 'not_engaged' && u.status !== 'none' ? ' · didn’t connect' : '')}</td>`).join('')}<td class="tiny">${st.seed_count}</td></tr>`)
        .join('')}</tbody></table></div>
    </section>
    <div class="grid">
      <section class="card">
        <div class="card-head"><h2>Coming up</h2><a class="small" href="#/plan">Pick a read</a></div>
        ${planned.length ? planned.map(unitRow).join('') : `<div class="empty">Unit ${nextNo} has no book yet.</div>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>Profiles to finish</h2></div>
        ${todo.length ? `<div class="stack">${todo.map((st) => `<a class="row nowrap" style="color:inherit" href="#/students/${st.id}">${avatar(st, true)}<span><b>${esc(st.first_name)}</b> <span class="small muted">${st.new_student ? 'new this week, survey not read yet' : st.needs_review ? `${st.needs_review} title${st.needs_review > 1 ? 's' : ''} to confirm` : `only ${st.seed_count} favorite${st.seed_count === 1 ? '' : 's'}`}</span></span></a>`).join('')}</div>` : '<div class="empty">Every student has favorites on file.</div>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Approved list</h2><span class="tiny">${S.shortlist.length} books</span></div>
        <div class="chips">${S.shortlist.map((b) => `<span class="chip" title="${esc(b.author || '')}">${ICONS.book}${esc(b.matched_name || b.name)}</span>`).join('')}</div>
      </section>
    </div>
  </div>`;
}

function unitRow(u) {
  return `<a class="row between" style="text-decoration:none;color:inherit;padding:10px 0;border-top:1px solid var(--line-2)" href="#/units/${u.id}">
    <span><b>${esc(u.title)}</b><br><span class="small muted">${esc(u.text?.name || 'No book yet')} · from ${fmtDate(u.start)}</span></span>
    <span class="badge ${u.status === 'done' ? '' : 'teal'}">${u.status === 'done' ? 'Closed' : 'Planned'}</span></a>`;
}

function pageStudents() {
  const S = STATE;
  return `<div class="page-head"><div><h1>Students</h1><div class="sub">Favorites come from the interest survey, from books they loved in class and from teacher notes.</div></div></div>
  <div class="grid cols-3">${S.students
    .map((st) => {
      const r = S.term.students[st.id];
      return `<a class="card student-card" href="#/students/${st.id}">
      <div class="student-top">${avatar(st)}<div><h3>${esc(st.first_name)} ${esc(st.last_initial)}.</h3><div class="small muted">${st.seed_count} favorites${st.needs_review ? ` · ${st.needs_review} to confirm` : ''}</div></div></div>
      <div class="chips">${st.seeds.slice(0, 4).map((s) => seedChip(s)).join('') || '<span class="small muted">Survey not read yet</span>'}${st.seeds.length > 4 ? `<span class="chip">+${st.seeds.length - 4}</span>` : ''}</div>
      <div class="row" style="gap:6px">${r.units.map((u) => statusChip(u.status)).join('')}</div>
      ${st.new_student ? '<span class="badge clay">New this week · survey not read</span>' : ''}
    </a>`;
    })
    .join('')}</div>`;
}

function pageStudent(id) {
  const st = student(id);
  if (!st) return '<div class="err">Student not found.</div>';
  const review = st.seeds.filter((s) => s.status === 'needs_review' || s.status === 'not_found');
  const r = STATE.term.students[st.id];
  return `
  <div class="page-head">
    <div class="row">${avatar(st)}<div><h1>${esc(st.first_name)} ${esc(st.last_initial)}.</h1><div class="sub">${esc(STATE.klass.name)}</div></div></div>
    <div class="row">${r.units.map((u, i) => `<span class="tiny">${esc(STATE.term.units[i].text)}</span>${statusChip(u.status)}`).join('')}</div>
  </div>
  <div class="grid cols-main">
    <div class="grid">
      <section class="card">
        <div class="card-head"><h2>Interest survey</h2><span class="tiny">Read by the agent, matched in Qloo</span></div>
        <textarea id="survey">${esc(st.survey || '')}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="read">${ICONS.spark} Read survey with the agent</button><span class="small muted" id="read-status"></span></div>
        <div id="intake-out" style="margin-top:12px"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>How the approved list ranks for ${esc(st.first_name)}</h2></div>
        <p class="small muted" style="margin-bottom:10px">Qloo scores each unread approved book against ${esc(st.first_name)}’s favorites. A book in the top 3 is a way in.</p>
        <div id="ranking"><div class="empty"><span class="spinner dark"></span> Asking Qloo…</div></div>
      </section>
    </div>
    <div class="grid">
      <section class="card">
        <div class="card-head"><h2>Favorites</h2><span class="tiny">${st.seed_count} in Qloo</span></div>
        <div class="chips">${st.seeds.filter((s) => s.status === 'resolved').map((s) => seedChip(s, true)).join('') || '<span class="empty">None yet. Read the survey.</span>'}</div>
        <div class="row tiny" style="margin-top:12px;gap:8px">Color shows where it came from: <span class="badge">survey</span><span class="badge teal">loved in class</span><span class="badge sky">teacher note</span></div>
        ${review.length ? `<div class="sep"></div><h3 style="margin:8px 0">Please confirm</h3>${review.map(reviewBlock).join('')}` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2>Keep away from</h2></div>
        ${(st.avoid || []).length ? `<div class="chips">${st.avoid.map((a) => `<span class="chip avoid" title="${esc(a.reason || '')}">${esc(a.label)}${a.tag_name ? ` · Qloo tag “${esc(a.tag_name)}”` : ''}<button data-avoid="${esc(a.label)}" aria-label="Remove">×</button></span>`).join('')}</div><p class="tiny" style="margin-top:8px">Bridges for ${esc(st.first_name)} never carry these tags.</p>` : '<div class="empty">Nothing noted.</div>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Notes</h2></div>
        ${(st.history || []).length ? `<div class="stack">${[...st.history].reverse().slice(0, 8).map((h) => `<div class="note-card"><div class="tiny">${fmtDate(h.at)} · ${h.kind === 'intake' ? 'Survey read' : 'Unit note'}</div><div class="small">${esc(h.text)}</div></div>`).join('')}</div>` : '<div class="empty">No notes yet.</div>'}
      </section>
    </div>
  </div>`;
}

function reviewBlock(s) {
  if (s.status === 'not_found') return `<div class="note-card small" style="margin-bottom:8px">“${esc(s.name)}” was not found in Qloo. <button class="btn small ghost" data-remove="${esc(s.name)}" data-eid="">Remove</button></div>`;
  return `<div class="note-card" style="margin-bottom:8px"><div class="small"><b>“${esc(s.name)}”</b> ${esc(s.question || 'Which one did the student mean?')}</div>
    <div class="row" style="margin-top:6px">${(s.candidates || []).map((c) => `<button class="btn small" data-choose="${esc(s.name)}" data-eid="${esc(c.entity_id)}">${typeIcon(c.type)} ${esc(c.name)}${c.year ? ` (${c.year})` : ''}</button>`).join('')}
    <button class="btn small ghost" data-remove="${esc(s.name)}" data-eid="">None of these</button></div></div>`;
}

async function wireStudent(id) {
  const st = student(id);
  if (!st) return;
  const act = async (body) => {
    try {
      await postJson(`/api/students/${id}/seeds`, body);
      await loadState();
      route_();
    } catch (e) {
      toast(e.message);
    }
  };
  $app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => act({ action: 'remove', name: b.dataset.remove, entity_id: b.dataset.eid || undefined })));
  $app.querySelectorAll('[data-choose]').forEach((b) => (b.onclick = () => act({ action: 'choose', name: b.dataset.choose, entity_id: b.dataset.eid })));
  $app.querySelectorAll('[data-avoid]').forEach((b) => (b.onclick = () => act({ action: 'remove_avoid', name: b.dataset.avoid })));

  document.getElementById('read').onclick = async () => {
    const btn = document.getElementById('read');
    const out = document.getElementById('intake-out');
    btn.disabled = true;
    document.getElementById('read-status').innerHTML = '<span class="spinner dark"></span> The agent is reading the survey';
    out.innerHTML = '<div class="trace" id="trace"></div>';
    const $t = document.getElementById('trace');
    try {
      const res = await postStream(`/api/students/${id}/intake`, { text: document.getElementById('survey').value }, (ev) => {
        $t.insertAdjacentHTML('beforeend', traceRow(ev));
        $t.scrollTop = $t.scrollHeight;
      });
      const x = res.result;
      const keep = $t.outerHTML;
      await loadState();
      await route_();
      document.getElementById('read-status').textContent = `${x.added.length} favorite${x.added.length === 1 ? '' : 's'} added${x.pending.length ? `, ${x.pending.length} to confirm` : ''}${x.avoid.length ? `, ${x.avoid.length} to keep away from` : ''}.`;
      document.getElementById('intake-out').innerHTML = `<details class="why"><summary>What the agent did (${x.requests.length} Qloo requests)</summary>${keep}</details>`;
    } catch (e) {
      out.insertAdjacentHTML('beforeend', `<div class="err" style="margin-top:8px">${esc(e.message)}</div>`);
      document.getElementById('read-status').textContent = '';
      btn.disabled = false;
    }
  };

  try {
    const j = await getJson(`/api/students/${id}/ranking`);
    const el = document.getElementById('ranking');
    if (!el) return;
    el.innerHTML = j.rows.some((r) => r.rank)
      ? `<div class="rank-list">${j.rows
          .map((b) => `<div class="rank-row ${b.rank && b.rank <= 3 ? 'top' : ''}"><span class="rank-no">${b.rank ?? '–'}</span><span>${esc(b.name)}${b.via && b.rank <= 3 ? ` <span class="tiny">via ${esc(b.via)}</span>` : ''}</span><span class="tiny">${b.year || ''}</span></div>`)
          .join('')}</div>
        ${j.read?.length ? `<p class="tiny" style="margin-top:8px">Already read in class: ${j.read.map((b) => `${esc(b.name)} (${esc(String(b.read_in).split(':')[0])})`).join(', ')}</p>` : ''}
        ${j.outside?.length ? `<div class="sep"></div><h3 style="margin:8px 0 4px">Outside the list</h3><p class="tiny" style="margin-bottom:6px">Qloo’s strongest books for ${esc(st.first_name)} from all books. Ideas for independent reading, and a check on how well the approved list fits.</p><div class="chips">${j.outside.map((b) => `<span class="chip">${ICONS.book}${esc(b.name)}${b.via ? ` <span class="tiny">via ${esc(b.via)}</span>` : ''}</span>`).join('')}</div>` : ''}
        <details class="why"><summary>Qloo requests (${j.requests.length})</summary>${reqList(j.requests)}</details>`
      : `<div class="empty">${st.seed_count ? 'Qloo returned no scores for this list.' : 'Read the survey first.'}</div>`;
  } catch (e) {
    const el = document.getElementById('ranking');
    if (el) el.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

function pagePlan() {
  const S = STATE;
  const n = S.units.length + 1;
  const start = new Date(Date.now() + 4 * 24 * 3600 * 1000);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const noFav = S.students.filter((s) => !s.seed_count);
  return `
  <div class="page-head"><div><h1>Pick the next read</h1><div class="sub">Qloo ranks the approved list for each student. The agent compares the strongest books, finds bridges for students without a way in, and picks the book that leaves the fewest students out.</div></div></div>
  <div class="grid cols-main">
    <section class="card">
      <div class="grid cols-2">
        <label class="field">Unit title<input type="text" id="title" value="Unit ${n}"></label>
        <label class="field">Starts<input type="date" id="start" value="${local}"></label>
      </div>
      <label class="field" style="margin-top:12px">Note for the agent (optional)<textarea id="note" placeholder="For example: we just read two serious books, so something with more humor would be good. Or: skip Refugee, the 7th grade team is reading it."></textarea></label>
      ${noFav.length ? `<div class="coverage warn" style="margin-top:12px">${ICONS.alert}<span>${esc(joinNames(noFav.map((s) => s.first_name)))} ${noFav.length > 1 ? 'have' : 'has'} no favorites on file, so the pick cannot include them yet. <a href="#/students/${noFav[0].id}">Read the survey first</a>.</span></div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="go">${ICONS.spark} Pick with the agent</button><span class="small muted" id="go-status"></span></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>What it works from</h2></div>
      <div class="stack small">
        <div><b>${S.shortlist.length} approved books</b>, minus the ones this class already read<div class="chips" style="margin-top:6px">${S.shortlist.map((b) => { const read = S.units.find((u) => u.text?.entity_id && u.text.entity_id === b.entity_id); return `<span class="chip" ${read ? 'style="opacity:.55;text-decoration:line-through"' : ''}>${esc(b.matched_name || b.name)}</span>`; }).join('')}</div></div>
        <div><b>${S.students.length} students</b>, ${S.students.reduce((a, s) => a + s.seed_count, 0)} favorites in Qloo</div>
        <div><b>Bridge clips allowed:</b> ${S.klass.ratings.map(esc).join(', ')}</div>
        <div><b>Students left out of earlier units count extra.</b></div>
      </div>
    </section>
  </div>
  <section class="card" id="run" hidden style="margin-top:18px">
    <div class="card-head"><h2>Agent at work</h2><span class="tiny" id="run-count"></span></div>
    <div class="trace" id="trace"></div>
  </section>`;
}

function wirePlan() {
  document.getElementById('go').onclick = async () => {
    const btn = document.getElementById('go');
    btn.disabled = true;
    document.getElementById('go-status').innerHTML = '<span class="spinner dark"></span> Working. This takes about a minute.';
    const run = document.getElementById('run');
    run.hidden = false;
    run.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const $t = document.getElementById('trace');
    $t.innerHTML = '';
    let q = 0;
    try {
      const startVal = document.getElementById('start').value;
      const res = await postStream('/api/plan', { title: document.getElementById('title').value, teacher_note: document.getElementById('note').value, start: startVal ? new Date(`${startVal}T08:00:00`).toISOString() : undefined }, (ev) => {
        if (ev.kind === 'qloo') document.getElementById('run-count').textContent = `${++q} Qloo requests`;
        $t.insertAdjacentHTML('beforeend', traceRow(ev));
        $t.scrollTop = $t.scrollHeight;
      });
      await loadState();
      location.hash = `#/units/${res.unit.id}`;
    } catch (e) {
      run.insertAdjacentHTML('beforeend', `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`);
      document.getElementById('go-status').textContent = '';
      btn.disabled = false;
    }
  };
}

function pageUnits() {
  return `<div class="page-head"><div><h1>Units</h1></div><a class="btn primary" href="#/plan">${ICONS.plan} Pick the next read</a></div>
  <section class="card">${STATE.units.map(unitRow).join('') || '<div class="empty">No units yet.</div>'}</section>`;
}

const RX = ['', 'engaged', 'hooked', 'not_engaged', 'absent'];
const RX_LABEL = { '': 'Tap', hooked: 'Hooked', engaged: 'Kept up', not_engaged: 'Didn’t connect', absent: 'Absent' };
const typeWord = (t) => (t === 'movie' ? 'film' : t === 'tv_show' ? 'show' : t);

function pageUnit(id) {
  const u = STATE.units.find((x) => x.id === id);
  if (!u) return '<div class="err">Unit not found.</div>';
  if (!u.plan) return '<div class="empty"><span class="spinner dark"></span> Preparing…</div>';
  const p = u.plan;
  const doc = p.doc;
  const done = u.status === 'done';
  const studs = STATE.students.filter((st) => !u.roster || u.roster.includes(st.id));
  const counts = { way_in: 0, bridge: 0, none: 0 };
  studs.forEach((st) => {
    const s = p.students[st.id];
    if (!s || s.no_favorites) return;
    counts[s.way_in ? 'way_in' : s.bridge ? 'bridge' : 'none']++;
  });
  const teacherPicked = u.picked_by === 'teacher';
  const noFav = studs.filter((st) => p.students[st.id]?.no_favorites);
  const byId = (sid, list) => (list || []).find((n) => n.student_id === sid);
  return `
  <div class="page-head">
    <div><div class="tiny">${esc(u.title)} · from ${fmtDate(u.start)}</div><h1>${esc(p.chosen.name)}</h1>
      <div class="row" style="margin-top:6px"><span class="muted">${esc(p.chosen.author || '')}${p.chosen.year ? ` · ${p.chosen.year}` : ''}</span>
      <span class="badge ${p.decision.by === 'agent' ? 'teal' : ''}">${p.decision.by === 'agent' ? 'Picked by the agent' : p.decision.by === 'teacher' ? 'Picked before Way In' : 'Picked with fixed rules'}</span></div></div>
    <div class="row no-print"><button class="btn" id="print">${ICONS.print} Print plan</button></div>
  </div>
  <div class="grid cols-main">
    <div class="grid">
      <section class="card">
        <div class="coverage ${counts.none ? 'warn' : ''}">${counts.none ? ICONS.alert : ICONS.check}<span>${teacherPicked ? `Looking back: ${counts.way_in} of ${counts.way_in + counts.none} students had a way in.` : `${counts.way_in} students have a way in, ${counts.bridge} get a bridge clip, ${counts.none ? `${counts.none} still have nothing` : 'nobody is left with nothing'}.`}${noFav.length ? ` ${noFav.length} student${noFav.length > 1 ? 's have' : ' has'} no favorites yet.` : ''}</span></div>
        <div class="reason" style="margin-top:12px"><b>Why this book.</b> ${esc(p.decision.reason)}
          ${p.compared?.length ? `<table class="cmp"><thead><tr><th>Book</th><th>Way in</th><th>Bridged</th><th>Nothing</th></tr></thead><tbody>${p.compared.map((c) => `<tr class="${c.entity_id === p.chosen.entity_id ? 'on' : ''}"><td>${esc(c.name)}</td><td>${c.way_in}</td><td>${c.bridged}</td><td>${c.left_out}</td></tr>`).join('')}</tbody></table>` : ''}
        </div>
      </section>
      ${weekBox(u, studs)}
      <section class="card">
        <div class="card-head"><h2>Every student’s way in</h2><span class="tiny">rank = place in their own Qloo ranking of ${p.shortlist_size} books</span></div>
        <div class="roster">${studs
          .map((st) => {
            const s = p.students[st.id] || {};
            const wn = byId(st.id, doc?.way_in_notes);
            const bn = byId(st.id, doc?.bridge_notes);
            let what;
            if (s.no_favorites) what = `${statusChip('nofav')}<span>No favorites on file yet. <a href="#/students/${st.id}">Read the survey</a></span>`;
            else if (s.way_in) what = `${statusChip('way_in', ` · #${s.rank} of ${s.of}`)}<span>${esc(wn?.note || (s.via ? `via ${s.via}` : ''))}</span>`;
            else if (s.bridge) what = `${statusChip('bridge')}<span>${typeIcon(s.bridge.type)} <b>${esc(s.bridge.name)}</b> <span class="tiny">${esc(s.bridge.content_rating || '')}${s.bridge.year ? ` · ${s.bridge.year}` : ''}</span></span><span>${esc(bn?.note || (s.bridge.via ? `connects ${s.bridge.via} to the book` : ''))}</span>${s.bridge.shared_tags?.length ? `<span class="tiny">shares with the book: ${esc(s.bridge.shared_tags.join(', '))}</span>` : ''}`;
            else if (s.bridge_searched === false) what = `${statusChip('none', s.rank ? ` · #${s.rank} of ${s.of}` : '')}<span class="tiny">Bridge clips were not searched (picked before Way In).</span>`;
            else what = `${statusChip('none', s.rank ? ` · #${s.rank} of ${s.of}` : '')}<span>No bridge clip found. Plan a one-to-one check-in.${s.outside ? ` Independent-reading idea: <b>${esc(s.outside.name)}</b>${s.outside.via ? ` (via ${esc(s.outside.via)})` : ''}.` : ''}</span>`;
            return `<div class="roster-row"><a class="who" href="#/students/${st.id}" style="text-decoration:none;color:inherit">${avatar(st, true)}${esc(st.first_name)}</a><div class="what">${what}</div></div>`;
          })
          .join('')}</div>
      </section>
      ${doc ? `<section class="card"><div class="card-head"><h2>Day one</h2></div><p>${esc(doc.opening)}</p>
        ${p.common_ground?.length ? `<p class="tiny" style="margin-top:8px">Common ground from Qloo compare (class favorites vs. this book): ${esc(p.common_ground.map((t) => t.name).join(', '))}</p>` : ''}
        ${doc.discussion_starters?.length ? `<h3 style="margin:14px 0 6px">Discussion starters</h3><ul class="prompts">${doc.discussion_starters.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    </div>
    <div class="grid">
      ${doc?.teacher_notes?.length ? `<section class="card"><div class="card-head"><h2>Teacher notes</h2></div><ul style="margin:0;padding-left:18px;display:grid;gap:6px" class="small">${doc.teacher_notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
      <section class="card">
        <div class="card-head"><h2>Whole list, this class</h2></div>
        <table class="cmp"><thead><tr><th>Book</th><th>Ways in</th><th>Avg rank</th></tr></thead><tbody>${p.ranking.map((r) => `<tr class="${r.entity_id === p.chosen.entity_id ? 'on' : ''}"><td>${esc(r.name)}</td><td>${r.way_in}</td><td>${r.mean_rank ?? '–'}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card no-print">
        <div class="card-head"><h2>Qloo requests</h2><span class="tiny">${u.requests?.length || 0}</span></div>
        <details class="why"><summary>Show the exact requests behind this plan</summary>${reqList(u.requests)}</details>
      </section>
    </div>
  </div>
  <section class="card no-print" style="margin-top:18px">
    <div class="card-head"><h2>Close the unit</h2>${done ? '<span class="badge">Closed</span>' : ''}</div>
    <p class="small muted" style="margin-bottom:10px">${done ? `How each student took the book.${u.seed_from_demo ? ' Sample data for the demo.' : ''}` : 'Tap each student: kept up, hooked (finished early or asked for more), didn’t connect, absent. A book a student was hooked by becomes one of their favorites; a student who didn’t connect counts extra in the next pick.'}</p>
    <div class="rx-list">${studs.map((st) => {
      const v = u.reactions?.[st.id] || '';
      return `<div class="rx-item"><span class="row" style="gap:8px">${avatar(st, true)}${esc(st.first_name)}</span><button class="rx ${v}" data-s="${st.id}" data-v="${v}" ${done ? 'disabled' : ''}>${RX_LABEL[v]}</button></div>`;
    }).join('')}</div>
    ${done ? '' : `<div class="row" style="margin-top:8px"><button class="btn small ghost" id="quick-fill">Mark everyone not yet tapped as “Kept up”</button></div>
    <label class="field" style="margin-top:12px">Teacher note (optional)<textarea id="t-note" placeholder="For example: Lucas said they would rather read something like Ghost by Jason Reynolds. Nia read ahead after the bridge clip."></textarea></label>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="save-rx">${ICONS.check} Close the unit and update profiles</button><span class="small muted" id="rx-status"></span></div>`}
    <div id="rx-out" style="margin-top:12px">${done ? debriefView(u) : ''}</div>
  </section>`;
}

// What the teacher needs to prepare this week: the clips to queue (grouped by title), who to
// check in with one to one, and what to keep away from.
function weekBox(u, studs) {
  const p = u.plan;
  if (!p || u.picked_by === 'teacher' || u.status === 'done') return '';
  const clips = new Map();
  const checkIns = [];
  for (const st of studs) {
    const s = p.students[st.id];
    if (!s || s.no_favorites) continue;
    if (s.bridge) {
      const key = s.bridge.entity_id;
      if (!clips.has(key)) clips.set(key, { b: s.bridge, who: [] });
      clips.get(key).who.push(st.first_name);
    } else if (!s.way_in) checkIns.push(st.first_name);
  }
  const avoid = studs.flatMap((st) => (st.avoid || []).map((a) => `${st.first_name}: ${a.label}`));
  const noFav = studs.filter((st) => p.students[st.id]?.no_favorites).map((st) => st.first_name);
  return `<section class="card week">
    <div class="card-head"><h2>This week</h2><span class="tiny">what to prepare before chapter 1</span></div>
    <div class="grid cols-2">
      <div><h3>Clips to queue</h3>${clips.size ? `<ul class="plain">${[...clips.values()].map(({ b, who }) => `<li>${typeIcon(b.type)} <b>${esc(b.name)}</b> <span class="tiny nowrap">${esc(typeWord(b.type))} · ${esc(b.content_rating || '')}</span><br><span class="small muted">for ${esc(joinNames(who))}</span></li>`).join('')}</ul>` : '<div class="empty">None needed.</div>'}</div>
      <div><h3>One-to-one check-ins</h3>${checkIns.length || noFav.length ? `<ul class="plain small">${checkIns.map((n) => `<li>${esc(n)}: no way in or clip</li>`).join('')}${noFav.map((n) => `<li>${esc(n)}: no favorites yet, read the survey</li>`).join('')}</ul>` : '<div class="empty">Nobody.</div>'}
        ${avoid.length ? `<h3 style="margin-top:12px">Keep away from</h3><ul class="plain small">${avoid.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</div>
    </div>
  </section>`;
}

function debriefView(u) {
  const d = u.debrief;
  if (!d) return '';
  const name = (id) => student(id)?.first_name || id;
  return `${d.changes?.length ? `<h3 style="margin-bottom:6px">Profile changes</h3><div class="changes">${d.changes.map((c) => `<div class="change">${avatar({ id: c.student_id, first_name: name(c.student_id) }, true)}<span><b>${esc(name(c.student_id))}</b>: ${esc(c.change)}</span></div>`).join('')}</div>` : ''}
    ${d.notes?.length ? `<h3 style="margin:12px 0 6px">Notes</h3><div class="rx-list">${d.notes.map((n) => `<div class="note-card small"><b>${esc(name(n.student_id))}</b>: ${esc(n.note.replace(new RegExp(`^${name(n.student_id)}:?\\s+`), ''))}</div>`).join('')}</div>` : ''}`;
}

function wireUnit(id) {
  document.getElementById('print')?.addEventListener('click', () => window.print());
  const u = STATE.units.find((x) => x.id === id);
  if (!u || u.status === 'done' || !u.plan) return;
  const rx = {};
  const set = (b, v) => {
    b.dataset.v = v;
    b.className = `rx ${v}`;
    b.textContent = RX_LABEL[v];
    rx[b.dataset.s] = v;
  };
  $app.querySelectorAll('.rx-item .rx').forEach((b) => (b.onclick = () => set(b, RX[(RX.indexOf(b.dataset.v) + 1) % RX.length])));
  document.getElementById('quick-fill').onclick = () => $app.querySelectorAll('.rx-item .rx').forEach((b) => !b.dataset.v && set(b, 'engaged'));
  document.getElementById('save-rx').onclick = async () => {
    const btn = document.getElementById('save-rx');
    btn.disabled = true;
    document.getElementById('rx-status').innerHTML = '<span class="spinner dark"></span> Updating profiles';
    const out = document.getElementById('rx-out');
    out.innerHTML = '<div class="trace" id="trace"></div>';
    const $t = document.getElementById('trace');
    try {
      await postStream(`/api/units/${id}/debrief`, { reactions: rx, note: document.getElementById('t-note').value }, (ev) => $t.insertAdjacentHTML('beforeend', traceRow(ev)));
      await loadState();
      await route_();
      document.getElementById('rx-out')?.scrollIntoView({ block: 'start' });
      toast('Unit closed, profiles updated');
    } catch (e) {
      out.insertAdjacentHTML('beforeend', `<div class="err" style="margin-top:8px">${esc(e.message)}</div>`);
      btn.disabled = false;
      document.getElementById('rx-status').textContent = '';
    }
  };
}

// ---------- router ----------
async function route_() {
  const [path] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  if (!STATE) {
    try {
      await loadState();
    } catch (e) {
      $app.innerHTML = `<div class="err">Could not load: ${esc(e.message)}</div>`;
      return;
    }
  }
  let route = 'today';
  let html;
  if (!parts.length) html = pageToday();
  else if (parts[0] === 'students' && parts[1]) (route = 'student'), (html = pageStudent(parts[1]));
  else if (parts[0] === 'students') (route = 'students'), (html = pageStudents());
  else if (parts[0] === 'plan') (route = 'plan'), (html = pagePlan());
  else if (parts[0] === 'units' && parts[1]) (route = 'unit'), (html = pageUnit(parts[1]));
  else if (parts[0] === 'units') (route = 'units'), (html = pageUnits());
  else html = pageToday();
  renderNav(route);
  $app.innerHTML = html;
  window.scrollTo(0, 0);
  if (route === 'student') wireStudent(parts[1]);
  if (route === 'plan') wirePlan();
  if (route === 'unit') wireUnit(parts[1]);
}

window.addEventListener('hashchange', async () => {
  await loadState().catch(() => {});
  route_();
});
route_();
