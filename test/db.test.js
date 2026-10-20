// The embedded database is used by one server at a time: a second server must
// refuse to start instead of treating the busy files as damaged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseInUseError, openDatabase } from '../server/db.js';

test('a database another running server holds is refused, never moved aside', async () => {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ubts-db-')), 'pgdata');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '17');
  // The parent process (the test runner) is alive: it stands in for a running server.
  fs.writeFileSync(`${dataDir}.lock`, JSON.stringify({ pid: process.ppid }));
  await assert.rejects(openDatabase({ dataDir }), (err) => err instanceof DatabaseInUseError && err.pid === process.ppid);
  assert.deepEqual(fs.readdirSync(path.dirname(dataDir)).sort(), ['pgdata', 'pgdata.lock'], 'nothing renamed or created');
});

test('a lock left by a crashed server is taken over, and released on close', async () => {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ubts-db-')), 'pgdata');
  fs.writeFileSync(`${dataDir}.lock`, JSON.stringify({ pid: 2147483646 })); // no such process
  const db = await openDatabase({ dataDir });
  assert.equal(JSON.parse(fs.readFileSync(`${dataDir}.lock`, 'utf8')).pid, process.pid);
  await db.close();
  assert.equal(fs.existsSync(`${dataDir}.lock`), false);
});
