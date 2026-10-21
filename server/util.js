import { HttpError } from './auth.js';

/** Append to the audit log (doc 8.8): actor, action, reason and timestamp. */
export async function audit(db, { actorId = null, action, entity = null, entityId = null, reason = null, detail = null, ip = null }) {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, reason, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, action, entity, entityId == null ? null : String(entityId), reason, detail ? JSON.stringify(detail) : null, ip],
  );
}

/** Fixed-window in-memory rate limiter. `key(req)` picks what is counted. */
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new HttpError(429, message));
    }
    next();
  };
}

// ---- CSV ------------------------------------------------------------------

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows of objects -> CSV text with a header row. */
export function toCsv(rows, columns = rows[0] ? Object.keys(rows[0]) : []) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Minimal RFC 4180 parser -> array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Send rows as CSV (?format=csv) or JSON. */
export function sendTable(req, res, rows, filename, columns) {
  if (req.query.format === 'csv') {
    res.set('content-type', 'text/csv; charset=utf-8');
    res.set('content-disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows, columns));
  }
  res.json(rows);
}

export const rupees = (paise) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const intParam = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
};
