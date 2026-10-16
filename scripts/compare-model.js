// npm run compare: the "Why this needs Qloo" table in the README. For five demo students it asks
// the model alone to rank the ten unread books from their favorites, reads Way In's ranking for
// the same students from a running server (so the right column is exactly what the app shows),
// and counts how many top-3 places the two share.
// usage: node scripts/compare-model.js [server URL, default http://localhost:8795] [--runs N]
import { structured, S } from '../server/llm.js';
import { config } from '../server/config.js';
import { baseTitle } from '../server/profiles.js';

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt >= 0 ? Math.max(1, Number(args[runsAt + 1]) || 1) : 1;
const base = (args.find((a, i) => !a.startsWith('--') && (runsAt < 0 || i !== runsAt + 1)) || 'http://localhost:8795').replace(/\/$/, '');
const IDS = ['s_nia', 's_kenji', 's_zoe', 's_sofia', 's_owen'];
if (!config.azure) throw new Error('Azure OpenAI is not configured in .env');

let cookie = '';
async function get(path) {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  if (!cookie) cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const state = await get('/api/state');
const rows = [];
for (const id of IDS) {
  const st = state.students.find((s) => s.id === id);
  const r = await get(`/api/students/${id}/ranking`);
  const favorites = st.seeds.filter((s) => s.status === 'resolved').map((s) => baseTitle(s.matched_name || s.name));
  const titles = r.rows.map((b) => baseTitle(b.name));
  const wayIn = r.rows.filter((b) => b.rank && b.rank <= 3).map((b) => ({ title: baseTitle(b.name), via: b.via, above: b.above }));
  rows.push({ name: st.first_name, favorites, titles, wayIn, model: [] });
}

for (let run = 0; run < runs; run++) {
  for (const row of rows) {
    const { data } = await structured({
      job: 'baseline',
      instructions: 'You are helping an 8th grade English teacher. Rank the given books from best to worst fit for this student, based only on the favorites listed. Return all titles exactly as given.',
      input: `Student favorites: ${row.favorites.join(', ')}\nBooks: ${row.titles.join('; ')}`,
      schema: S.obj({ ranking: S.arr(S.str) }),
    });
    const top = data.ranking.filter((t) => row.titles.includes(t)).slice(0, 3);
    row.model.push(top);
  }
}

const lead = (w) => `${w.title}${w.via ? ` (${w.via})` : ''}${w.above ? '' : ', below the class average'}`;
console.log('| Student | Favorites | GPT-6.1 alone, top 3 | Way In (fit over the class, favorite behind it) |');
console.log('|---|---|---|---|');
for (const row of rows) console.log(`| ${row.name} | ${row.favorites.join(', ')} | ${row.model[0].join(', ')} | ${row.wayIn.map(lead).join(', ')} |`);
for (let run = 0; run < runs; run++) {
  const shared = rows.reduce((n, row) => n + row.model[run].filter((t) => row.wayIn.some((w) => w.title === t)).length, 0);
  console.log(`run ${run + 1}: ${shared} of ${rows.length * 3} top-3 places shared`);
}
