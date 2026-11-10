// "Did you board?" from the bus GPS.
//
// The co-location engine (attendance.js) needs the student's phone location.
// This needs nothing from the student: the bus position alone - from the GPS
// tracker fitted in the bus, or the driver's phone - shows when the bus has
// left each stop. Every student who saved that stop as theirs is then asked
// "Did you board Bus 118 at Velachery?", and reminded every 10 minutes
// (config.boardingCheck.remindEveryMinutes) until they answer.
//
// On the DOWN run everyone boards at the college, so every student of the
// route is asked once, when the bus leaves the campus. A DOWN record closes at
// the student's own stop as the bus goes past it.
//
// A "Yes" is an attendance record (method STOP). A question the student
// answers some other way - the phone's own prompt, the bus QR code, the
// driver's list - closes by itself.
import { busLabel } from '../shared/institution.js';
import { inWindows } from '../shared/colocation.js';
import { DOWN, travelOrder } from '../shared/direction.js';
import { haversineMeters } from '../shared/geo.js';
import { HttpError } from './auth.js';
import { localMinutes } from './clock.js';

/** An attendance record that settles the question: answered, or not taken by the phone at all. */
const SETTLED_SQL = `(a.answered_at IS NOT NULL OR a.method <> 'GPS')`;

export class BoardingCheckService {
  constructor(db, config, { tracking, attendance, calendar = null, io = null, push = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.boardingCheck;
    this.tracking = tracking;
    this.attendance = attendance;
    this.calendar = calendar;
    this.io = io;
    this.push = push;
    this.trips = new Map(); // tripId -> how many stops of the run have been dealt with

    tracking.on('fix', (snap) => this.onBusFix(snap));
    tracking.on('tripEnded', ({ tripId }) => this.trips.delete(tripId));
    attendance.boarding = this; // answers given in the attendance engine close questions here
  }

  remindMs() {
    return this.settings.remindEveryMinutes * 60000;
  }

  // ---- Detecting departures from the bus GPS ------------------------------------

  /**
   * Every accepted bus fix (after the stop arrival is recorded). A stop is
   * left once the bus has reached a later stop, or is departRadiusM past it.
   * Stops the bus skipped without a fix nearby count as left too.
   */
  async onBusFix(snap, now = Date.now()) {
    if (!this.settings.enabled || (await this.calendar?.isPaused(now))) return;
    const reachedSeq = this.tracking.lastArrivedSeq.get(snap.tripId);
    const stops = travelOrder(this.tracking.stopsByRoute.get(snap.routeId) ?? [], snap.direction);
    const reached = stops.findIndex((s) => s.seq === reachedSeq);
    if (reached < 0 || stops.length < 2) return;

    const left = haversineMeters(stops[reached], snap) >= this.settings.departRadiusM ? reached + 1 : reached;
    const done = this.trips.get(snap.tripId) ?? 0;
    if (left <= done) return;
    this.trips.set(snap.tripId, left);
    const passed = stops.slice(done, left);
    if (snap.direction === DOWN) {
      if (done === 0) await this.askStudents(snap, stops.slice(1), stops[0], now);
      await this.attendance.alightPassed(snap.tripId, passed.map((s) => s.seq), new Date(now));
    } else {
      // Nobody boards at the campus, the run's last stop.
      await this.askStudents(snap, passed.filter((s) => s !== stops.at(-1)), null, now);
    }
  }

  /**
   * Ask every student whose saved stop is one of `homeStops`. `boardedAt` is the
   * stop they boarded at when that is not their own: the campus, on the DOWN run.
   */
  async askStudents(snap, homeStops, boardedAt, now = Date.now()) {
    if (!homeStops.length) return 0;
    // Students already recorded on this trip (phone prompt, QR, driver) are not asked.
    const { rows } = await this.db.query(
      `SELECT u.id, u.travel_windows, s.id AS stop_id
         FROM users u JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE u.role = 'student' AND u.status = 'active' AND u.boarding_reminders
          AND u.home_route_id = $1 AND u.home_stop_seq = ANY($2::int[])
          AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.trip_id = $3)`,
      [snap.routeId, homeStops.map((s) => s.seq), snap.tripId],
    );
    const minutes = localMinutes(new Date(now), this.config.timeZone);
    let asked = 0;
    for (const u of rows) {
      // Outside the student's own travel window they are not travelling.
      if (!inWindows(minutes, this.attendance.windowsFor(u))) continue;
      const { rows: created } = await this.db.query(
        `INSERT INTO boarding_checks (user_id, trip_id, bus_id, stop_id, departed_at, last_sent_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, trip_id) DO NOTHING RETURNING check_id`,
        [u.id, snap.tripId, snap.busId, boardedAt?.id ?? u.stop_id, new Date(now)],
      );
      if (!created[0]) continue;
      await this.send(created[0].check_id, { reminder: false });
      asked += 1;
    }
    return asked;
  }

  // ---- Delivery ---------------------------------------------------------------------

  async load(checkId) {
    const { rows } = await this.db.query(
      `SELECT c.*, b.fleet_code, r.code AS route_code, r.name AS route_name, s.name AS stop_name, t.status AS trip_status, t.direction
         FROM boarding_checks c
         JOIN buses b ON b.id = c.bus_id
         JOIN trips t ON t.id = c.trip_id
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN stops s ON s.id = c.stop_id
        WHERE c.check_id = $1`,
      [checkId],
    );
    return rows[0] ?? null;
  }

  /** What the apps show: the question, and when the next reminder comes. */
  payload(c) {
    return {
      checkId: c.check_id,
      tripId: c.trip_id,
      direction: c.direction,
      busId: c.bus_id,
      fleetCode: c.fleet_code,
      routeCode: c.route_code,
      routeName: c.route_name,
      stopName: c.stop_name ?? null,
      departedAt: new Date(c.departed_at).toISOString(),
      status: c.status,
      reminders: c.reminders,
      tripRunning: c.trip_status === 'active',
      remindEveryMinutes: this.settings.remindEveryMinutes,
      nextReminderAt: new Date(new Date(c.last_sent_at).getTime() + this.remindMs()).toISOString(),
    };
  }

  /** The question (or a reminder of it) to the open app and, as a push, to a closed one. */
  async send(checkId, { reminder }) {
    const c = await this.load(checkId);
    if (!c) return;
    const p = this.payload(c);
    this.io?.to(`user:${c.user_id}`).emit('boarding:check', { ...p, reminder });
    const bus = busLabel(p.fleetCode);
    this.push?.toUser(c.user_id, {
      title: reminder ? `Reminder: did you board ${bus}?` : `Did you board ${bus}?`,
      body: `${p.stopName ? `${p.stopName} · ` : ''}Route ${p.routeCode} · tap to answer`,
      data: { type: 'boarding:check', checkId: p.checkId },
    });
  }

  closed(userId, checkId, status) {
    this.io?.to(`user:${userId}`).emit('boarding:closed', { checkId, status });
  }

  // ---- The student's answer ----------------------------------------------------------

  async answer(auth, checkId, answer, now = Date.now()) {
    if (answer !== 'YES' && answer !== 'NO') throw new HttpError(400, "answer must be 'YES' or 'NO'");
    const c = (await this.db.query(
      `SELECT c.*, t.status AS trip_status, t.ended_at AS trip_ended_at, t.direction, home.id AS home_stop_id
         FROM boarding_checks c
         JOIN trips t ON t.id = c.trip_id
         JOIN users u ON u.id = c.user_id
         LEFT JOIN stops home ON home.route_id = t.route_id AND home.seq = u.home_stop_seq
        WHERE c.check_id = $1 AND c.user_id = $2`,
      [checkId, auth.userId],
    )).rows[0];
    if (!c) throw new HttpError(404, 'Boarding question not found');
    const status = answer === 'YES' ? 'BOARDED' : 'NOT_BOARDED';
    // Claim the question first: a double tap, or a second phone, answers it once.
    const claimed = await this.db.query(
      `UPDATE boarding_checks SET status = $2, answered_at = $3 WHERE check_id = $1 AND status = 'PENDING' RETURNING check_id`,
      [checkId, status, new Date(now)],
    );
    if (!claimed.rows[0]) {
      throw new HttpError(409, 'This question has already been answered', { code: 'ALREADY_ANSWERED', status: c.status });
    }

    let existing = (await this.db.query('SELECT * FROM attendance WHERE user_id = $1 AND trip_id = $2', [auth.userId, c.trip_id])).rows[0];
    // The phone's own "Are you on Bus 118?" for this trip is still open: this answers it too.
    if (existing?.method === 'GPS' && !existing.answered_at && ['PROMPTED', 'PROVISIONAL'].includes(existing.status)) {
      try {
        await this.attendance.confirm(auth, existing.attendance_id, answer, now);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err; // too old to answer: the admin reviews it
      }
    }
    if (answer === 'YES' && !existing) {
      const ended = c.trip_status !== 'active';
      const { rows } = await this.db.query(
        `INSERT INTO attendance (user_id, trip_id, bus_id, status, method, boarded_at, boarding_stop_id, prompted_at, answered_at, alighted_at, alighting_stop_id)
         VALUES ($1, $2, $3, $4, 'STOP', $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, trip_id) DO NOTHING RETURNING *`,
        [auth.userId, c.trip_id, c.bus_id, ended ? 'COMPLETED' : 'CONFIRMED', c.departed_at, c.stop_id, c.created_at, new Date(now), ended ? c.trip_ended_at : null, ended && c.direction === DOWN ? c.home_stop_id : null],
      );
      if (rows[0]) {
        existing = rows[0];
        await this.attendance.event({ type: 'ANSWER', attendanceId: existing.attendance_id, tripId: c.trip_id, userId: auth.userId, v: null, deviceTs: new Date(now), detail: 'BOARDING_CHECK YES' });
        await this.attendance.checkCapacity(c.trip_id);
        this.attendance.notify(auth.userId, 'attendance:updated', { attendanceId: existing.attendance_id, status: existing.status });
      } else {
        // Recorded a moment ago some other way (QR scan, driver).
        existing = (await this.db.query('SELECT * FROM attendance WHERE user_id = $1 AND trip_id = $2', [auth.userId, c.trip_id])).rows[0];
      }
    }
    const attendanceId = existing?.attendance_id ?? null;
    if (attendanceId) await this.db.query('UPDATE boarding_checks SET attendance_id = $2 WHERE check_id = $1', [checkId, attendanceId]);
    this.closed(auth.userId, checkId, status); // the student's other phone or tab closes its copy
    return { checkId, status, attendanceId };
  }

  /** Called by the attendance engine when a record is answered or made another way. */
  async resolveFromAttendance(userId, tripId, now = Date.now()) {
    const { rows } = await this.db.query(
      `UPDATE boarding_checks c SET status = 'RECORDED', answered_at = $3, attendance_id = a.attendance_id
         FROM attendance a
        WHERE c.status = 'PENDING' AND c.user_id = $1 AND c.trip_id = $2
          AND a.user_id = c.user_id AND a.trip_id = c.trip_id AND ${SETTLED_SQL}
        RETURNING c.check_id`,
      [userId, tripId, new Date(now)],
    );
    for (const r of rows) this.closed(userId, r.check_id, 'RECORDED');
  }

  /** Questions still waiting for this student, newest first. */
  async pending(userId) {
    const { rows } = await this.db.query(
      `SELECT check_id FROM boarding_checks WHERE user_id = $1 AND status = 'PENDING' ORDER BY created_at DESC`,
      [userId],
    );
    const loaded = await Promise.all(rows.map((r) => this.load(r.check_id)));
    return loaded.filter(Boolean).map((c) => this.payload(c));
  }

  // ---- Periodic work (jobs.js 'tick', every 15 s) --------------------------------------

  async tick(now = Date.now()) {
    const at = new Date(now);
    const out = { reminded: 0, recorded: 0, expired: 0 };

    // Settled some other way since the last tick: stop asking.
    const recorded = await this.db.query(
      `UPDATE boarding_checks c SET status = 'RECORDED', answered_at = $1, attendance_id = a.attendance_id
         FROM attendance a
        WHERE c.status = 'PENDING' AND a.user_id = c.user_id AND a.trip_id = c.trip_id AND ${SETTLED_SQL}
        RETURNING c.check_id, c.user_id`,
      [at],
    );
    for (const r of recorded.rows) this.closed(r.user_id, r.check_id, 'RECORDED');
    out.recorded = recorded.rows.length;

    // A question nobody answers is not repeated forever.
    const expired = await this.db.query(
      `UPDATE boarding_checks SET status = 'EXPIRED' WHERE status = 'PENDING' AND departed_at < $1 RETURNING check_id, user_id`,
      [new Date(now - this.settings.giveUpAfterHours * 3600000)],
    );
    for (const r of expired.rows) this.closed(r.user_id, r.check_id, 'EXPIRED');
    out.expired = expired.rows.length;

    // Every remindEveryMinutes until the student answers. Turning reminders off
    // in Settings stops them; the question still waits in the app.
    const due = await this.db.query(
      `UPDATE boarding_checks c SET reminders = c.reminders + 1, last_sent_at = $1
         FROM users u
        WHERE u.id = c.user_id AND u.boarding_reminders AND c.status = 'PENDING' AND c.last_sent_at <= $2
        RETURNING c.check_id`,
      [at, new Date(now - this.remindMs())],
    );
    for (const r of due.rows) await this.send(r.check_id, { reminder: true });
    out.reminded = due.rows.length;
    return out;
  }

  /** Nightly (23:30): the day's unanswered questions expire. */
  async nightly() {
    const { rows } = await this.db.query(`UPDATE boarding_checks SET status = 'EXPIRED' WHERE status = 'PENDING' RETURNING check_id, user_id`);
    for (const r of rows) this.closed(r.user_id, r.check_id, 'EXPIRED');
    return { expired: rows.length };
  }
}
