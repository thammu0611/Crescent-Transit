// Database backups: a compressed copy of every table, optionally encrypted,
// kept on disk and optionally uploaded to S3-compatible storage (AWS S3,
// Cloudflare R2, Backblaze B2). It works the same on PostgreSQL and the embedded
// database, and `npm run restore` brings a file back.
//
// Every value is read and written as PostgreSQL text and cast back on restore,
// so nothing is lost or reshaped on the way through JSON.
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { localDate, localMinutes } from './clock.js';

const MAGIC = Buffer.from('CTB1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const FORMAT = 1;
const PAGE = 5000;
const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
const keyFrom = (secret, salt) => crypto.scryptSync(String(secret), salt, 32);

/** Tables with the ones others point at first, so a restore can insert in this order. */
export async function orderedTables(db) {
  const tables = (await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )).rows.map((r) => r.table_name);
  const links = (await db.query(
    `SELECT c.relname AS child, p.relname AS parent
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = k.connamespace
      WHERE k.contype = 'f' AND n.nspname = 'public'`,
  )).rows;
  const needs = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of links) if (child !== parent) needs.get(child)?.add(parent);
  const done = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...needs.get(t)].every((p) => !left.has(p)));
    if (!ready.length) throw new Error(`Circular table references: ${[...left].join(', ')}`);
    for (const t of ready) {
      left.delete(t);
      done.push(t);
    }
  }
  return done;
}

async function columnsOf(db, table) {
  const { rows } = await db.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => ({ name: r.column_name, type: r.udt_name }));
}

async function singleKey(db, table) {
  const { rows } = await db.query(
    `SELECT a.attname AS name FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary AND c.relname = $1 AND n.nspname = 'public'`,
    [table],
  );
  return rows.length === 1 ? rows[0].name : null;
}

/** All rows of a table as arrays of text, a page at a time. */
async function* readRows(db, table, columns) {
  const list = columns.map((c, i) => `${quote(c.name)}::text AS c${i}`).join(', ');
  const key = await singleKey(db, table);
  const keyColumn = columns.find((c) => c.name === key);
  const values = (r) => columns.map((_, i) => r[`c${i}`]);
  if (keyColumn) {
    let last = null;
    for (;;) {
      const { rows } = await db.query(
        `SELECT ${list} FROM ${quote(table)}${last === null ? '' : ` WHERE ${quote(key)} > $1::${keyColumn.type}`}
          ORDER BY ${quote(key)} LIMIT ${PAGE}`,
        last === null ? [] : [last],
      );
      if (!rows.length) return;
      yield* rows.map(values);
      last = values(rows.at(-1))[columns.indexOf(keyColumn)];
      if (rows.length < PAGE) return;
    }
  }
  for (let offset = 0; ; offset += PAGE) {
    const { rows } = await db.query(`SELECT ${list} FROM ${quote(table)} ORDER BY 1 LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) return;
    yield* rows.map(values);
    if (rows.length < PAGE) return;
  }
}

/** On PostgreSQL the whole copy reads one moment in time. */
const inSnapshot = (db, fn) => (String(db.kind).startsWith('pglite')
  ? fn(db)
  : db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return fn({ ...tx, kind: db.kind });
  }));

/** Write a backup file. Returns its size and how many rows it holds. */
export async function writeBackup(db, file, { key = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  const out = fs.createWriteStream(partial);
  const failed = new Promise((_, reject) => out.once('error', reject));
  failed.catch(() => {});
  let cipher = null;
  if (key) {
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    out.write(Buffer.concat([MAGIC, salt, iv]));
    cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(key, salt), iv);
  }
  const gzip = zlib.createGzip();
  const sink = cipher ?? out;
  gzip.pipe(sink);
  if (cipher) cipher.pipe(out, { end: false });
  const put = async (obj) => {
    if (!gzip.write(`${JSON.stringify(obj)}\n`)) await Promise.race([once(gzip, 'drain'), failed]);
  };

  try {
    const tables = await orderedTables(db);
    let rowCount = 0;
    await inSnapshot(db, async (reader) => {
      await put({ format: FORMAT, createdAt: new Date().toISOString(), engine: db.kind, tables });
      for (const table of tables) {
        const columns = await columnsOf(reader, table);
        await put({ table, columns });
        for await (const row of readRows(reader, table, columns)) {
          await put(row);
          rowCount += 1;
        }
      }
      const { rows } = await reader.query(`SELECT sequencename, last_value::text AS last_value FROM pg_sequences WHERE schemaname = 'public'`);
      await put({ sequences: rows.filter((r) => r.last_value !== null) });
    });
    await put({ end: true, rows: rowCount });
    const closed = once(out, 'close');
    if (cipher) cipher.once('end', () => out.end(cipher.getAuthTag()));
    gzip.end();
    await closed;
    fs.renameSync(partial, file);
    return { file, bytes: fs.statSync(file).size, rows: rowCount, encrypted: Boolean(key) };
  } catch (err) {
    out.destroy();
    fs.rmSync(partial, { force: true });
    throw err;
  }
}

/** The lines of a backup, checking the encryption tag on the way. */
function openLines(file, key) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(MAGIC.length + SALT_LEN + IV_LEN);
  fs.readSync(fd, head, 0, head.length, 0);
  let source;
  if (head.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!key) {
      fs.closeSync(fd);
      throw new Error('This backup is encrypted: set BACKUP_KEY to the key it was made with.');
    }
    const salt = head.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = head.subarray(MAGIC.length + SALT_LEN);
    const tag = Buffer.alloc(TAG_LEN);
    fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
    fs.closeSync(fd);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(key, salt), iv);
    decipher.setAuthTag(tag);
    source = fs.createReadStream(file, { start: head.length, end: size - TAG_LEN - 1 }).pipe(decipher);
  } else {
    fs.closeSync(fd);
    source = fs.createReadStream(file);
  }
  const gunzip = zlib.createGunzip();
  source.on('error', (err) => gunzip.destroy(err));
  return readline.createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
}

/** Read a whole backup without changing anything: it is complete and the key is right. */
export async function verifyBackup(file, { key = null } = {}) {
  let header = null;
  let rows = 0;
  let footer = null;
  for await (const line of openLines(file, key)) {
    const item = JSON.parse(line);
    if (!header) header = item;
    else if (Array.isArray(item)) rows += 1;
    else if (item.end) footer = item;
  }
  if (header?.format !== FORMAT) throw new Error('This is not a Crescent Transit backup file.');
  if (!footer || footer.rows !== rows) throw new Error('This backup is incomplete.');
  return { createdAt: header.createdAt, rows, tables: header.tables.length };
}

/** Replace everything in the database with a backup. The file is checked in full first. */
export async function restoreBackup(db, file, { key = null } = {}) {
  const checked = await verifyBackup(file, { key });
  const present = await orderedTables(db);
  await db.transaction(async (tx) => {
    if (present.length) await tx.query(`TRUNCATE ${present.map(quote).join(', ')} RESTART IDENTITY CASCADE`);
    let table = null;
    let batch = [];
    let columns = [];
    const known = new Set(present);
    const flush = async () => {
      if (!batch.length) return;
      const cols = columns.map((c) => quote(c.name)).join(', ');
      const params = [];
      const values = batch.map((row) => `(${row.map((v, i) => {
        params.push(v);
        return `$${params.length}::${columns[i].type}`;
      }).join(', ')})`).join(', ');
      await tx.query(`INSERT INTO ${quote(table)} (${cols}) VALUES ${values}`, params);
      batch = [];
    };
    let first = true;
    for await (const line of openLines(file, key)) {
      const item = JSON.parse(line);
      if (first) { first = false; continue; }
      if (Array.isArray(item)) {
        if (!known.has(table)) continue;
        batch.push(item);
        if ((batch.length + 1) * columns.length > 60000 || batch.length >= 500) await flush();
      } else if (item.table) {
        await flush();
        table = item.table;
        columns = item.columns;
      } else if (item.sequences) {
        await flush();
        for (const s of item.sequences) await tx.query('SELECT setval($1::regclass, $2::bigint)', [quote(s.sequencename), s.last_value]);
      }
    }
  });
  return checked;
}

// ---- Upload to S3-compatible storage ---------------------------------------

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** AWS Signature Version 4 for one request. `headers` are all signed. */
export function signV4({ method, path: urlPath, query = '', headers, payloadHash, accessKey, secretKey, region, service = 's3', amzDate }) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, urlPath, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = ['aws4_request'].reduce(
    (k, part) => hmac(k, part),
    hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service),
  );
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');
  return { signature, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export async function uploadS3(file, s3) {
  const body = await fs.promises.readFile(file);
  const url = new URL(`${s3.endpoint.replace(/\/$/, '')}/${s3.bucket}/${s3.prefix ?? ''}${path.basename(file)}`);
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const payloadHash = sha256(body);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const { authorization } = signV4({
    method: 'PUT', path: url.pathname, headers, payloadHash, amzDate, accessKey: s3.accessKey, secretKey: s3.secretKey, region: s3.region,
  });
  const res = await fetch(url, { method: 'PUT', headers: { ...headers, authorization }, body });
  if (!res.ok) throw new Error(`Backup upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ---- The nightly job --------------------------------------------------------

export class BackupService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.settings = config.backup;
  }

  /** Has today's backup still to be made? */
  async due(now = new Date()) {
    if (!this.settings.enabled) return false;
    const [h, m] = this.settings.at.split(':').map(Number);
    if (localMinutes(now, this.config.timeZone) < h * 60 + m) return false;
    const { rows } = await this.db.query(`SELECT last_run FROM job_runs WHERE job = 'backup'`);
    const last = rows[0]?.last_run;
    return !last || localDate(new Date(last), this.config.timeZone) !== localDate(now, this.config.timeZone);
  }

  rotate() {
    const dir = this.settings.dir;
    const files = fs.readdirSync(dir).filter((f) => /^crescent-.*\.(gz|enc)$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - this.settings.keep))) fs.rmSync(path.join(dir, f), { force: true });
  }

  async run() {
    const { dir, key, s3 } = this.settings;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const file = path.join(dir, `crescent-${stamp}.ndjson.${key ? 'enc' : 'gz'}`);
    const { rows } = await this.db.query('INSERT INTO backup_runs (started_at) VALUES (now()) RETURNING id');
    const id = rows[0].id;
    try {
      const written = await writeBackup(this.db, file, { key });
      await verifyBackup(file, { key });
      if (s3) await uploadS3(file, s3);
      this.rotate();
      await this.db.query(
        `UPDATE backup_runs SET finished_at = now(), ok = TRUE, file = $2, bytes = $3, row_count = $4, offsite = $5 WHERE id = $1`,
        [id, path.basename(file), written.bytes, written.rows, Boolean(s3)],
      );
      await this.db.query(
        `INSERT INTO job_runs (job, last_run) VALUES ('backup', now()) ON CONFLICT (job) DO UPDATE SET last_run = now()`,
      );
      return { ...written, offsite: Boolean(s3) };
    } catch (err) {
      await this.db.query('UPDATE backup_runs SET finished_at = now(), ok = FALSE, error = $2 WHERE id = $1', [id, String(err.message).slice(0, 500)]);
      throw err;
    }
  }

  async latest() {
    const { rows } = await this.db.query('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 1');
    const { rows: good } = await this.db.query('SELECT finished_at, file, bytes, row_count, offsite FROM backup_runs WHERE ok ORDER BY id DESC LIMIT 1');
    return { lastAttempt: rows[0] ?? null, lastGood: good[0] ?? null };
  }
}
