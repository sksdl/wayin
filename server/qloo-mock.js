// Stand-in for the Qloo hackathon API, used before a key arrives and in tests.
// Response shapes follow what the live API returns (insights: results.entities with type
// "urn:entity" + subtype, query.affinity, query.explainability; search: flat results with a types
// array; tags: results.tags; compare: results.tags with query.score). Titles, years and content
// ratings are public facts. Every score, popularity value and tag below is made up for the mock
// and is not Qloo data. IDs are deterministic fake UUIDs.
import crypto from 'node:crypto';

const T = (slug) => ({ id: `urn:tag:genre:media:${slug}`, name: slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), type: 'urn:tag:genre:media' });

// [name, type, year, tags, rating]
const CATALOG = [
  // ---- books: an 8th grade shortlist ----
  ['The Outsiders', 'book', 1967, ['coming_of_age', 'friendship', 'family', 'gangs', 'underdog']],
  ['Hatchet', 'book', 1987, ['survival', 'adventure', 'nature', 'coming_of_age']],
  ['The Giver', 'book', 1993, ['dystopia', 'sci_fi', 'identity', 'coming_of_age']],
  ['Wonder', 'book', 2012, ['school', 'friendship', 'bullying', 'family', 'kindness']],
  ['Esperanza Rising', 'book', 2000, ['immigration', 'family', 'historical', 'farm_life']],
  ['Long Way Down', 'book', 2017, ['verse', 'grief', 'city', 'crime']],
  ['A Wrinkle in Time', 'book', 1962, ['sci_fi', 'fantasy', 'family', 'adventure']],
  ['Refugee', 'book', 2017, ['historical', 'war', 'immigration', 'survival', 'family']],
  ['New Kid', 'book', 2019, ['graphic_novel', 'school', 'comedy', 'identity', 'friendship']],
  ['The Crossover', 'book', 2014, ['verse', 'basketball', 'sports', 'family', 'underdog']],
  ['Holes', 'book', 1998, ['mystery', 'comedy', 'friendship', 'adventure']],
  ['The Westing Game', 'book', 1978, ['mystery', 'puzzle', 'comedy']],
  ['The Last Cuentista', 'book', 2021, ['sci_fi', 'dystopia', 'storytelling', 'space', 'family']],
  // ---- books students name ----
  ['The Lightning Thief', 'book', 2005, ['fantasy', 'mythology', 'adventure', 'comedy']],
  ['Diary of a Wimpy Kid', 'book', 2007, ['comedy', 'school', 'graphic_novel']],
  ['Wings of Fire', 'book', 2012, ['fantasy', 'dragons', 'adventure']],
  ['The Hunger Games', 'book', 2008, ['dystopia', 'survival', 'action', 'competition']],
  ['Heartstopper', 'book', 2019, ['romance', 'school', 'graphic_novel', 'friendship']],
  ["Harry Potter and the Sorcerer's Stone", 'book', 1997, ['fantasy', 'school', 'friendship', 'adventure']],
  ['Smile', 'book', 2010, ['graphic_novel', 'school', 'friendship', 'coming_of_age']],
  ['The Maze Runner', 'book', 2009, ['dystopia', 'survival', 'mystery', 'action']],
  ['Ghost', 'book', 2016, ['sports', 'coming_of_age', 'running', 'underdog']],
  ['Amari and the Night Brothers', 'book', 2021, ['fantasy', 'adventure', 'school', 'magic']],
  ['Brown Girl Dreaming', 'book', 2014, ['verse', 'memoir', 'family', 'storytelling']],

  // ---- TV ----
  ['Stranger Things', 'tv_show', 2016, ['sci_fi', 'horror', 'friendship', 'mystery', 'eighties'], 'TV-14'],
  ['Wednesday', 'tv_show', 2022, ['mystery', 'horror', 'comedy', 'school'], 'TV-14'],
  ['Avatar: The Last Airbender', 'tv_show', 2005, ['fantasy', 'adventure', 'friendship', 'war', 'family'], 'TV-Y7-FV'],
  ['One Piece', 'tv_show', 1999, ['anime', 'adventure', 'friendship', 'underdog'], 'TV-14'],
  ['Outer Banks', 'tv_show', 2020, ['mystery', 'adventure', 'friendship', 'treasure'], 'TV-MA'],
  ['Heartstopper', 'tv_show', 2022, ['romance', 'school', 'friendship'], 'TV-14'],
  ['Percy Jackson and the Olympians', 'tv_show', 2023, ['fantasy', 'mythology', 'adventure'], 'TV-PG'],
  ['The Mandalorian', 'tv_show', 2019, ['sci_fi', 'adventure', 'family', 'space'], 'TV-PG'],
  ['Abbott Elementary', 'tv_show', 2021, ['comedy', 'school', 'kindness'], 'TV-PG'],
  ['Cobra Kai', 'tv_show', 2018, ['sports', 'coming_of_age', 'underdog', 'gangs'], 'TV-14'],
  ['Ms. Marvel', 'tv_show', 2022, ['superhero', 'identity', 'family', 'coming_of_age'], 'TV-PG'],
  ['Alone', 'tv_show', 2015, ['survival', 'nature', 'reality'], 'TV-PG'],
  ['Gravity Falls', 'tv_show', 2012, ['mystery', 'comedy', 'fantasy', 'family', 'puzzle'], 'TV-Y7'],
  ['The Last of Us', 'tv_show', 2023, ['survival', 'horror', 'post_apocalyptic', 'family'], 'TV-MA'],
  ['Naruto', 'tv_show', 2002, ['anime', 'friendship', 'underdog', 'coming_of_age'], 'TV-PG'],
  ['Never Have I Ever', 'tv_show', 2020, ['comedy', 'school', 'family', 'coming_of_age', 'identity', 'grief'], 'TV-14'],
  ['Bluey', 'tv_show', 2018, ['family', 'comedy', 'kindness'], 'TV-Y'],
  ['The Owl House', 'tv_show', 2020, ['fantasy', 'identity', 'friendship', 'school'], 'TV-Y7'],

  // ---- films ----
  ['Spider-Man: Across the Spider-Verse', 'movie', 2023, ['superhero', 'identity', 'family', 'coming_of_age', 'city'], 'PG'],
  ['Encanto', 'movie', 2021, ['family', 'fantasy', 'music', 'magic'], 'PG'],
  ['Coco', 'movie', 2017, ['family', 'music', 'grief', 'storytelling'], 'PG'],
  ['The Hunger Games', 'movie', 2012, ['dystopia', 'survival', 'action', 'competition'], 'PG-13'],
  ['Dune', 'movie', 2021, ['sci_fi', 'survival', 'space', 'coming_of_age'], 'PG-13'],
  ['The Outsiders', 'movie', 1983, ['coming_of_age', 'friendship', 'gangs', 'family'], 'PG'],
  ['Holes', 'movie', 2003, ['mystery', 'comedy', 'friendship', 'adventure'], 'PG'],
  ['Wonder', 'movie', 2017, ['school', 'family', 'friendship', 'kindness', 'bullying'], 'PG'],
  ['A Wrinkle in Time', 'movie', 2018, ['sci_fi', 'fantasy', 'family'], 'PG'],
  ['The Giver', 'movie', 2014, ['dystopia', 'sci_fi', 'identity'], 'PG-13'],
  ['A Cry in the Wild', 'movie', 1990, ['survival', 'nature', 'adventure'], 'PG'],
  ['Stand by Me', 'movie', 1986, ['coming_of_age', 'friendship', 'adventure', 'grief'], 'R'],
  ['The Goonies', 'movie', 1985, ['adventure', 'friendship', 'treasure', 'eighties'], 'PG'],
  ['Remember the Titans', 'movie', 2000, ['sports', 'friendship', 'underdog', 'football'], 'PG'],
  ['Akeelah and the Bee', 'movie', 2006, ['school', 'underdog', 'competition', 'words'], 'PG'],
  ['The Maze Runner', 'movie', 2014, ['dystopia', 'survival', 'mystery', 'action'], 'PG-13'],
  ['The Martian', 'movie', 2015, ['survival', 'sci_fi', 'space'], 'PG-13'],
  ['Moana', 'movie', 2016, ['adventure', 'family', 'music', 'nature'], 'PG'],
  ['Knives Out', 'movie', 2019, ['mystery', 'comedy', 'puzzle'], 'PG-13'],
  ['Enola Holmes', 'movie', 2020, ['mystery', 'adventure', 'family', 'puzzle'], 'PG-13'],
  ['The Mitchells vs. the Machines', 'movie', 2021, ['comedy', 'family', 'sci_fi'], 'PG'],
  ['Black Panther', 'movie', 2018, ['superhero', 'family', 'identity', 'technology'], 'PG-13'],
  ['Spirited Away', 'movie', 2001, ['anime', 'fantasy', 'coming_of_age', 'family'], 'PG'],
  ['The Wild Robot', 'movie', 2024, ['survival', 'nature', 'family', 'sci_fi'], 'PG'],
  ['Nimona', 'movie', 2023, ['fantasy', 'identity', 'friendship'], 'PG'],
  ['Jumanji: Welcome to the Jungle', 'movie', 2017, ['gaming', 'adventure', 'comedy', 'survival'], 'PG-13'],
  ['Ready Player One', 'movie', 2018, ['gaming', 'sci_fi', 'dystopia', 'eighties'], 'PG-13'],
  ['The Super Mario Bros. Movie', 'movie', 2023, ['gaming', 'comedy', 'adventure'], 'PG'],
  ['A Minecraft Movie', 'movie', 2025, ['gaming', 'comedy', 'adventure', 'survival'], 'PG'],
  ['Coach Carter', 'movie', 2005, ['basketball', 'sports', 'school', 'underdog'], 'PG-13'],
  ['Hidden Figures', 'movie', 2016, ['historical', 'space', 'math', 'underdog'], 'PG'],
  ['The Breakfast Club', 'movie', 1985, ['school', 'friendship', 'coming_of_age', 'eighties'], 'R'],
  ['Life of Pi', 'movie', 2012, ['survival', 'adventure', 'nature', 'family'], 'PG'],
  ['Hamilton', 'movie', 2020, ['musical', 'historical', 'hip_hop', 'verse'], 'PG-13'],
  ['In the Heights', 'movie', 2021, ['musical', 'hip_hop', 'family', 'city', 'immigration'], 'PG-13'],
  ['Selena', 'movie', 1997, ['music', 'family', 'biography'], 'PG'],
  ['Coraline', 'movie', 2009, ['fantasy', 'horror', 'family'], 'PG'],
  ['Rise of the Guardians', 'movie', 2012, ['fantasy', 'adventure', 'friendship'], 'PG'],

  // ---- artists ----
  ['Olivia Rodrigo', 'artist', 2021, ['music', 'coming_of_age', 'heartbreak']],
  ['Taylor Swift', 'artist', 2006, ['music', 'storytelling', 'coming_of_age', 'heartbreak']],
  ['Bad Bunny', 'artist', 2016, ['music', 'reggaeton', 'dance']],
  ['BTS', 'artist', 2013, ['music', 'k_pop', 'friendship']],
  ['NewJeans', 'artist', 2022, ['music', 'k_pop']],
  ['Karol G', 'artist', 2010, ['music', 'reggaeton', 'dance']],
  ['Lin-Manuel Miranda', 'artist', 2008, ['musical', 'hip_hop', 'historical', 'verse']],
  ['Beyoncé', 'artist', 1997, ['music', 'family', 'performance']],
  ['Billie Eilish', 'artist', 2015, ['music', 'coming_of_age', 'grief']],

  // ---- games ----
  ['Minecraft', 'videogame', 2011, ['gaming', 'survival', 'adventure', 'creativity']],
  ['Fortnite', 'videogame', 2017, ['gaming', 'survival', 'competition', 'action']],
  ['The Legend of Zelda: Tears of the Kingdom', 'videogame', 2023, ['gaming', 'fantasy', 'adventure']],
  ['Pokémon Scarlet and Violet', 'videogame', 2022, ['gaming', 'adventure', 'anime', 'friendship']],
  ['Roblox', 'videogame', 2006, ['gaming', 'creativity', 'friendship']],
  ['The Last of Us Part I', 'videogame', 2022, ['gaming', 'survival', 'horror', 'post_apocalyptic']],
  ['EA Sports FC 24', 'videogame', 2023, ['gaming', 'sports', 'soccer', 'competition']],
  ['NBA 2K24', 'videogame', 2023, ['gaming', 'sports', 'basketball', 'competition']],
  ['Stardew Valley', 'videogame', 2016, ['gaming', 'nature', 'creativity', 'family']],
  ['Animal Crossing: New Horizons', 'videogame', 2020, ['gaming', 'kindness', 'creativity', 'nature']],
  ["Five Nights at Freddy's", 'videogame', 2014, ['gaming', 'horror', 'mystery']],
  ['Hollow Knight', 'videogame', 2017, ['gaming', 'fantasy', 'adventure']],

  // ---- people ----
  ['MrBeast', 'person', 1998, ['competition', 'comedy', 'kindness']],
  ['Rick Riordan', 'person', 1964, ['fantasy', 'mythology', 'adventure']],
  ['Jason Reynolds', 'person', 1983, ['verse', 'sports', 'city', 'running']],
];

function fakeUuid(s) {
  const h = crypto.createHash('md5').update(`wayin-mock|${s}`).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const ENTITIES = CATALOG.map(([name, type, year, tags, rating]) => ({ name, type, year, tags, rating, entity_id: fakeUuid(`${type}|${name}`) }));
const BY_ID = new Map(ENTITIES.map((e) => [e.entity_id, e]));
const pseudo = (s) => parseInt(crypto.createHash('md5').update(s).digest('hex').slice(0, 6), 16) / 0xffffff;
const TYPE_ALIAS = { video_game: 'videogame' };
const shortType = (t) => {
  const s = String(t || '').replace('urn:entity:', '');
  return TYPE_ALIAS[s] || s;
};

function wire(e, extraQuery) {
  const properties = { short_descriptions: [{ value: `Mock entry for ${e.name}.`, languages: ['en'] }] };
  if (e.type === 'artist') properties.start_year = e.year;
  if (e.type === 'movie' || e.type === 'tv_show') Object.assign(properties, { release_year: e.year, release_date: `${e.year}-01-01`, content_rating: e.rating });
  if (e.type === 'book') properties.publication_year = e.year;
  if (e.type === 'videogame') properties.release_date = `${e.year}-01-01`;
  if (e.type === 'person') properties.date_of_birth = `${e.year}-01-01`;
  return {
    name: e.name,
    entity_id: e.entity_id,
    type: 'urn:entity',
    subtype: `urn:entity:${e.type}`,
    popularity: 0.55 + 0.44 * pseudo(`pop|${e.entity_id}`),
    disambiguation: e.type === 'movie' ? String(e.year) : '',
    properties,
    tags: e.tags.map(T),
    external: {},
    ...(extraQuery ? { query: extraQuery } : {}),
  };
}

function similarity(a, b) {
  const A = new Set(a.tags);
  const inter = b.tags.filter((t) => A.has(t)).length;
  if (!inter) return 0;
  return inter / new Set([...a.tags, ...b.tags]).size;
}

const list = (v) => (v == null || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));
const norm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

function search(params) {
  const q = norm(params.query || '');
  const types = list(params.types).map(shortType);
  const take = Number(params.take || 10);
  const scored = ENTITIES.filter((e) => !types.length || types.includes(e.type))
    .map((e) => {
      const n = norm(e.name);
      const s = n === q ? 1 : n.startsWith(q) || q.startsWith(n) ? 0.8 : n.includes(q) || q.includes(n) ? 0.6 : q.split(' ').filter((w) => w.length > 2 && n.includes(w)).length * 0.2;
      return { e, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, take);
  return {
    results: scored.map(({ e }) => {
      const w = wire(e);
      delete w.type;
      delete w.subtype;
      return { ...w, types: [`urn:entity:${e.type}`], tags: e.tags.map((t) => ({ name: T(t).name, tag_id: T(t).id, type: T(t).type, value: T(t).id })) };
    }),
  };
}

function tags(params) {
  const q = norm(params['filter.query'] || '');
  const all = [...new Set(ENTITIES.flatMap((e) => e.tags))];
  const hits = all.filter((t) => norm(t.replace(/_/g, ' ')).includes(q) || q.includes(norm(t.replace(/_/g, ' '))));
  return {
    duration: 12,
    success: true,
    results: { tags: hits.slice(0, Number(params.take || 20)).map((t) => ({ ...T(t), parents: [{ type: 'urn:entity:movie' }, { type: 'urn:entity:tv_show' }], popularity: 0.9, properties: {}, tags: [] })) },
  };
}

function insights(params) {
  const type = shortType(params['filter.type']);
  if (!['artist', 'movie', 'tv_show', 'book', 'person', 'brand', 'place', 'podcast', 'videogame'].includes(type)) {
    const err = new Error(`You do not have permission to access ${params['filter.type']}`);
    err.status = 403;
    throw err;
  }
  const seeds = list(params['signal.interests.entities']).map((id) => BY_ID.get(id)).filter(Boolean);
  const only = new Set(list(params['filter.results.entities']));
  const exclude = new Set(list(params['filter.exclude.entities']));
  const excludeTags = new Set(list(params['filter.exclude.tags']));
  const ratings = new Set(list(params['filter.content_rating']));
  const take = Number(params.take || 20);
  const explain = String(params['feature.explainability']) === 'true';

  const rows = ENTITIES.filter((e) => e.type === type && !exclude.has(e.entity_id))
    .filter((e) => !only.size || only.has(e.entity_id))
    .filter((e) => !e.tags.some((t) => excludeTags.has(T(t).id)))
    .filter((e) => !ratings.size || (e.rating && ratings.has(e.rating)))
    .map((e) => {
      const per = seeds.map((s) => ({ entity_id: s.entity_id, sim: similarity(s, e) }));
      const total = per.reduce((a, b) => a + b.sim, 0);
      return { e, per, total };
    })
    // A results filter asks for affinity toward the listed entities, so keep weak matches too.
    .filter((x) => !seeds.length || x.total > 0 || only.size)
    .sort((a, b) => b.total - a.total || a.e.name.localeCompare(b.e.name))
    .slice(0, take);
  const max = rows[0]?.total || 1;
  return {
    success: true,
    results: {
      entities: rows.map(({ e, per, total }) => {
        const query = { affinity: seeds.length ? 0.3 + 0.68 * (total / max) * (0.9 + 0.1 * pseudo(`aff|${e.entity_id}`)) : null, measurements: { audience_growth: 0 } };
        if (explain && total > 0) {
          query.explainability = {
            'signal.interests.entities': per
              .filter((p) => p.sim > 0)
              .map((p) => ({ entity_id: p.entity_id, score: p.sim / total }))
              .sort((a, b) => b.score - a.score),
          };
        }
        return wire(e, query);
      }),
    },
  };
}

// Analysis compare: tags the two signal groups share, with a score.
function compare(params) {
  const a = list(params['a.signal.interests.entities']).map((id) => BY_ID.get(id)).filter(Boolean);
  const b = list(params['b.signal.interests.entities']).map((id) => BY_ID.get(id)).filter(Boolean);
  const count = (group) => {
    const c = {};
    group.forEach((e) => e.tags.forEach((t) => (c[t] = (c[t] || 0) + 1)));
    return c;
  };
  const ca = count(a);
  const cb = count(b);
  const shared = Object.keys(ca)
    .filter((t) => cb[t])
    .map((t) => ({ t, score: Math.min(1, (ca[t] / Math.max(a.length, 1)) * 2) * 0.6 + 0.35 * pseudo(`cmp|${t}`) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, Number(params.take || 10));
  const side = (c) => Object.entries(c).map(([t, n]) => ({ tag_id: T(t).id, name: T(t).name, type: 'urn:tag', subtype: T(t).type, query: { count: String(n) } }));
  return {
    duration: 9,
    results: {
      tags: shared.map(({ t, score }) => ({ tag_id: T(t).id, name: T(t).name, type: 'urn:tag', subtype: T(t).type, popularity: 0.9, query: { score } })),
      a: side(ca),
      b: side(cb),
      matchEntities: [],
    },
  };
}

export function mockQloo(path, params) {
  if (path === '/search') return search(params);
  if (path === '/v2/tags') return tags(params);
  if (path === '/v2/insights') return insights(params);
  if (path === '/v2/analysis/compare') return compare(params);
  const err = new Error(`Mock has no ${path}`);
  err.status = 404;
  throw err;
}

export const MOCK_ENTITIES = ENTITIES;
