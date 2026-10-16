// Qloo client. Live mode calls the hackathon API (GET, X-Api-Key header). Mock mode answers from
// server/qloo-mock.js with the same response shapes. Every response is cached on the server
// (data/qloo-cache, never committed), which Qloo's hackathon FAQ allows, so the public demo
// spends little of the event quota and repeat visits are fast.
//
// Each call returns { ...result, request } where request is the method, path and query string
// without the key. The UI shows these requests next to the plan so teachers and judges can see
// exactly what was asked of Qloo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { mockQloo } from './qloo-mock.js';

export class QlooError extends Error {
  constructor(message, { status, request, retryable = false } = {}) {
    super(message);
    this.name = 'QlooError';
    this.status = status;
    this.request = request;
    this.retryable = retryable;
  }
}

export const urn = (t) => (t.startsWith('urn:') ? t : `urn:entity:${t}`);
export const shortType = (t) => {
  const s = String(t || '').replace(/^urn:entity:/, '');
  return s === 'video_game' ? 'videogame' : s;
};

const cacheDir = path.join(config.dataDir, 'qloo-cache');
const stats = { live: 0, cached: 0, mock: 0, errors: 0 };
let monthRemaining = null;
const budget = { day: '', used: 0 };
export const qlooStats = () => ({ mode: config.qlooMode, ...stats, month_remaining: monthRemaining, today_used: budget.used, today_budget: config.qlooDailyBudget });

function cacheKey(p, params) {
  const sorted = Object.keys(params).sort().map((k) => [k, params[k]]);
  return crypto.createHash('sha256').update(`${config.qlooMode}|${p}|${JSON.stringify(sorted)}`).digest('hex').slice(0, 32);
}

function readCache(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(value));
  } catch {
    // a cache write failure only costs a repeat call
  }
}

function queryString(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return q.toString();
}

// Hackathon keys allow 5 requests per second (x-second-ratelimit-limit). We start at most 4 per
// rolling second and queue the rest.
const PER_SECOND = 4;
const started = [];
const waiting = [];
function slot() {
  return new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });
}
function pump() {
  const now = Date.now();
  while (started.length && now - started[0] >= 1000) started.shift();
  while (waiting.length && started.length < PER_SECOND) {
    started.push(Date.now());
    waiting.shift()();
  }
  if (waiting.length) setTimeout(pump, 1000 - (now - started[0]) + 5);
}

// Bounded retry: only 429 and 5xx, at most twice.
async function get(p, params) {
  const qs = queryString(params);
  const request = { method: 'GET', path: p, query: qs };
  const key = cacheKey(p, params);
  const hit = readCache(key);
  if (hit) {
    stats.cached++;
    return { body: hit, request: { ...request, cached: true } };
  }
  if (config.qlooMode === 'mock') {
    stats.mock++;
    let body;
    try {
      body = mockQloo(p, params);
    } catch (e) {
      throw new QlooError(`Qloo ${p} failed: ${e.message}`, { status: e.status, request });
    }
    writeCache(key, body);
    return { body, request: { ...request, mock: true } };
  }
  // The public demo shares one key (10,000 calls a month). Past the daily budget, only cached
  // answers are served, so one busy visitor cannot use up the month for the judges.
  const today = new Date().toISOString().slice(0, 10);
  if (budget.day !== today) Object.assign(budget, { day: today, used: 0 });
  if (budget.used >= config.qlooDailyBudget) {
    throw new QlooError('The demo has used its Qloo budget for today. Plans that were made before still work.', { status: 429, request });
  }
  budget.used++;
  const waits = [800, 3000];
  for (let i = 0; ; i++) {
    let res;
    await slot();
    try {
      res = await fetch(`${config.qlooBase}${p}?${qs}`, { headers: { 'X-Api-Key': config.qlooKey, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (i < waits.length) {
        await new Promise((r) => setTimeout(r, waits[i]));
        continue;
      }
      stats.errors++;
      throw new QlooError(`Qloo could not be reached: ${e.message}`, { request, retryable: true });
    }
    if ((res.status === 429 || res.status >= 500) && i < waits.length) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, after > 0 && after < 20 ? after * 1000 : waits[i]));
      continue;
    }
    monthRemaining = Number(res.headers.get('x-month-ratelimit-remaining')) || monthRemaining;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      stats.errors++;
      const msg = body?.error?.message || body?.message || body?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new QlooError(`Qloo ${p} failed: ${msg}`, { status: res.status, request, retryable: res.status === 429 || res.status >= 500 });
    }
    stats.live++;
    writeCache(key, body);
    return { body, request };
  }
}

// ---------- normalizing ----------
// Insights entities carry type "urn:entity" and the real type in subtype; search results carry a
// types array instead. Tags are {id, name, type} in insights and {tag_id, name, type} in search.

function yearOf(e, type) {
  const p = e.properties || {};
  // Artists: the year their career started. Films and TV: release year. Books: publication year.
  const raw = type === 'artist' ? p.start_year : type === 'person' ? null : p.release_year ?? p.publication_year ?? p.release_date ?? p.publication_date;
  const m = String(raw ?? '').match(/(1[89]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
}

function imageOf(e) {
  const img = e.properties?.image;
  if (!img) return null;
  const url = typeof img === 'string' ? img : img.url;
  return Array.isArray(url) ? url[0] || null : url || null;
}

function englishText(list) {
  if (!Array.isArray(list)) return null;
  const en = list.find((x) => (x.languages || [x.language]).includes('en'));
  return (en || list[0])?.value || null;
}

// Explainability arrives per entity as query.explainability["signal.interests.entities"]:
// [{ entity_id, score }], scores adding up to about 1. Returns { [seedEntityId]: score }.
function explainOf(e) {
  const list = e.query?.explainability?.['signal.interests.entities'];
  const out = {};
  if (Array.isArray(list)) for (const x of list) if (x?.entity_id && Number.isFinite(Number(x.score))) out[x.entity_id] = Number(x.score);
  return out;
}

// Some names arrive HTML-escaped ("Black Holes &amp; Time Warps").
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };
export const unescapeHtml = (s) => (typeof s === 'string' ? s.replace(/&(amp|quot|#39|apos|lt|gt);/g, (m) => ENTITIES[m]) : s);

export function normalizeEntity(e) {
  const type = shortType(e.subtype || e.types?.[0] || e.type);
  const p = e.properties || {};
  return {
    entity_id: e.entity_id || e.id,
    name: unescapeHtml(e.name),
    type,
    year: yearOf(e, type),
    disambiguation: unescapeHtml(e.disambiguation) || null,
    affinity: Number.isFinite(e.query?.affinity) ? e.query.affinity : null,
    popularity: Number.isFinite(e.popularity) ? e.popularity : null,
    description: unescapeHtml(englishText(p.short_descriptions) || p.short_description) || null,
    image: imageOf(e),
    genres: (p.primary_genres || p.genres || []).slice(0, 4),
    notable: Array.isArray(p.notable_songs) ? p.notable_songs.slice(0, 3) : [],
    duration: Number.isFinite(p.duration) ? p.duration : null,
    content_rating: typeof p.content_rating === 'string' ? p.content_rating : null,
    tags: (e.tags || []).slice(0, 12).map((t) => ({ id: t.id || t.tag_id, name: t.name, type: t.type || null })),
    explain: explainOf(e),
  };
}

// ---------- endpoints ----------

// Entity search by name. `types` uses the /search type names (urn:entity:*; games are videogame).
export async function search({ query, types = [], take = 5 }) {
  const params = { query, take };
  if (types.length) params.types = types.map((t) => urn(shortType(t)));
  const { body, request } = await get('/search', params);
  const results = (body?.results || []).map(normalizeEntity);
  return { results, request };
}

// Tag search, e.g. "horror" -> urn:tag:genre:media:horror
export async function findTags({ query, take = 5, parents = ['movie', 'tv_show'] }) {
  const params = { 'filter.query': query, take };
  if (parents?.length) params['filter.parents.types'] = parents.map(urn);
  const { body, request } = await get('/v2/tags', params);
  const tags = (body?.results?.tags || body?.results || []).map((t) => ({ id: t.id || t.tag_id, name: t.name, type: t.type || t.subtype || null }));
  return { tags, request };
}

// Taste neighbors or affinity scores for a set of seed entities.
//   type: target entity type (book, movie, tv_show, artist, ...)
//   seeds: Qloo entity ids used as signal.interests.entities
//   only: entity ids to score instead of searching the whole catalog (filter.results.entities).
//         "Often used to assess the affinity of an entity towards input" in Qloo's parameter docs.
//   contentRatings: MPAA / TV ratings to allow (filter.content_rating, movies and TV only)
//   excludeEntities, excludeTags: ids to keep out
//   age: Qloo demographic age bucket for the signal
//   explain: ask Qloo how much each seed contributed to each result (feature.explainability)
export async function insights({ type, seeds, only = [], contentRatings = [], excludeEntities = [], excludeTags = [], age = '24_and_younger', explain = false, take = 20 }) {
  if (!seeds?.length) return { entities: [], request: null };
  const params = {
    'filter.type': urn(INSIGHTS_TYPE[type] || type),
    'signal.interests.entities': seeds,
    take,
  };
  if (age) params['signal.demographics.age'] = age;
  if (only.length) params['filter.results.entities'] = only;
  if (contentRatings.length && (type === 'movie' || type === 'tv_show')) params['filter.content_rating'] = contentRatings;
  if (excludeEntities.length) params['filter.exclude.entities'] = excludeEntities;
  if (excludeTags.length) params['filter.exclude.tags'] = excludeTags;
  if (explain) params['feature.explainability'] = true;
  const { body, request } = await get('/v2/insights', params);
  const entities = (body?.results?.entities || []).map(normalizeEntity);
  return { entities, request };
}
const INSIGHTS_TYPE = { video_game: 'videogame' };

// Analysis compare: the tags two groups of entities share, each with a score.
export async function compare({ a, b, take = 8 }) {
  if (!a?.length || !b?.length) return { shared: [], request: null };
  const { body, request } = await get('/v2/analysis/compare', { 'a.signal.interests.entities': a, 'b.signal.interests.entities': b, take });
  const shared = (body?.results?.tags || [])
    .map((t) => ({ id: t.tag_id || t.id, name: t.name, type: t.subtype || t.type || null, score: Number(t.query?.score) || null }))
    .filter((t) => t.name);
  return { shared, request };
}
