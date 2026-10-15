// npm run check: confirms the Qloo key and the Azure OpenAI deployment work, without printing
// either key. Makes three small Qloo calls (search, tags, insights with explainability) and one
// short model call.
import { config } from '../server/config.js';

const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => console.log(`  FAIL ${m}`);
let failed = false;

console.log(`Qloo: ${config.qlooMode}${config.qlooMode === 'live' ? ` (${config.qlooBase})` : ' (no QLOO_API_KEY, using mock data)'}`);
if (config.qlooMode === 'live') {
  const get = async (path, params) => {
    const res = await fetch(`${config.qlooBase}${path}?${new URLSearchParams(params)}`, { headers: { 'X-Api-Key': config.qlooKey } });
    const body = await res.json().catch(() => null);
    return { res, body };
  };
  try {
    const s = await get('/search', { query: 'Minecraft', types: 'urn:entity:videogame', take: '3' });
    if (!s.res.ok) throw new Error(`search HTTP ${s.res.status}: ${JSON.stringify(s.body).slice(0, 200)}`);
    const hit = s.body.results?.[0];
    ok(`search: "${hit?.name}" ${hit?.entity_id ? '(entity id received)' : ''}`);
    const lim = ['x-second-ratelimit-limit', 'x-month-ratelimit-limit', 'x-month-ratelimit-remaining'].map((h) => `${h}=${s.res.headers.get(h)}`).join(' ');
    ok(`rate limits: ${lim}`);
    const t = await get('/v2/tags', { 'filter.query': 'horror', 'filter.parents.types': 'urn:entity:movie,urn:entity:tv_show', take: '3' });
    if (!t.res.ok) throw new Error(`tags HTTP ${t.res.status}`);
    ok(`tags: ${(t.body.results?.tags || []).map((x) => x.id).join(', ')}`);
    const b = await get('/search', { query: 'Hatchet', types: 'urn:entity:book', take: '3' });
    const book = b.body.results?.[0];
    ok(`book search: "${book?.name}" (${book?.disambiguation || ''})`);
    const i = await get('/v2/insights', {
      'filter.type': 'urn:entity:book',
      'signal.interests.entities': hit.entity_id,
      'filter.results.entities': book.entity_id,
      'signal.demographics.age': '24_and_younger',
      'feature.explainability': 'true',
      take: '3',
    });
    if (!i.res.ok) throw new Error(`insights HTTP ${i.res.status}`);
    const e = i.body.results?.entities?.[0];
    ok(`insights with filter.results.entities: ${i.body.results?.entities?.length} result(s), "${e?.name}" affinity ${e?.query?.affinity}, explainability ${e?.query?.explainability ? 'present' : 'missing'}`);
    const m = await get('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': `${book.entity_id},${hit.entity_id}`, 'filter.content_rating': 'G,PG', 'feature.explainability': 'true', take: '3' });
    ok(`bridge films (G, PG): ${(m.body.results?.entities || []).map((x) => `${x.name} [${x.properties?.content_rating}]`).join(', ')}`);
    const tv = await get('/v2/insights', { 'filter.type': 'urn:entity:tv_show', 'signal.interests.entities': `${book.entity_id},${hit.entity_id}`, 'filter.content_rating': 'TV-Y7,TV-G,TV-PG', 'feature.explainability': 'true', take: '5' });
    const tvRatings = (tv.body.results?.entities || []).map((x) => x.properties?.content_rating);
    ok(`bridge TV (TV-Y7, TV-G, TV-PG): ${tvRatings.join(', ')}${tvRatings.some((r) => !['TV-Y7', 'TV-G', 'TV-PG'].includes(r)) ? '  <- filter not applied to TV ratings; the server re-checks' : ''}`);
    const c = await get('/v2/analysis/compare', { 'a.signal.interests.entities': hit.entity_id, 'b.signal.interests.entities': book.entity_id, take: '5' });
    ok(`compare: HTTP ${c.res.status}, shared tags: ${(c.body?.results?.tags || []).map((x) => x.name).join(', ') || 'none'}`);
  } catch (err) {
    failed = true;
    bad(`Qloo: ${err.message}`);
  }
}

console.log(`AI: ${config.aiMode}${config.modelLabel ? ` (${config.modelLabel})` : ''}`);
if (config.aiMode === 'azure-openai') {
  try {
    const { structured, S } = await import('../server/llm.js');
    const { data, meta } = await structured({ job: 'check', instructions: 'Reply with ok=true.', input: 'ping', schema: S.obj({ ok: S.bool }), maxTokens: 200 });
    if (data.ok !== true) throw new Error('unexpected reply');
    ok(`Azure OpenAI answered in ${meta.ms} ms (${meta.model})`);
  } catch (err) {
    failed = true;
    bad(`Azure OpenAI: ${err.message}`);
  }
}

process.exitCode = failed ? 1 : 0;
