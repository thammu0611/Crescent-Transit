// Tells someone when things go wrong: server errors, failed jobs, a failed
// backup, a bus that has gone silent mid-route, a bus that has not started.
// Alerts go to the administrator's dashboard, and by email (ALERT_EMAIL) and
// webhook (ALERT_WEBHOOK_URL: Slack, Teams or Discord) when those are set.
import { busLabel } from '../shared/institution.js';
import { clockMinutes } from './alternatives.js';
import { localDate, localMinutes } from './clock.js';

const MAX_DETAIL = 2000;

/** Where an error came from, without request bodies or anything personal. */
const shortStack = (err) => String(err?.stack ?? '').split('\n').slice(0, 6).join('\n').slice(0, MAX_DETAIL);

export class MonitorService {
  constructor(db, config, { mailer, calendar = null, backups = null, io = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.monitor;
    this.mailer = mailer;
    this.calendar = calendar;
    this.backups = backups;
    this.io = io;
    this.lastSent = new Map();
  }

  /** Email and webhook, each failure swallowed: an alert must never cause an error. */
  async deliver(subject, text) {
    const { alertEmail, webhookUrl } = this.settings;
    const title = `[${this.config.institution.appName}] ${subject}`;
    if (alertEmail && this.mailer?.configured) {
      await this.mailer.send({ to: alertEmail, subject: title, text }).catch((err) => console.error('[monitor] email failed:', err.message));
    }
    if (webhookUrl) {
      const message = `${title}\n${text}`;
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message, content: message.slice(0, 1900) }),
        signal: AbortSignal.timeout(8000),
      }).catch((err) => console.error('[monitor] webhook failed:', err.message));
    }
  }

  /** Save an event, and send it unless the same key was sent a short while ago. */
  async record({ level = 'error', source, message, detail = null, key = null, notify = true }) {
    try {
      await this.db.query(
        'INSERT INTO system_events (level, source, message, detail) VALUES ($1, $2, $3, $4)',
        [level, source, String(message).slice(0, 300), detail ? String(detail).slice(0, MAX_DETAIL) : null],
      );
      this.io?.to('admins').emit('system:alert', { level, source, message });
      if (!notify) return;
      const id = key ?? `${source}:${message}`;
      const previous = this.lastSent.get(id) ?? 0;
      if (Date.now() - previous < this.settings.repeatMinutes * 60000) return;
      this.lastSent.set(id, Date.now());
      await this.deliver(String(message).slice(0, 120), detail ? `${message}\n\n${detail}` : String(message));
    } catch (err) {
      console.error('[monitor] could not record:', err.message);
    }
  }

  /** An unexpected server error or a failed job. */
  capture(source, err, where = null) {
    return this.record({ source, message: `${where ? `${where}: ` : ''}${err?.message ?? err}`, detail: shortStack(err) });
  }

  /** Open an alert once; it stays on the dashboard until `close`. */
  async open(key, kind, message) {
    const { rows } = await this.db.query(
      `INSERT INTO system_alerts (key, kind, message) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET closed_at = NULL, opened_at = now(), message = EXCLUDED.message
         WHERE system_alerts.closed_at IS NOT NULL
       RETURNING key`,
      [key, kind, message],
    );
    if (rows[0]) await this.record({ level: 'warning', source: kind, message, key });
    return Boolean(rows[0]);
  }

  async close(key) {
    await this.db.query('UPDATE system_alerts SET closed_at = now() WHERE key = $1 AND closed_at IS NULL', [key]);
  }

  /** A running trip whose bus has sent nothing for a while. */
  async silentBuses() {
    const { rows } = await this.db.query(
      `SELECT t.id, b.fleet_code, r.code AS route_code, l.received_at,
              GREATEST(COALESCE(l.received_at, t.started_at), t.started_at) < now() - make_interval(mins => $1) AS silent
         FROM trips t
         JOIN buses b ON b.id = t.bus_id JOIN routes r ON r.id = t.route_id
         LEFT JOIN bus_latest l ON l.bus_id = t.bus_id AND l.trip_id = t.id
        WHERE t.status = 'active'`,
      [this.settings.silentMinutes],
    );
    let opened = 0;
    for (const trip of rows) {
      const key = `silent:${trip.id}`;
      if (trip.silent) {
        const said = await this.open(key, 'silent-bus', `${busLabel(trip.fleet_code)} (route ${trip.route_code}) has sent no location for ${this.settings.silentMinutes}+ minutes`);
        if (said) opened += 1;
      } else await this.close(key);
    }
    // Trips that have ended cannot stay in alarm.
    await this.db.query(
      `UPDATE system_alerts a SET closed_at = now()
         FROM trips t
        WHERE a.kind = 'silent-bus' AND a.closed_at IS NULL AND a.key = 'silent:' || t.id AND t.status <> 'active'`,
    );
    return opened;
  }

  /** Buses that should be out by now and are not, in one message. */
  async missedStarts(now = new Date()) {
    const { timeZone } = this.config;
    const today = localDate(now, timeZone);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const special = await this.calendar?.on(today);
    if (special?.no_service || (!special && !this.settings.serviceDays.includes(weekday))) return 0;
    const minutes = localMinutes(now, timeZone);
    const shift = special?.morning_shift ?? 0;
    const { rows } = await this.db.query(
      `SELECT r.code, r.departure_time, b.fleet_code
         FROM routes r JOIN buses b ON b.route_id = r.id
        WHERE r.active AND NOT EXISTS (
          SELECT 1 FROM trips t WHERE t.bus_id = b.id AND t.started_at >= $1::text::date - interval '1 day' AND to_char(t.started_at AT TIME ZONE $2, 'YYYY-MM-DD') = $1::text
        )`,
      [today, timeZone],
    );
    const late = rows.filter((r) => {
      const leaves = clockMinutes(r.departure_time);
      if (leaves === null || leaves === undefined) return false;
      const due = leaves + shift + this.settings.missedStartMinutes;
      return minutes >= due && minutes < due + 120;
    });
    if (!late.length) return 0;
    const names = late.map((r) => busLabel(r.fleet_code));
    const opened = await this.open(
      `nostart:${today}:${names.join(',')}`,
      'missed-start',
      names.length === 1 ? `${names[0]} has not started its morning trip` : `${names.length} buses have not started their morning trip: ${names.join(', ')}`,
    );
    return opened ? names.length : 0;
  }

  async sweep(now = new Date()) {
    if (!this.settings.watchBuses) return { skipped: true };
    const silent = await this.silentBuses();
    const missed = await this.missedStarts(now);
    // Yesterday's "not started" is not news today.
    await this.db.query(
      `UPDATE system_alerts SET closed_at = now() WHERE kind = 'missed-start' AND closed_at IS NULL AND opened_at < now() - interval '4 hours'`,
    );
    return { silent, missed };
  }

  /** Everything the dashboard's health card shows. */
  async health() {
    const started = Date.now();
    let database = 'ok';
    try { await this.db.query('SELECT 1'); } catch { database = 'failing'; }
    const dbMs = Date.now() - started;
    const backup = this.backups ? await this.backups.latest() : { lastAttempt: null, lastGood: null };
    const [events, alerts, recent, runs] = await Promise.all([
      this.db.query(`SELECT count(*)::int AS n FROM system_events WHERE level = 'error' AND created_at > now() - interval '24 hours'`),
      this.db.query('SELECT key, kind, message, opened_at FROM system_alerts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 20'),
      this.db.query('SELECT level, source, message, created_at FROM system_events ORDER BY id DESC LIMIT 10'),
      this.db.query(`SELECT job, last_run FROM job_runs`),
    ]);
    const lastRun = Object.fromEntries(runs.rows.map((r) => [r.job, r.last_run]));
    const { config } = this;
    const reachable = Boolean(this.settings.webhookUrl || (this.settings.alertEmail && this.mailer?.configured));
    const goodAt = backup.lastGood?.finished_at ? new Date(backup.lastGood.finished_at).getTime() : 0;
    const stale = Date.now() - goodAt > 36 * 3600000;
    const problems = [
      db_embedded(config) && 'The database is on this server’s own disk. Move it to managed PostgreSQL before real use.',
      config.backup.enabled ? null : 'Automatic backups are switched off.',
      config.backup.enabled && stale && 'No good backup in the last 36 hours.',
      config.backup.enabled && !config.backup.s3 && 'Backups stay on this server only. Set BACKUP_S3_BUCKET to keep a copy elsewhere.',
      config.backup.enabled && !config.backup.key && 'Backups are not encrypted. Set BACKUP_KEY.',
      !reachable && 'Nobody is alerted outside this page. Set ALERT_EMAIL (with SMTP) or ALERT_WEBHOOK_URL.',
      config.demoMode && 'Demo mode is on: shared demo accounts can sign in.',
    ].filter(Boolean);
    return {
      database, databaseMs: dbMs, engine: this.db.kind, lastNightly: lastRun.nightly ?? null,
      backup: { ...backup.lastGood, lastError: backup.lastAttempt?.ok === false ? backup.lastAttempt.error : null },
      errors24h: events.rows[0].n, alerts: alerts.rows, recent: recent.rows, problems,
    };
  }
}

const db_embedded = (config) => !config.databaseUrl;
