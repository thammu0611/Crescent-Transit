// Parents and guardians: a read-only account linked to a student.
//
// The student decides. They make a one-time code in the app and give it to the
// parent, who uses it to sign up or to add a second child, and they can remove
// a parent at any time. A parent sees the child's route, today's two trips and
// where the bus is. Never the phone's location: the app does not store it.
import { busLabel } from '../shared/institution.js';
import crypto from 'node:crypto';
import { DOWN } from '../shared/direction.js';
import { HttpError } from './auth.js';
import { PRESENT_SQL } from './attendance.js';
import { localDate } from './clock.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const CODE_LENGTH = 8;

export class GuardianService {
  constructor(db, config, { tracking, billing, push = null, messaging = null }) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
    this.billing = billing;
    this.push = push;
    this.messaging = messaging; // WhatsApp/SMS to parents without the app
  }

  /** One line for WhatsApp/SMS: the app's name, then the title and body. */
  textFor({ title, body }) {
    return `${this.config.institution.appName}: ${title}. ${body}`;
  }

  hash(code) {
    const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return crypto.createHmac('sha256', this.config.jwtSecret).update(`guardian:${clean}`).digest('hex');
  }

  /** A new one-time code; any earlier unused code of this student stops working. */
  async createCode(studentId) {
    const code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
    const expiresAt = new Date(Date.now() + this.config.guardians.codeValidHours * 3600000);
    await this.db.query('DELETE FROM guardian_codes WHERE student_id = $1', [studentId]);
    await this.db.query('INSERT INTO guardian_codes (code_hash, student_id, expires_at) VALUES ($1, $2, $3)', [this.hash(code), studentId, expiresAt]);
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** The student a code belongs to, without using it up. */
  async studentForCode(code) {
    const { rows } = await this.db.query(
      `SELECT g.student_id FROM guardian_codes g JOIN users u ON u.id = g.student_id
        WHERE g.code_hash = $1 AND g.expires_at > now() AND u.status = 'active'`,
      [this.hash(code)],
    );
    if (!rows[0]) throw new HttpError(400, 'That code is wrong or has expired. Ask the student for a new one.', { code: 'BAD_LINK_CODE' });
    return rows[0].student_id;
  }

  /** Link a parent with a code. A code works once. */
  async link(parentId, code) {
    const studentId = await this.studentForCode(code);
    await this.db.query('INSERT INTO guardian_links (parent_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [parentId, studentId]);
    await this.db.query('DELETE FROM guardian_codes WHERE student_id = $1', [studentId]);
    return { studentId };
  }

  /** The parents who can see this student. */
  async parentsOf(studentId) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.full_name, u.email, l.created_at FROM guardian_links l JOIN users u ON u.id = l.parent_id
        WHERE l.student_id = $1 ORDER BY l.created_at`,
      [studentId],
    );
    return rows;
  }

  async unlink(studentId, parentId) {
    const { rowCount } = await this.db.query('DELETE FROM guardian_links WHERE student_id = $1 AND parent_id = $2', [studentId, parentId]);
    if (!rowCount) throw new HttpError(404, 'That parent is not linked');
    return { ok: true };
  }

  /** How one direction's trip stands today, for a parent. */
  static tripState(record) {
    if (!record) return { state: 'NOT_YET' };
    const base = {
      fleetCode: record.fleet_code,
      boardedAt: record.boarded_at,
      boardingStop: record.boarding_stop,
      reachedAt: record.alighted_at,
      reachedStop: record.alighting_stop,
    };
    if (!record.present) return { ...base, state: 'WAITING' };
    return { ...base, state: record.alighted_at ? 'REACHED' : 'ON_BOARD' };
  }

  /** Everything a parent's home screen shows. */
  async children(parentId, now = Date.now()) {
    const tz = this.config.timeZone;
    const date = localDate(new Date(now), tz);
    const { rows: kids } = await this.db.query(
      `SELECT u.id, u.full_name, u.register_no, u.department, u.home_route_id, u.home_stop_seq,
              r.code AS route_code, r.name AS route_name, s.name AS stop_name
         FROM guardian_links l
         JOIN users u ON u.id = l.student_id
         LEFT JOIN routes r ON r.id = u.home_route_id
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE l.parent_id = $1 AND u.status = 'active' ORDER BY u.full_name`,
      [parentId],
    );
    if (!kids.length) return [];
    const { rows: records } = await this.db.query(
      `SELECT DISTINCT ON (a.user_id, t.direction) a.user_id, t.direction, ${PRESENT_SQL} AS present, a.boarded_at, a.alighted_at,
              b.fleet_code, bs.name AS boarding_stop, als.name AS alighting_stop
         FROM attendance a
         JOIN trips t ON t.id = a.trip_id
         JOIN buses b ON b.id = a.bus_id
         LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
         LEFT JOIN stops als ON als.id = a.alighting_stop_id
        WHERE a.user_id = ANY($1::int[]) AND (a.boarded_at AT TIME ZONE $2)::date = $3 AND a.status NOT IN ('REJECTED', 'VOID')
        ORDER BY a.user_id, t.direction, a.boarded_at DESC`,
      [kids.map((k) => k.id), tz, date],
    );
    const direction = this.tracking.defaultDirection(new Date(now));
    const out = [];
    for (const k of kids) {
      const access = await this.billing.access(k.id);
      const mine = records.filter((r) => r.user_id === k.id);
      const bus = access.active ? this.busFor(k, direction) : null;
      out.push({
        id: k.id,
        name: k.full_name,
        registerNo: k.register_no,
        department: k.department,
        routeCode: k.route_code,
        routeName: k.route_name,
        stopName: k.stop_name,
        inbound: GuardianService.tripState(mine.find((r) => r.direction === 'UP')),
        outbound: GuardianService.tripState(mine.find((r) => r.direction === DOWN)),
        liveLocked: !access.active,
        bus,
      });
    }
    return out;
  }

  /** The child's bus on its current run, if one is running. */
  busFor(kid, direction) {
    const bus = this.tracking.liveSnapshot().find((b) => b.routeId === kid.home_route_id && b.direction === direction)
      ?? this.tracking.liveSnapshot().find((b) => b.routeId === kid.home_route_id);
    if (!bus) return null;
    const eta = kid.home_stop_seq ? this.tracking.estimate(bus.routeId, bus, kid.home_stop_seq) : null;
    return {
      fleetCode: bus.fleetCode,
      direction: bus.direction,
      freshness: bus.freshness,
      recordedAt: bus.recordedAt,
      nearStop: bus.nearestStop?.name ?? null,
      eta: eta ? (eta.passed ? { passed: true } : { low: eta.low, high: eta.high }) : null,
    };
  }

  /** Tell these parents something: kept for their app, and pushed to their phone. */
  async tellParents(parentIds, { kind, title, body }) {
    for (const id of new Set(parentIds)) {
      await this.db.query('INSERT INTO parent_alerts (parent_id, kind, title, body) VALUES ($1, $2, $3, $4)', [id, kind, title, body]);
      this.push?.toUser(id, { title, body, data: { type: 'guardian', kind } });
    }
    return { told: new Set(parentIds).size };
  }

  /** Every parent with a child on this route, and the WhatsApp/SMS numbers students added. */
  async toRouteParents(routeId, message) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT l.parent_id FROM guardian_links l JOIN users u ON u.id = l.student_id WHERE u.home_route_id = $1 AND u.status = 'active'`,
      [routeId],
    );
    const told = await this.tellParents(rows.map((r) => r.parent_id), message);
    const texted = await this.messaging?.toRouteContacts(routeId, this.textFor(message), message.kind);
    return { ...told, texted: texted?.sent ?? 0 };
  }

  /** The parents of one student, in the app and by WhatsApp/SMS. */
  async toChildParents(studentId, message) {
    const { rows } = await this.db.query('SELECT parent_id FROM guardian_links WHERE student_id = $1', [studentId]);
    const told = await this.tellParents(rows.map((r) => r.parent_id), message);
    const texted = await this.messaging?.toStudentsContacts([studentId], this.textFor(message), message.kind);
    return { ...told, texted: texted?.sent ?? 0 };
  }

  async alertsFor(parentId) {
    const { rows } = await this.db.query(
      'SELECT id, kind, title, body, created_at FROM parent_alerts WHERE parent_id = $1 ORDER BY created_at DESC LIMIT 20',
      [parentId],
    );
    return rows;
  }

  /** Every minute: tell parents when a child boards and when they arrive. Each once. */
  async sendNotices(now = Date.now()) {
    const since = new Date(now - 2 * 3600000);
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, a.alighted_at, t.direction, u.full_name, b.fleet_code, l.parent_id,
              NOT EXISTS (SELECT 1 FROM guardian_notices n WHERE n.parent_id = l.parent_id AND n.attendance_id = a.attendance_id AND n.kind = 'BOARDED') AS boarded_due,
              a.alighted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM guardian_notices n WHERE n.parent_id = l.parent_id AND n.attendance_id = a.attendance_id AND n.kind = 'REACHED') AS reached_due
         FROM attendance a
         JOIN guardian_links l ON l.student_id = a.user_id
         JOIN users u ON u.id = a.user_id
         JOIN trips t ON t.id = a.trip_id
         JOIN buses b ON b.id = a.bus_id
        WHERE ${PRESENT_SQL} AND coalesce(a.alighted_at, a.boarded_at) > $1`,
      [since],
    );
    let sent = 0;
    for (const r of rows) {
      const bus = busLabel(r.fleet_code);
      const place = r.direction === DOWN ? 'their stop' : 'college';
      const send = async (kind, title, body) => {
        const { rows: fresh } = await this.db.query(
          'INSERT INTO guardian_notices (parent_id, attendance_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING parent_id',
          [r.parent_id, r.attendance_id, kind],
        );
        if (!fresh[0]) return;
        this.push?.toUser(r.parent_id, { title, body, data: { type: 'guardian' } });
        sent += 1;
      };
      if (r.boarded_due) await send('BOARDED', `${r.full_name} boarded ${bus}`, `On the way to ${place}.`);
      if (r.reached_due) await send('REACHED', `${r.full_name} reached ${place}`, `Got off ${bus}.`);
    }
    const texted = await this.textNotices(since);
    return { sent: sent + texted };
  }

  /** The same boarded and reached notices to the WhatsApp/SMS numbers students added. */
  async textNotices(since) {
    if (!this.messaging?.configured) return 0;
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, a.alighted_at, t.direction, u.full_name, b.fleet_code, c.id AS contact_id, c.phone, c.channel,
              NOT EXISTS (SELECT 1 FROM contact_notices n WHERE n.contact_id = c.id AND n.attendance_id = a.attendance_id AND n.kind = 'BOARDED') AS boarded_due,
              a.alighted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contact_notices n WHERE n.contact_id = c.id AND n.attendance_id = a.attendance_id AND n.kind = 'REACHED') AS reached_due
         FROM attendance a
         JOIN guardian_contacts c ON c.student_id = a.user_id AND c.active
         JOIN users u ON u.id = a.user_id
         JOIN trips t ON t.id = a.trip_id
         JOIN buses b ON b.id = a.bus_id
        WHERE ${PRESENT_SQL} AND coalesce(a.alighted_at, a.boarded_at) > $1`,
      [since],
    );
    let sent = 0;
    for (const r of rows) {
      const bus = busLabel(r.fleet_code);
      const place = r.direction === DOWN ? 'their stop' : 'college';
      const text = async (kind, title, body) => {
        const { rows: fresh } = await this.db.query(
          'INSERT INTO contact_notices (contact_id, attendance_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING contact_id',
          [r.contact_id, r.attendance_id, kind],
        );
        if (!fresh[0]) return;
        if ((await this.messaging.send({ to: r.phone, channel: r.channel, kind, text: this.textFor({ title, body }) })).ok) sent += 1;
      };
      if (r.boarded_due) await text('BOARDED', `${r.full_name} boarded ${bus}`, `On the way to ${place}.`);
      if (r.reached_due) await text('REACHED', `${r.full_name} reached ${place}`, `Got off ${bus}.`);
    }
    return sent;
  }
}
