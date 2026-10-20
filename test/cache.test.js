// The read cache in front of the hot paths: a write through the database
// wrapper must make every cached value that depends on that table stale.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Cache } from '../server/cache.js';
import { openDatabase } from '../server/db.js';
import { comparePassword, hashPassword } from '../server/passwords.js';

let db;
before(async () => {
  db = await openDatabase({ databaseUrl: null, dataDir: null });
  await db.exec(`CREATE TABLE IF NOT EXISTS cache_probe (id INT PRIMARY KEY, v TEXT)`);
  await db.query(`INSERT INTO cache_probe VALUES (1, 'a')`);
});
after(async () => { await db.close(); });

const read = async () => (await db.query('SELECT v FROM cache_probe WHERE id = 1')).rows[0].v;

test('a cached value is served until its table is written', async () => {
  const cache = new Cache(db);
  let loads = 0;
  const get = () => cache.get('probe', ['cache_probe'], 60000, () => { loads += 1; return read(); });
  assert.equal(await get(), 'a');
  assert.equal(await get(), 'a');
  assert.equal(loads, 1);

  await db.query(`UPDATE cache_probe SET v = 'b' WHERE id = 1`);
  assert.equal(await get(), 'b');
  assert.equal(loads, 2);
  // A write to an unrelated table changes nothing.
  await db.query(`INSERT INTO audit_log (action) VALUES ('CACHE_TEST')`);
  assert.equal(await get(), 'b');
  assert.equal(loads, 2);
});

test('a write inside a transaction makes the value stale after commit', async () => {
  const cache = new Cache(db);
  const get = () => cache.get('probe', ['cache_probe'], 60000, read);
  await get();
  await db.transaction(async (tx) => { await tx.query(`UPDATE cache_probe SET v = 'c' WHERE id = 1`); });
  assert.equal(await get(), 'c');
});

test('a value read while its table was being written is not kept', async () => {
  const cache = new Cache(db);
  let loads = 0;
  const get = () => cache.get('probe', ['cache_probe'], 60000, async () => {
    loads += 1;
    const v = await read();
    if (loads === 1) await db.query(`UPDATE cache_probe SET v = 'd' WHERE id = 1`); // races the read
    return v;
  });
  await get();
  assert.equal(await get(), 'd');
  assert.equal(loads, 2);
});

test('concurrent misses share one load, and entries expire', async () => {
  const cache = new Cache(db);
  let loads = 0;
  const get = (ttl) => cache.get('probe', ['cache_probe'], ttl, async () => { loads += 1; return read(); });
  await Promise.all([get(1), get(1), get(1)]);
  assert.equal(loads, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await get(1);
  assert.equal(loads, 2);
});

test('passwords hash and verify on the worker pool, bcrypt-compatible', async () => {
  const hash = await hashPassword('correct horse');
  assert.match(hash, /^\$2[aby]\$10\$/);
  const results = await Promise.all([comparePassword('correct horse', hash), comparePassword('wrong', hash)]);
  assert.deepEqual(results, [true, false]);
});
