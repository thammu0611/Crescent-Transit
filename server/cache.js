// Read cache for the hot paths (every request's account check, the
// subscription check, route and stop lists), so a thousand students do not
// turn into thousands of identical queries a minute.
//
// Correctness comes from the database wrapper, not from remembering to clear
// caches: every INSERT / UPDATE / DELETE that goes through `db` bumps a
// counter for the table it writes, and a cached value is only served while
// the counters of the tables it was read from are unchanged. A write inside a
// transaction bumps again after COMMIT, so a read that raced the transaction
// cannot keep the old value. The TTL bounds staleness for changes made outside
// this process (another server instance, psql).

const WRITE_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

function writtenTables(sql) {
  const out = [];
  if (typeof sql !== 'string') return out;
  for (const m of sql.matchAll(WRITE_RE)) out.push(m[1].toLowerCase());
  return out;
}

/** Wrap a db so that writes bump per-table versions: db.versionOf(['users', ...]). */
export function trackChanges(db) {
  const versions = new Map();
  const bump = (tables) => {
    for (const t of tables) versions.set(t, (versions.get(t) ?? 0) + 1);
  };
  const versionOf = (tables) => tables.map((t) => versions.get(t) ?? 0).join('.');
  return {
    ...db,
    versionOf,
    query(sql, params) {
      const tables = writtenTables(sql);
      if (!tables.length) return db.query(sql, params);
      bump(tables);
      return db.query(sql, params).finally(() => bump(tables));
    },
    exec(sql) {
      const tables = writtenTables(sql);
      bump(tables);
      return db.exec(sql).finally(() => bump(tables));
    },
    async transaction(fn) {
      const touched = new Set();
      try {
        return await db.transaction((tx) => fn({
          ...tx,
          query(sql, params) {
            const tables = writtenTables(sql);
            for (const t of tables) touched.add(t);
            bump(tables);
            return tx.query(sql, params);
          },
        }));
      } finally {
        bump(touched);
      }
    },
  };
}

/**
 * Values keyed by string, each tied to the tables it was read from.
 *   cache.get('auth:42', ['users'], 30000, () => db.query(...))
 * Concurrent misses for the same key share one load.
 */
export class Cache {
  constructor(db, { maxEntries = 50000 } = {}) {
    this.db = db;
    this.maxEntries = maxEntries;
    this.entries = new Map(); // key -> { value, version, expires }
    this.loading = new Map(); // key -> { promise, version }
  }

  async get(key, tables, ttlMs, load) {
    const version = this.db.versionOf?.(tables) ?? null;
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.version === version && hit.expires > now) return hit.value;
    const pending = this.loading.get(key);
    if (pending && pending.version === version) return pending.promise;

    const promise = (async () => {
      try {
        const value = await Promise.resolve().then(load);
        // Only keep it if nothing it depends on changed while it was read.
        if ((this.db.versionOf?.(tables) ?? null) === version) {
          if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
          this.entries.delete(key);
          this.entries.set(key, { value, version, expires: Date.now() + ttlMs });
        }
        return value;
      } finally {
        if (this.loading.get(key)?.promise === promise) this.loading.delete(key);
      }
    })();
    this.loading.set(key, { promise, version });
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}

const shared = new WeakMap();
/** The one cache shared by everything that uses this db. */
export function cacheFor(db) {
  let cache = shared.get(db);
  if (!cache) {
    cache = new Cache(db);
    shared.set(db, cache);
  }
  return cache;
}
