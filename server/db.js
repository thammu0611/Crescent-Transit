import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackChanges } from './cache.js';

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/**
 * Is the database in dataDir damaged? Checked in a separate, short-lived
 * Node process: if it cannot be opened, that process exits and releases the files, so
 * the folder can be moved aside. (A failed open inside this process keeps the
 * files locked on Windows until the server exits.)
 */
function isDamaged(dataDir) {
  const probe = `
    const { PGlite } = await import(process.env.PROBE_PGLITE);
    const { btree_gist } = await import(process.env.PROBE_GIST);
    const db = new PGlite({ dataDir: process.env.PROBE_DIR, extensions: { btree_gist } });
    await db.waitReady;
    await db.query('SELECT 1');
    await db.close();`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: {
      ...process.env,
      PROBE_PGLITE: import.meta.resolve('@electric-sql/pglite'),
      PROBE_GIST: import.meta.resolve('@electric-sql/pglite/contrib/btree_gist'),
      PROBE_DIR: dataDir,
    },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  // Only PGlite's own abort on these files counts as damage: any other failure
  // (a timeout, a missing module) must never move a database aside.
  return result.status !== 0 && /RuntimeError: Aborted\(/.test(result.stderr ?? '');
}

/** Is a process with this id still running? */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but belongs to another user
  }
}

/**
 * One server per embedded database. The lock file beside the data folder holds
 * the owning process id; a second server refuses to start instead of mistaking
 * the busy (locked) files for a damaged database. A lock left by a crashed
 * server (its process is gone) is taken over.
 */
export class DatabaseInUseError extends Error {
  constructor(dataDir, pid) {
    super(`Another CresTrack server (process ${pid}) is already using the database in ${dataDir}. `
      + 'Use that server, or stop it (Ctrl+C in its window) before starting another.');
    this.code = 'DB_IN_USE';
    this.pid = pid;
  }
}

function acquireLock(dataDir) {
  const lockPath = `${dataDir}.lock`;
  try {
    const pid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid);
    if (pid && pid !== process.pid && alive(pid)) throw new DatabaseInUseError(dataDir, pid);
  } catch (err) {
    if (err instanceof DatabaseInUseError) throw err; // anything else: no lock, or an unreadable one
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const release = () => {
    try {
      if (Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid) === process.pid) fs.unlinkSync(lockPath);
    } catch {
      // already gone
    }
  };
  process.once('exit', release);
  return release;
}

/** Rename, retrying briefly: Windows (or an antivirus scan) can hold files for a moment. */
async function moveAside(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Open (or create) the embedded database. If the files on disk cannot be
 * opened - typically after the server was killed mid-write, or a sync tool
 * such as OneDrive touched them - the folder is moved aside (kept, not
 * deleted) and a fresh database is started, which the server then seeds.
 */
async function openPglite(PGlite, dataDir, extensions) {
  // Claim the database first: a folder another server holds open must never be
  // probed or moved aside as "damaged".
  const release = dataDir ? acquireLock(dataDir) : () => {};
  if (dataDir && fs.existsSync(path.join(dataDir, 'PG_VERSION')) && isDamaged(dataDir)) {
    const aside = `${dataDir}-damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await moveAside(dataDir, aside);
    console.warn(`The local database could not be opened (it was probably stopped mid-write).`);
    console.warn(`  Moved it to ${aside} and started a fresh one.`);
  }
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite({ ...(dataDir ? { dataDir } : {}), extensions });
  try {
    await lite.waitReady;
  } catch (err) {
    release();
    throw new Error(`Could not open the local database in ${dataDir}: ${err.message}. Delete it with "npm run reset-db" and start again.`);
  }
  lite.releaseLock = release;
  return lite;
}

/**
 * Copy a database from the old in-project folder (.data/pgdata) to the new
 * default location once, so moving the default does not lose anyone's data.
 */
export function migrateDataDir(from, to) {
  if (!from || !to || path.resolve(from) === path.resolve(to)) return false;
  if (fs.existsSync(to) || !fs.existsSync(path.join(from, 'PG_VERSION'))) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
}

/**
 * Open the database. Both drivers expose the same small interface:
 *   query(sql, params) -> { rows }, exec(sql), transaction(fn), close(), kind
 *
 * - DATABASE_URL set  -> node-postgres against a real PostgreSQL server.
 * - otherwise         -> PGlite, the PostgreSQL engine compiled to WebAssembly,
 *                        so the prototype runs with no database installation.
 *   dataDir null       -> in-memory (used by the automated tests).
 */
export async function openDatabase({ databaseUrl, dataDir }) {
  let db;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
      // node-postgres defaults to 10 connections; the hot paths are short
      // queries, so a few more absorb a sign-in rush without queueing. Free
      // hosted plans cap connections (Supabase ~60, Render ~97): stay below.
      max: Number(process.env.PG_POOL_MAX) || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    // A dropped idle connection must not crash the server.
    pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
    db = {
      kind: 'postgresql',
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
      // A pool hands out a different connection per query, so a transaction
      // must pin one client for its whole duration.
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (sql, params) => client.query(sql, params) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    // btree_gist backs the "one active subscription per student" constraint.
    const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
    const lite = await openPglite(PGlite, dataDir, { btree_gist });
    db = {
      kind: dataDir ? 'pglite (embedded PostgreSQL)' : 'pglite (in-memory)',
      query: (sql, params) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      close: async () => { await lite.close(); lite.releaseLock?.(); },
      transaction: (fn) => lite.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) })),
    };
  }
  await db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return trackChanges(db);
}
