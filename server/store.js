// JSON file storage. The public demo gives every visitor their own copy of the demo class
// (a "workspace"), so one judge's edits never show up for another. Workspaces untouched for
// 14 days are deleted on start-up. At most CACHE_MAX workspaces are kept in memory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { demoClass } from './demo-data.js';

const WS_TTL_MS = 14 * 24 * 3600 * 1000;
const CACHE_MAX = 200;

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url')}`;
}

export class Workspaces {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map();
  }

  file(id) {
    if (!/^ws_[A-Za-z0-9_-]{8,}$/.test(id)) throw new Error('bad workspace id');
    return path.join(this.dir, `${id}.json`);
  }

  create() {
    const id = newId('ws');
    const data = demoClass(new Date());
    data.id = id;
    data.created = new Date().toISOString();
    this.cache.set(id, data);
    this.save(id);
    return data;
  }

  get(id) {
    if (!id) return null;
    if (this.cache.has(id)) {
      const data = this.cache.get(id);
      this.remember(id, data);
      return data;
    }
    let f;
    try {
      f = this.file(id);
    } catch {
      return null;
    }
    if (!fs.existsSync(f)) return null;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    this.remember(id, data);
    return data;
  }

  // Least recently used first out. Map keeps insertion order, so re-inserting marks it recent.
  remember(id, data) {
    this.cache.delete(id);
    this.cache.set(id, data);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }

  save(id) {
    const data = this.cache.get(id);
    if (!data) return;
    this.remember(id, data);
    data.touched = new Date().toISOString();
    const tmp = `${this.file(id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, this.file(id));
  }

  reset(id) {
    const fresh = demoClass(new Date());
    fresh.id = id;
    fresh.created = new Date().toISOString();
    this.cache.set(id, fresh);
    this.save(id);
    return fresh;
  }

  sweep(now = Date.now()) {
    let removed = 0;
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(this.dir, f);
      if (now - fs.statSync(p).mtimeMs > WS_TTL_MS) {
        fs.unlinkSync(p);
        this.cache.delete(f.replace(/\.json$/, ''));
        removed++;
      }
    }
    return removed;
  }
}
