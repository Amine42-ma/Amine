'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - PERSISTENCE
 * ============================================================================
 *  A small embedded document store: in-memory collections with secondary
 *  indices, backed by newline-delimited JSON snapshots on disk.
 *
 *  Writes are debounced and atomic (write temp -> fsync -> rename), so a crash
 *  mid-flush can never corrupt an existing snapshot.
 *
 *  Swapping this for Postgres/Redis later only requires re-implementing the
 *  Collection surface (get/put/delete/find/all).
 * ============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

class Collection {
  constructor(store, name, { indices = [] } = {}) {
    this.store = store;
    this.name = name;
    this.docs = new Map();
    this.indexKeys = indices;
    this.indices = new Map();
    for (const key of indices) this.indices.set(key, new Map());
    this.dirty = false;
  }

  _index(doc, remove = false) {
    for (const key of this.indexKeys) {
      const idx = this.indices.get(key);
      const raw = doc[key];
      if (raw == null) continue;
      const val = typeof raw === 'string' ? raw.toLowerCase() : raw;
      if (remove) {
        if (idx.get(val) === doc.id) idx.delete(val);
      } else {
        idx.set(val, doc.id);
      }
    }
  }

  get(id) {
    return this.docs.get(id) || null;
  }

  by(key, value) {
    const idx = this.indices.get(key);
    if (!idx) throw new Error(`collection ${this.name} has no index on ${key}`);
    const val = typeof value === 'string' ? value.toLowerCase() : value;
    const id = idx.get(val);
    return id ? this.docs.get(id) || null : null;
  }

  put(doc) {
    if (!doc || !doc.id) throw new Error('document requires an id');
    const prev = this.docs.get(doc.id);
    if (prev) this._index(prev, true);
    this.docs.set(doc.id, doc);
    this._index(doc, false);
    this.markDirty();
    return doc;
  }

  delete(id) {
    const doc = this.docs.get(id);
    if (!doc) return false;
    this._index(doc, true);
    this.docs.delete(id);
    this.markDirty();
    return true;
  }

  markDirty() {
    this.dirty = true;
    this.store.scheduleFlush();
  }

  all() {
    return Array.from(this.docs.values());
  }

  find(predicate, limit = Infinity) {
    const out = [];
    for (const doc of this.docs.values()) {
      if (predicate(doc)) {
        out.push(doc);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  count() {
    return this.docs.size;
  }

  /** Sorted top-N without materialising the whole collection. */
  top(n, scoreFn, filter) {
    const heap = [];
    for (const doc of this.docs.values()) {
      if (filter && !filter(doc)) continue;
      const score = scoreFn(doc);
      if (heap.length < n) {
        heap.push({ doc, score });
        if (heap.length === n) heap.sort((a, b) => a.score - b.score);
      } else if (score > heap[0].score) {
        heap[0] = { doc, score };
        heap.sort((a, b) => a.score - b.score);
      }
    }
    return heap.sort((a, b) => b.score - a.score).map((e) => e.doc);
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.collections = new Map();
    this._flushTimer = null;
    this._flushing = false;
    this._pendingFlush = false;
    this.flushIntervalMs = 2500;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  collection(name, opts) {
    let col = this.collections.get(name);
    if (!col) {
      col = new Collection(this, name, opts);
      this.collections.set(name, col);
      this._load(col);
    }
    return col;
  }

  _file(name) {
    return path.join(this.dir, `${name}.ndjson`);
  }

  _load(col) {
    const file = this._file(col.name);
    if (!fs.existsSync(file)) return;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`[store] cannot read ${file}:`, err.message);
      return;
    }
    let loaded = 0;
    let skipped = 0;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const doc = JSON.parse(line);
        if (doc && doc.id) {
          col.docs.set(doc.id, doc);
          col._index(doc, false);
          loaded++;
        }
      } catch {
        // A torn final line can only happen if the process died between
        // rename() calls on some exotic filesystem; drop it and continue.
        skipped++;
      }
    }
    console.log(`[store] loaded ${loaded} docs into "${col.name}"${skipped ? ` (${skipped} corrupt lines skipped)` : ''}`);
  }

  scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush().catch((err) => console.error('[store] flush failed:', err.message));
    }, this.flushIntervalMs);
    this._flushTimer.unref?.();
  }

  async flush() {
    if (this._flushing) {
      this._pendingFlush = true;
      return;
    }
    this._flushing = true;
    try {
      for (const col of this.collections.values()) {
        if (!col.dirty) continue;
        col.dirty = false;
        await this._writeCollection(col);
      }
    } finally {
      this._flushing = false;
      if (this._pendingFlush) {
        this._pendingFlush = false;
        this.scheduleFlush();
      }
    }
  }

  async _writeCollection(col) {
    const file = this._file(col.name);
    const tmp = `${file}.tmp`;
    const chunks = [];
    for (const doc of col.docs.values()) chunks.push(JSON.stringify(doc));
    const data = chunks.length ? chunks.join('\n') + '\n' : '';

    const handle = await fs.promises.open(tmp, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmp, file);
  }

  flushSync() {
    for (const col of this.collections.values()) {
      if (!col.dirty) continue;
      col.dirty = false;
      const file = this._file(col.name);
      const tmp = `${file}.tmp`;
      const chunks = [];
      for (const doc of col.docs.values()) chunks.push(JSON.stringify(doc));
      try {
        fs.writeFileSync(tmp, chunks.length ? chunks.join('\n') + '\n' : '', 'utf8');
        fs.renameSync(tmp, file);
      } catch (err) {
        console.error(`[store] sync flush of ${col.name} failed:`, err.message);
      }
    }
  }

  stats() {
    const out = {};
    for (const [name, col] of this.collections) out[name] = col.count();
    return out;
  }
}

module.exports = { Store, Collection };
