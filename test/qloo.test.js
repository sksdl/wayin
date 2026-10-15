import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
setup();
const { normalizeEntity, search, insights, findTags, compare } = await import('../server/qloo.js');

test('insights entity: real type comes from subtype, explainability becomes a map', () => {
  const x = normalizeEntity({
    name: 'Holes', entity_id: 'AAA', type: 'urn:entity', subtype: 'urn:entity:movie',
    properties: { release_year: 2003, content_rating: 'PG', short_descriptions: [{ value: 'Ein Film', languages: ['de'] }, { value: 'A film', languages: ['en'] }] },
    tags: [{ id: 'urn:tag:genre:media:mystery', name: 'Mystery', type: 'urn:tag:genre:media' }],
    query: { affinity: 0.91, explainability: { 'signal.interests.entities': [{ entity_id: 'S1', score: 0.7 }, { entity_id: 'S2', score: 0.3 }] } },
  });
  assert.equal(x.type, 'movie');
  assert.equal(x.year, 2003);
  assert.equal(x.content_rating, 'PG');
  assert.equal(x.description, 'A film');
  assert.deepEqual(x.explain, { S1: 0.7, S2: 0.3 });
});

test('search entity: type from the types array, tag_id accepted, games map to videogame', () => {
  const x = normalizeEntity({ name: 'Minecraft', entity_id: 'B', types: ['urn:entity:videogame'], tags: [{ name: 'Sandbox', tag_id: 'urn:tag:x' }] });
  assert.equal(x.type, 'videogame');
  assert.equal(x.tags[0].id, 'urn:tag:x');
  assert.equal(normalizeEntity({ name: 'G', entity_id: 'C', subtype: 'urn:entity:video_game' }).type, 'videogame');
});

test('requests use the parameters the live API documents', async () => {
  const s = await search({ query: 'Holes', types: ['book'] });
  assert.match(s.request.query, /types=urn%3Aentity%3Abook/);
  const g = await search({ query: 'Minecraft', types: ['videogame'] });
  assert.match(g.request.query, /types=urn%3Aentity%3Avideogame/);
  const t = await findTags({ query: 'horror' });
  assert.equal(t.tags[0].id, 'urn:tag:genre:media:horror');
  assert.match(t.request.query, /filter.parents.types=urn%3Aentity%3Amovie%2Curn%3Aentity%3Atv_show/);

  const book = s.results[0].entity_id;
  const fav = g.results[0].entity_id;
  const ranked = await insights({ type: 'book', seeds: [fav], only: [book], explain: true, take: 1 });
  assert.match(ranked.request.query, /filter.results.entities=/);
  assert.equal(ranked.entities.length, 1);
  assert.equal(ranked.entities[0].entity_id, book);

  const clips = await insights({ type: 'movie', seeds: [book, fav], contentRatings: ['G', 'PG'], excludeTags: [t.tags[0].id], explain: true });
  assert.match(clips.request.query, /filter.content_rating=G%2CPG/);
  for (const c of clips.entities) {
    assert.ok(['G', 'PG'].includes(c.content_rating), `${c.name} ${c.content_rating}`);
    assert.ok(!c.tags.some((x) => x.id === t.tags[0].id), `${c.name} is not horror`);
  }

  const cmp = await compare({ a: [fav], b: [book] });
  assert.equal(cmp.request.path, '/v2/analysis/compare');
  assert.match(cmp.request.query, /a.signal.interests.entities=/);
});
