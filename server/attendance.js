// GPS-based automatic attendance (design document, section 9).
//
// A subscriber's phone and a running bus moving together, twice in a row, is
// a boarding. The student confirms it with one tap; the record then follows
// the state machine of doc 9.5 until the student alights or the trip ends.
//
// Privacy (doc 9.2 / 9.11): student coordinates are compared in memory and
// thrown away. Only the resulting attendance event is stored.
import crypto from 'node:crypto';
import { haversineMeters } from '../shared/geo.js';
import {
  advanceCandidate,
  confidenceScore,
  deriveMotion,
  distanceToPolylineM,
  inWindows,
  matchFix,
  parseWindows,
  unansweredOutcome,
} from '../shared/colocation.js';
import { HttpError } from './auth.js';
import { cacheFor } from './cache.js';
import { localMinutes, monthRange } from './clock.js';
import { audit } from './util.js';

/** Statuses of a record that is still "open" on a trip. */
const OPEN = ['PROMPTED', 'CONFIRMED', 'ON_BOARD', 'PROVISIONAL'];
const ONBOARD = ['CONFIRMED', 'ON_BOARD', 'PROVISIONAL'];

/** Does a record count as present? (doc 9.5, last column) */
export const PRESENT_SQL = `(CASE
    WHEN a.status IN ('CONFIRMED', 'ON_BOARD', 'COMPLETED', 'PROVISIONAL') THEN TRUE
    WHEN a.status = 'ADJUSTED' THEN coalesce(a.adjusted_present, FALSE)
    WHEN a.status = 'DISPUTED' THEN coalesce((SELECT d.previous_status IN ('CONFIRMED', 'ON_BOARD', 'COMPLETED', 'PROVISIONAL')
                                                FROM attendance_disputes d WHERE d.attendance_id = a.attendance_id
                                               ORDER BY d.created_at DESC LIMIT 1), FALSE)
    ELSE FALSE END)`;

const busPoint = (b) => ({ lat: b.lat, lng: b.lng, ts: Date.parse(b.recordedAt), speedKmh: b.speedKmh, bearing: b.heading });

export class AttendanceService {
  constructor(db, config, tracking, billing, io = null, push = null) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
    this.billing = billing;
    this.io = io;
    this.push = push;
    this.rules = config.attendance.rules;
    this.state = new Map(); // userId -> { lastFix, candidate, cooldowns, alightStrikes, conflict }
    this.flaggedTrips = new Set(); // capacity / tracker incidents raised once per trip
    this.boarding = null; // BoardingCheckService, which sets itself here

    tracking.on('tripEnded', (e) => this.onTripEnded(e));
  }

  userState(userId) {
    let s = this.state.get(userId);
    if (!s) {
      s = { lastFix: null, candidate: null, cooldowns: new Map(), alightStrikes: 0, conflict: null };
      this.state.set(userId, s);
    }
    return s;
  }

  windowsFor(user) {
    return parseWindows(user.travel_windows ?? '') ?? parseWindows(this.config.attendance.travelWindows) ?? [[0, 1440]];
  }

  notify(userId, event, payload) {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }

  // ---- Device binding (doc 9.8) ----------------------------------------------

  otpHash(userId, code) {
    return crypto.createHmac('sha256', this.config.jwtSecret).update(`${userId}:${code}`).digest('hex');
  }

  /**
   * Bind the account to one phone. The first phone binds freely; moving to a
   * different phone needs a one-time code, which stops a student leaving their
   * phone on the bus for a friend and signing in on another.
   */
  async bindDevice(auth, { deviceId, platform = 'WEB', pushToken = null, otp = null } = {}, ip = null) {
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 100) throw new HttpError(400, 'deviceId is required');
    const plat = String(platform).toUpperCase();
    if (!['ANDROID', 'IOS', 'WEB'].includes(plat)) throw new HttpError(400, 'platform must be ANDROID, IOS or WEB');
    const { rows } = await this.db.query('SELECT * FROM devices WHERE user_id = $1', [auth.userId]);
    const current = rows[0];
    if (!current) {
      await this.db.query('INSERT INTO devices (user_id, device_uid, platform, push_token) VALUES ($1, $2, $3, $4)', [auth.userId, deviceId, plat, pushToken]);
      return { bound: true, first: true };
    }
    if (current.device_uid === deviceId) {
      if (pushToken) await this.db.query('UPDATE devices SET push_token = $2 WHERE user_id = $1', [auth.userId, pushToken]);
      return { bound: true };
    }
    if (!otp) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await this.db.query(
        `INSERT INTO device_otps (user_id, device_uid, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))
         ON CONFLICT (user_id) DO UPDATE SET device_uid = EXCLUDED.device_uid, code_hash = EXCLUDED.code_hash,
           attempts = 0, expires_at = EXCLUDED.expires_at`,
        [auth.userId, deviceId, this.otpHash(auth.userId, code), this.config.otp.ttlMinutes],
      );
      // No SMS provider is configured in the prototype: the code is logged
      // on the server, and returned in development so the flow can be tested.
      console.log(`[otp] device change code for user ${auth.userId}: ${code}`);
      throw new HttpError(409, 'This account is bound to another phone. Enter the one-time code to move it here.', {
        code: 'OTP_REQUIRED',
        ...(this.config.otp.showInResponse ? { devOtp: code } : {}),
      });
    }
    const pending = (await this.db.query('SELECT * FROM device_otps WHERE user_id = $1', [auth.userId])).rows[0];
    if (!pending || pending.device_uid !== deviceId || new Date(pending.expires_at) < new Date()) throw new HttpError(400, 'The code has expired. Request a new one.');
    if (pending.attempts >= this.config.otp.maxAttempts) throw new HttpError(429, 'Too many attempts. Request a new code.');
    if (pending.code_hash !== this.otpHash(auth.userId, String(otp).trim())) {
      await this.db.query('UPDATE device_otps SET attempts = attempts + 1 WHERE user_id = $1', [auth.userId]);
      throw new HttpError(400, 'Incorrect code');
    }
    await this.db.query(
      `UPDATE devices SET device_uid = $2, platform = $3, push_token = $4, bound_at = now(), mock_location_flag = FALSE WHERE user_id = $1`,
      [auth.userId, deviceId, plat, pushToken],
    );
    await this.db.query('DELETE FROM device_otps WHERE user_id = $1', [auth.userId]);
    await audit(this.db, { actorId: auth.userId, action: 'DEVICE_REBOUND', entity: 'device', entityId: auth.userId, ip });
    this.state.delete(auth.userId);
    return { bound: true, moved: true };
  }

  /** What the phone should do: sample or not, how often, and why. */
  async samplingPlan(userId, now = new Date()) {
    const u = await this.riderSettings(userId);
    const windows = this.windowsFor(u);
    const ent = await this.billing.access(userId);
    const inWindow = inWindows(localMinutes(now, this.config.timeZone), windows);
    return {
      consent: u.location_consent,
      subscribed: ent.active,
      deviceBound: Boolean(u.device_uid),
      deviceId: u.device_uid ?? null,
      mockLocationFlag: Boolean(u.mock_location_flag),
      travelWindows: u.travel_windows ?? this.config.attendance.travelWindows,
      inTravelWindow: inWindow,
      intervalS: this.config.attendance.sampleIntervalS,
      corridorM: this.rules.corridorM,
      shouldSample: u.location_consent && ent.active && Boolean(u.device_uid) && inWindow,
    };
  }

  // ---- The matcher (doc 9.3) ---------------------------------------------------

  /**
   * Consent, travel window and bound phone: read on every fix (each student
   * every 20 s), so cached; a write to users or devices refreshes it.
   */
  riderSettings(userId) {
    return cacheFor(this.db).get(`rider:${userId}`, ['users', 'devices'], 30000, async () => (await this.db.query(
      `SELECT u.id, u.location_consent, u.travel_windows, d.device_uid, d.mock_location_flag
         FROM users u LEFT JOIN devices d ON d.user_id = u.id WHERE u.id = $1`,
      [userId],
    )).rows[0]);
  }

  /**
   * One student device fix. Never stored: it is compared with the cached bus
   * positions and discarded. Returns what the engine did, for the app.
   */
  async handleDeviceFix(auth, body = {}, now = Date.now()) {
    const user = await this.riderSettings(auth.userId);
    if (!user.location_consent) throw new HttpError(409, 'Location consent has not been given', { code: 'CONSENT_REQUIRED' });
    if (!user.device_uid || user.device_uid !== body.deviceId) throw new HttpError(409, 'This phone is not the one bound to the account', { code: 'DEVICE_NOT_BOUND' });

    const { lat, lng, accuracyM } = body;
    const ts = Date.parse(body.recordedAt);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Invalid coordinates');
    if (!Number.isFinite(ts)) throw new HttpError(400, 'recordedAt must be an ISO date-time');
    if (ts > now + 30000 || now - ts > 120000) return { used: false, reason: 'STALE_OR_FUTURE_FIX' };
    if (Number.isFinite(accuracyM) && accuracyM > 100) return { used: false, reason: 'LOW_ACCURACY' };

    // Android / iOS mock-location flag: stored, and a flagged record never auto-confirms.
    let mock = Boolean(user.mock_location_flag);
    if (body.mockLocation === true && !mock) {
      mock = true;
      await this.db.query('UPDATE devices SET mock_location_flag = TRUE WHERE user_id = $1', [auth.userId]);
      await this.raiseIncident({ kind: 'MOCK_LOCATION', userId: auth.userId, message: 'The phone reported a mock (fake) location' });
    }

    if (!inWindows(localMinutes(new Date(ts), this.config.timeZone), this.windowsFor(user))) {
      return { used: false, reason: 'OUTSIDE_TRAVEL_WINDOW' };
    }

    const st = this.userState(auth.userId);
    const device = deriveMotion(
      { lat, lng, ts, speedKmh: Number.isFinite(body.speedKmh) ? body.speedKmh : null, bearing: Number.isFinite(body.heading) ? body.heading : null },
      st.lastFix,
    );
    st.lastFix = { lat, lng, ts };

    const open = (
      await this.db.query(
        `SELECT a.* FROM attendance a JOIN trips t ON t.id = a.trip_id
          WHERE a.user_id = $1 AND a.status = ANY($2) AND a.alighted_at IS NULL AND t.status = 'active'
          ORDER BY a.created_at DESC LIMIT 1`,
        [auth.userId, OPEN],
      )
    ).rows[0];
    if (open) return this.followOpenRecord(auth.userId, st, open, device, mock);

    const live = this.tracking.liveSnapshot().filter((b) => b.freshness !== 'offline');
    // Corridor filter (doc 9.10): far from every running route, do nothing.
    const routes = new Set(live.map((b) => b.routeId));
    const nearCorridor = [...routes].some(
      (routeId) => distanceToPolylineM(device, this.tracking.stopsByRoute.get(routeId) ?? []) <= this.rules.corridorM,
    );
    if (!nearCorridor) {
      st.candidate = null;
      return { used: true, matched: false, reason: 'AWAY_FROM_RUNNING_ROUTES' };
    }

    const matches = [];
    for (const b of live) {
      const v = matchFix(device, busPoint(b), this.rules);
      if (v.match) matches.push({ bus: b, v });
    }
    // Two buses together in the same direction within 50 m: ambiguous, wait.
    const hit = matches.length === 1 ? matches[0] : null;
    const { candidate, ready } = advanceCandidate(st.candidate, hit?.bus.tripId ?? null, device.ts, this.rules);
    st.candidate = candidate && hit && candidate.count === 1 ? { ...candidate, stopId: hit.bus.nearestStop?.id ?? null } : candidate;
    if (!hit) return { used: true, matched: false, reason: matches.length > 1 ? 'AMBIGUOUS' : 'NO_BUS_TOGETHER' };

    await this.event({ type: 'MATCH', tripId: hit.bus.tripId, userId: auth.userId, v: hit.v, deviceTs: device.ts, detail: mock ? 'mock-location device' : null });
    if (!ready) return { used: true, matched: true, count: candidate.count };

    const tripId = hit.bus.tripId;
    const cooldown = st.cooldowns.get(tripId);
    if (cooldown && cooldown > now) return { used: true, matched: true, reason: 'COOLDOWN' };

    // One prompt per trip per student: UNIQUE (user_id, trip_id) guarantees it.
    const inserted = await this.db.query(
      `INSERT INTO attendance (user_id, trip_id, bus_id, status, method, boarded_at, boarding_stop_id,
                               first_match_at, last_match_at, prompted_at, flagged, flag_reason)
       VALUES ($1, $2, $3, 'PROMPTED', 'GPS', $4, $5, $4, $6, now(), $7, $8)
       ON CONFLICT (user_id, trip_id) DO NOTHING RETURNING attendance_id`,
      [auth.userId, tripId, hit.bus.busId, new Date(candidate.firstTs), st.candidate.stopId ?? null, new Date(candidate.lastTs), mock, mock ? 'MOCK_LOCATION' : null],
    );
    if (!inserted.rows[0]) return { used: true, matched: true, reason: 'ALREADY_RECORDED_FOR_TRIP' };
    const attendanceId = inserted.rows[0].attendance_id;
    // The matches that led here become the record's evidence (doc 9.8).
    await this.db.query(
      `UPDATE attendance_events SET attendance_id = $1
        WHERE user_id = $2 AND trip_id = $3 AND event_type = 'MATCH' AND attendance_id IS NULL`,
      [attendanceId, auth.userId, tripId],
    );
    await this.event({ type: 'PROMPT', attendanceId, tripId, userId: auth.userId, v: hit.v, deviceTs: device.ts });
    const prompt = await this.promptPayload(attendanceId);
    this.notify(auth.userId, 'attendance:prompt', prompt);
    // Also as a push notification: the socket only reaches an open app. Tapping
    // it opens the app, which loads the waiting question (pending()).
    this.push?.toUser(auth.userId, {
      title: `Are you on ${prompt.fleetCode}?`,
      body: `${prompt.routeName} · tap to confirm your attendance`,
      data: { type: 'attendance:prompt', attendanceId },
    });
    st.candidate = null;
    return { used: true, matched: true, prompted: true, prompt };
  }

  /** The student already has a record on a running trip: follow it (doc 9.6). */
  async followOpenRecord(userId, st, open, device, mock) {
    const bus = this.tracking.latest.get(open.bus_id);
    if (!bus || bus.tripId !== open.trip_id) return { used: true, attendanceId: open.attendance_id, status: open.status };
    const v = matchFix(device, busPoint(bus), this.rules);
    const distance = haversineMeters(device, bus);

    if (open.status === 'PROMPTED') {
      if (v.match) await this.db.query('UPDATE attendance SET last_match_at = $2 WHERE attendance_id = $1', [open.attendance_id, new Date(device.ts)]);
      return { used: true, attendanceId: open.attendance_id, status: 'PROMPTED' };
    }

    // Uniqueness (doc 9.3): a persistent match with another bus is refused and logged.
    const other = this.tracking.liveSnapshot().find((b) => b.tripId !== open.trip_id && b.freshness !== 'offline' && matchFix(device, busPoint(b), this.rules).match);
    if (other) {
      const c = st.conflict && st.conflict.tripId === other.tripId ? st.conflict.count + 1 : 1;
      st.conflict = { tripId: other.tripId, count: c };
      if (c === this.rules.persistenceMatches) {
        await this.raiseIncident({
          kind: 'ATTENDANCE_CONFLICT', userId, tripId: other.tripId, busId: other.busId,
          message: `Matched bus ${other.fleetCode} while recorded on trip ${open.trip_id}; refused`,
        });
        await this.event({ type: 'FLAG', attendanceId: open.attendance_id, tripId: open.trip_id, userId, v: null, deviceTs: device.ts, detail: `SECOND_BUS_MATCH trip ${other.tripId}` });
      }
    } else st.conflict = null;

    const skewS = Math.abs(device.ts - Date.parse(bus.recordedAt)) / 1000;
    if (distance > this.rules.alightDistanceM && skewS <= this.rules.maxSkewS) {
      st.alightStrikes += 1;
      if (st.alightStrikes >= this.rules.alightSamples) {
        st.alightStrikes = 0;
        const stop = this.tracking.nearestStop(bus.routeId, device);
        await this.closeRecord(open, { at: new Date(device.ts), stopId: stop?.id ?? null, detail: `${Math.round(distance)} m from the bus` });
        return { used: true, attendanceId: open.attendance_id, status: open.status === 'PROVISIONAL' ? 'PROVISIONAL' : 'COMPLETED', alighted: true };
      }
    } else {
      st.alightStrikes = 0;
    }
    if (v.match && open.status === 'CONFIRMED') {
      await this.db.query(`UPDATE attendance SET status = 'ON_BOARD' WHERE attendance_id = $1 AND status = 'CONFIRMED'`, [open.attendance_id]);
      this.notify(userId, 'attendance:updated', { attendanceId: open.attendance_id, status: 'ON_BOARD' });
      return { used: true, attendanceId: open.attendance_id, status: 'ON_BOARD' };
    }
    return { used: true, attendanceId: open.attendance_id, status: open.status };
  }

  /** Alighting: close with time and stop. A provisional record stays provisional. */
  async closeRecord(row, { at, stopId, detail }) {
    const status = row.status === 'PROVISIONAL' || row.status === 'PROMPTED' ? row.status : 'COMPLETED';
    await this.db.query(
      `UPDATE attendance SET status = $2, alighted_at = $3, alighting_stop_id = $4 WHERE attendance_id = $1`,
      [row.attendance_id, status, at, stopId],
    );
    await this.event({ type: 'ALIGHT', attendanceId: row.attendance_id, tripId: row.trip_id, userId: row.user_id, v: null, deviceTs: at, detail });
    this.notify(row.user_id, 'attendance:updated', { attendanceId: row.attendance_id, status });
  }

  async promptPayload(attendanceId) {
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, a.trip_id, a.bus_id, a.boarded_at, a.prompted_at, a.status,
              b.fleet_code, r.code AS route_code, r.name AS route_name, s.name AS stop_name
         FROM attendance a
         JOIN buses b ON b.id = a.bus_id
         JOIN trips t ON t.id = a.trip_id
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN stops s ON s.id = a.boarding_stop_id
        WHERE a.attendance_id = $1`,
      [attendanceId],
    );
    const a = rows[0];
    return {
      attendanceId: a.attendance_id,
      tripId: a.trip_id,
      busId: a.bus_id,
      fleetCode: a.fleet_code,
      routeCode: a.route_code,
      routeName: a.route_name,
      stopName: a.stop_name,
      boardedAt: a.boarded_at,
      status: a.status,
      expiresAt: new Date(new Date(a.prompted_at).getTime() + this.rules.pendingPromptMaxS * 1000).toISOString(),
    };
  }

  // ---- The prompt (doc 9.4) ----------------------------------------------------

  async confirm(auth, attendanceId, answer, now = Date.now()) {
    if (answer !== 'YES' && answer !== 'NO') throw new HttpError(400, "answer must be 'YES' or 'NO'");
    const { rows } = await this.db.query(
      `SELECT a.*, t.status AS trip_status, t.ended_at AS trip_ended_at
         FROM attendance a JOIN trips t ON t.id = a.trip_id
        WHERE a.attendance_id = $1 AND a.user_id = $2`,
      [attendanceId, auth.userId],
    );
    const a = rows[0];
    if (!a) throw new HttpError(404, 'Attendance record not found');
    const age = (now - new Date(a.prompted_at).getTime()) / 1000;
    // The prompt waits in the app for up to 30 minutes; after the 3-minute
    // timeout an unanswered, strongly co-located record is PROVISIONAL and can
    // still be answered by the student until an admin reviews it.
    const answerable = a.method === 'GPS' && !a.answered_at && (a.status === 'PROMPTED' || a.status === 'PROVISIONAL') && age <= this.rules.pendingPromptMaxS;
    if (!answerable) throw new HttpError(409, 'This prompt can no longer be answered');

    let status;
    if (answer === 'YES') {
      const ended = a.alighted_at || a.trip_status !== 'active';
      status = ended ? 'COMPLETED' : 'CONFIRMED';
      const span = (new Date(a.last_match_at) - new Date(a.first_match_at)) / 1000;
      const ev = (
        await this.db.query(
          `SELECT distance_m, bearing_delta FROM attendance_events WHERE attendance_id = $1 AND event_type = 'PROMPT' LIMIT 1`,
          [a.attendance_id],
        )
      ).rows[0];
      await this.db.query(
        `UPDATE attendance SET status = $2, answered_at = now(), confidence = $3,
                alighted_at = CASE WHEN $4::boolean AND alighted_at IS NULL THEN $5::timestamptz ELSE alighted_at END
          WHERE attendance_id = $1`,
        [a.attendance_id, status, confidenceScore({ distanceM: Number(ev?.distance_m), bearingDelta: Number(ev?.bearing_delta), spanS: span }, this.rules),
          a.trip_status !== 'active', a.trip_ended_at],
      );
      await this.checkCapacity(a.trip_id);
    } else {
      status = 'REJECTED';
      await this.db.query(`UPDATE attendance SET status = 'REJECTED', answered_at = now() WHERE attendance_id = $1`, [a.attendance_id]);
      this.userState(auth.userId).cooldowns.set(a.trip_id, now + this.rules.noCooldownS * 1000);
    }
    await this.event({ type: 'ANSWER', attendanceId: a.attendance_id, tripId: a.trip_id, userId: auth.userId, v: null, deviceTs: new Date(now), detail: answer });
    this.notify(auth.userId, 'attendance:updated', { attendanceId: a.attendance_id, status });
    await this.boarding?.resolveFromAttendance(auth.userId, a.trip_id, now);
    return { attendanceId: a.attendance_id, status };
  }

  /** Prompts waiting in the app (notifications off, or the app was closed). */
  async pending(userId, now = Date.now()) {
    const { rows } = await this.db.query(
      `SELECT attendance_id FROM attendance
        WHERE user_id = $1 AND method = 'GPS' AND answered_at IS NULL AND status IN ('PROMPTED', 'PROVISIONAL')
          AND prompted_at > $2 ORDER BY prompted_at DESC`,
      [userId, new Date(now - this.rules.pendingPromptMaxS * 1000)],
    );
    return Promise.all(rows.map((r) => this.promptPayload(r.attendance_id)));
  }

  // ---- Periodic work -------------------------------------------------------------

  /** Every few seconds: time out prompts, and close records on dead trackers. */
  async tick(now = Date.now()) {
    const expired = await this.db.query(
      `SELECT * FROM attendance WHERE status = 'PROMPTED' AND prompted_at < $1`,
      [new Date(now - this.rules.promptTimeoutS * 1000)],
    );
    const out = { provisional: 0, dropped: 0, trackerClosed: 0 };
    for (const a of expired.rows) {
      const outcome = unansweredOutcome(new Date(a.first_match_at).getTime(), new Date(a.last_match_at).getTime(), this.rules);
      if (outcome === 'PROVISIONAL') {
        await this.db.query(`UPDATE attendance SET status = 'PROVISIONAL' WHERE attendance_id = $1 AND status = 'PROMPTED'`, [a.attendance_id]);
        await this.event({ type: 'FLAG', attendanceId: a.attendance_id, tripId: a.trip_id, userId: a.user_id, v: null, deviceTs: null, detail: 'NO_ANSWER_PROVISIONAL' });
        this.notify(a.user_id, 'attendance:updated', { attendanceId: a.attendance_id, status: 'PROVISIONAL' });
        out.provisional += 1;
      } else {
        await this.event({ type: 'FLAG', attendanceId: a.attendance_id, tripId: a.trip_id, userId: a.user_id, v: null, deviceTs: null, detail: 'NO_ANSWER_DROPPED' });
        await this.db.query(`DELETE FROM attendance WHERE attendance_id = $1 AND status = 'PROMPTED'`, [a.attendance_id]);
        // Never prompt again for this trip.
        this.userState(a.user_id).cooldowns.set(a.trip_id, Number.MAX_SAFE_INTEGER);
        this.notify(a.user_id, 'attendance:updated', { attendanceId: a.attendance_id, status: 'DROPPED' });
        out.dropped += 1;
      }
    }

    // The bus tracker died mid-trip (doc 11.2): close open records at the last
    // known position and flag the trip for review.
    const cutoff = now - this.config.attendance.trackerOfflineMinutes * 60000;
    for (const bus of this.tracking.latest.values()) {
      if (Date.parse(bus.recordedAt) > cutoff) continue;
      const open = await this.db.query(
        `SELECT * FROM attendance WHERE trip_id = $1 AND status = ANY($2) AND alighted_at IS NULL`,
        [bus.tripId, ONBOARD],
      );
      if (!open.rows.length) continue;
      for (const a of open.rows) {
        await this.closeRecord(a, { at: new Date(bus.recordedAt), stopId: bus.nearestStop?.id ?? null, detail: 'TRACKER_OFFLINE: closed at last known position' });
        out.trackerClosed += 1;
      }
      await this.flagTrip(bus.tripId, 'TRACKER_OFFLINE', { busId: bus.busId, routeId: bus.routeId, lat: bus.lat, lng: bus.lng });
    }
    return out;
  }

  async onTripEnded({ tripId, lastPosition }) {
    const { rows } = await this.db.query(
      `SELECT * FROM attendance WHERE trip_id = $1 AND status = ANY($2) AND alighted_at IS NULL`,
      [tripId, ONBOARD],
    );
    for (const a of rows) {
      await this.closeRecord(a, { at: new Date(), stopId: lastPosition?.nearestStop?.id ?? null, detail: 'TRIP_ENDED' });
    }
    for (const s of this.state.values()) {
      if (s.candidate?.tripId === tripId) s.candidate = null;
      s.cooldowns.delete(tripId);
    }
  }

  /**
   * Nightly at 23:30 (doc 9.5): lock finished records; auto-confirm provisional
   * records older than 72 h (never flagged ones); apply the retention rule.
   */
  async nightly() {
    const auto = await this.db.query(
      `UPDATE attendance a SET auto_confirmed = TRUE,
              status = CASE WHEN a.alighted_at IS NOT NULL OR t.status <> 'active' THEN 'COMPLETED' ELSE 'CONFIRMED' END,
              alighted_at = CASE WHEN a.alighted_at IS NULL AND t.status <> 'active' THEN t.ended_at ELSE a.alighted_at END
         FROM trips t
        WHERE t.id = a.trip_id AND a.status = 'PROVISIONAL' AND NOT a.flagged
          AND a.prompted_at < now() - make_interval(hours => $1)
       RETURNING a.attendance_id, a.trip_id, a.user_id`,
      [this.config.attendance.provisionalAutoConfirmHours],
    );
    for (const a of auto.rows) {
      await this.event({ type: 'RESOLVE', attendanceId: a.attendance_id, tripId: a.trip_id, userId: a.user_id, v: null, deviceTs: null, detail: 'AUTO_CONFIRMED_72H' });
    }
    const locked = await this.db.query(
      `UPDATE attendance SET locked = TRUE
        WHERE NOT locked AND status IN ('COMPLETED', 'REJECTED', 'VOID', 'ADJUSTED') RETURNING attendance_id`,
    );
    const purged = await this.db.query(
      `DELETE FROM attendance_events WHERE server_ts < now() - make_interval(days => $1) RETURNING event_id`,
      [this.config.attendance.retentionDays],
    );
    await this.db.query(`DELETE FROM eta_predictions WHERE predicted_at < now() - interval '180 days'`);
    return { autoConfirmed: auto.rows.length, locked: locked.rows.length, eventsPurged: purged.rows.length };
  }

  // ---- Fallbacks (doc 9.7) -----------------------------------------------------

  /** Driver (own running trip) or admin (any trip, with a reason) marks a student on board. */
  async manual(auth, { tripId, username, reason, status } = {}, ip = null) {
    const trip = (await this.db.query('SELECT t.*, b.capacity FROM trips t JOIN buses b ON b.id = t.bus_id WHERE t.id = $1', [tripId])).rows[0];
    if (!trip) throw new HttpError(404, 'Trip not found');
    if (auth.role === 'driver' && (trip.bus_id !== auth.busId || trip.status !== 'active')) {
      throw new HttpError(403, 'Drivers can only mark students on their own running trip');
    }
    if (auth.role === 'admin' && (typeof reason !== 'string' || reason.trim().length < 3)) throw new HttpError(400, 'A reason is required');
    const student = (await this.db.query(`SELECT id FROM users WHERE username = $1 AND role = 'student'`, [String(username ?? '').trim().toLowerCase()])).rows[0];
    if (!student) throw new HttpError(404, 'No student with that username');
    const existing = (await this.db.query('SELECT * FROM attendance WHERE user_id = $1 AND trip_id = $2', [student.id, trip.id])).rows[0];
    if (existing?.locked && auth.role !== 'admin') throw new HttpError(409, 'This record is locked');

    const finalStatus = auth.role === 'admin' && status === 'ABSENT' ? 'VOID' : trip.status === 'active' ? 'ON_BOARD' : 'COMPLETED';
    const stop = this.tracking.latest.get(trip.bus_id)?.nearestStop?.id ?? null;
    const { rows } = await this.db.query(
      `INSERT INTO attendance (user_id, trip_id, bus_id, status, method, boarded_at, boarding_stop_id, answered_at, alighted_at)
       VALUES ($1, $2, $3, $4, 'MANUAL', now(), $5, now(), $6)
       ON CONFLICT (user_id, trip_id) DO UPDATE SET status = EXCLUDED.status, method = 'MANUAL',
         boarded_at = coalesce(attendance.boarded_at, EXCLUDED.boarded_at),
         boarding_stop_id = coalesce(attendance.boarding_stop_id, EXCLUDED.boarding_stop_id),
         alighted_at = coalesce(attendance.alighted_at, EXCLUDED.alighted_at), locked = FALSE
       RETURNING attendance_id, status`,
      [student.id, trip.id, trip.bus_id, finalStatus, stop, trip.status === 'active' ? null : trip.ended_at ?? new Date()],
    );
    await this.event({ type: 'OVERRIDE', attendanceId: rows[0].attendance_id, tripId: trip.id, userId: student.id, v: null, deviceTs: null, detail: `${auth.role} ${auth.userId}: ${reason ?? 'marked on board'}` });
    if (auth.role === 'admin') await audit(this.db, { actorId: auth.userId, action: 'ATTENDANCE_MANUAL', entity: 'attendance', entityId: rows[0].attendance_id, reason, ip });
    await this.checkCapacity(trip.id);
    this.notify(student.id, 'attendance:updated', { attendanceId: rows[0].attendance_id, status: rows[0].status });
    await this.boarding?.resolveFromAttendance(student.id, trip.id);
    return rows[0];
  }

  boardingCode(tripId, windowIndex) {
    const h = crypto.createHmac('sha256', this.config.jwtSecret).update(`board:${tripId}:${windowIndex}`).digest();
    return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  }

  /** The rotating code (and QR payload) shown on the driver's screen inside the bus. */
  async driverBoardingCode(auth, now = Date.now()) {
    const trip = await this.tracking.activeTrip(auth.busId);
    if (!trip) throw new HttpError(409, 'No trip running');
    const w = this.config.attendance.boardingCodeWindowS * 1000;
    const idx = Math.floor(now / w);
    const code = this.boardingCode(trip.id, idx);
    return { tripId: trip.id, code, qrPayload: `UBTS-BOARD:${trip.id}:${code}`, expiresInS: Math.ceil(((idx + 1) * w - now) / 1000) };
  }

  /**
   * QR / code check-in. A scan made offline is queued on the phone and
   * replayed later with its original `scannedAt`, which is what the code is
   * checked against.
   */
  async qrCheckIn(auth, { payload, tripId, routeCode, code, scannedAt } = {}, now = Date.now()) {
    let tid = Number(tripId);
    let c = String(code ?? '').trim();
    // Typed in by hand: the route printed in the bus plus the code on the driver's screen.
    if (!tid && routeCode) {
      const { rows } = await this.db.query(
        `SELECT t.id FROM trips t JOIN routes r ON r.id = t.route_id WHERE r.code = $1 AND t.status = 'active'`,
        [String(routeCode)],
      );
      if (!rows[0]) throw new HttpError(404, 'No bus is running on that route now');
      tid = rows[0].id;
    }
    if (typeof payload === 'string') {
      const m = payload.match(/^UBTS-BOARD:(\d+):(\d{6})$/);
      if (!m) throw new HttpError(400, 'Not a bus boarding code');
      tid = Number(m[1]);
      c = m[2];
    }
    if (!Number.isInteger(tid) || !/^\d{6}$/.test(c)) throw new HttpError(400, 'tripId and a 6-digit code are required');
    const at = scannedAt ? Date.parse(scannedAt) : now;
    if (!Number.isFinite(at) || at > now + 30000 || now - at > 12 * 3600000) throw new HttpError(400, 'Invalid scan time');
    const trip = (await this.db.query('SELECT * FROM trips WHERE id = $1', [tid])).rows[0];
    if (!trip || at < new Date(trip.started_at).getTime() - 60000 || (trip.ended_at && at > new Date(trip.ended_at).getTime() + 60000)) {
      throw new HttpError(400, 'That code does not belong to a trip running at that time');
    }
    const w = this.config.attendance.boardingCodeWindowS * 1000;
    const idx = Math.floor(at / w);
    if (c !== this.boardingCode(tid, idx) && c !== this.boardingCode(tid, idx - 1)) throw new HttpError(400, 'Incorrect or expired code');

    const bus = this.tracking.latest.get(trip.bus_id);
    const status = trip.status === 'active' ? 'ON_BOARD' : 'COMPLETED';
    const { rows } = await this.db.query(
      `INSERT INTO attendance (user_id, trip_id, bus_id, status, method, boarded_at, boarding_stop_id, answered_at, alighted_at)
       VALUES ($1, $2, $3, $4, 'QR', $5, $6, now(), $7)
       ON CONFLICT (user_id, trip_id) DO NOTHING RETURNING attendance_id, status`,
      [auth.userId, tid, trip.bus_id, status, new Date(at), bus?.tripId === tid ? bus.nearestStop?.id ?? null : null, status === 'COMPLETED' ? trip.ended_at : null],
    );
    if (!rows[0]) {
      const existing = (await this.db.query('SELECT attendance_id, status FROM attendance WHERE user_id = $1 AND trip_id = $2', [auth.userId, tid])).rows[0];
      return { ...existing, alreadyRecorded: true };
    }
    await this.event({ type: 'OVERRIDE', attendanceId: rows[0].attendance_id, tripId: tid, userId: auth.userId, v: null, deviceTs: new Date(at), detail: 'QR check-in' });
    await this.checkCapacity(tid);
    await this.boarding?.resolveFromAttendance(auth.userId, tid);
    return rows[0];
  }

  // ---- Disputes (doc 4.3, 9.5) ------------------------------------------------

  async dispute(auth, attendanceId, { reason, claimedPresent } = {}) {
    if (typeof reason !== 'string' || reason.trim().length < 5) throw new HttpError(400, 'Please describe what is wrong (at least 5 characters)');
    const a = (await this.db.query('SELECT * FROM attendance WHERE attendance_id = $1 AND user_id = $2', [attendanceId, auth.userId])).rows[0];
    if (!a) throw new HttpError(404, 'Attendance record not found');
    if (a.status === 'DISPUTED') throw new HttpError(409, 'A dispute is already open');
    if (a.status === 'PROMPTED') throw new HttpError(409, 'Answer the prompt instead');
    const since = new Date(a.boarded_at ?? a.created_at).getTime();
    if (Date.now() - since > this.config.attendance.disputeWindowDays * 86400000) {
      throw new HttpError(409, `Disputes must be raised within ${this.config.attendance.disputeWindowDays} days`);
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO attendance_disputes (attendance_id, raised_by, reason, claimed_present, previous_status) VALUES ($1, $2, $3, $4, $5)`,
        [a.attendance_id, auth.userId, reason.trim(), claimedPresent !== false, a.status],
      );
      await tx.query(`UPDATE attendance SET status = 'DISPUTED' WHERE attendance_id = $1`, [a.attendance_id]);
    });
    await this.event({ type: 'DISPUTE', attendanceId: a.attendance_id, tripId: a.trip_id, userId: auth.userId, v: null, deviceTs: null, detail: reason.trim().slice(0, 200) });
    return { attendanceId: a.attendance_id, status: 'DISPUTED' };
  }

  /** Admin decision on a PROVISIONAL (CONFIRM / VOID) or DISPUTED (PRESENT / ABSENT) record. */
  async resolve(auth, attendanceId, { decision, reason } = {}, ip = null) {
    if (typeof reason !== 'string' || reason.trim().length < 3) throw new HttpError(400, 'A reason is required');
    const a = (await this.db.query('SELECT a.*, t.status AS trip_status, t.ended_at AS trip_ended_at FROM attendance a JOIN trips t ON t.id = a.trip_id WHERE a.attendance_id = $1', [attendanceId])).rows[0];
    if (!a) throw new HttpError(404, 'Attendance record not found');
    let status;
    if (a.status === 'PROVISIONAL' && (decision === 'CONFIRM' || decision === 'VOID')) {
      status = decision === 'VOID' ? 'VOID' : a.alighted_at || a.trip_status !== 'active' ? 'COMPLETED' : 'CONFIRMED';
      await this.db.query(
        `UPDATE attendance SET status = $2,
                alighted_at = CASE WHEN $4::boolean AND alighted_at IS NULL THEN $3::timestamptz ELSE alighted_at END
          WHERE attendance_id = $1`,
        [a.attendance_id, status, a.trip_ended_at, status === 'COMPLETED'],
      );
    } else if (a.status === 'DISPUTED' && (decision === 'PRESENT' || decision === 'ABSENT')) {
      status = 'ADJUSTED';
      await this.db.transaction(async (tx) => {
        await tx.query(`UPDATE attendance SET status = 'ADJUSTED', adjusted_present = $2 WHERE attendance_id = $1`, [a.attendance_id, decision === 'PRESENT']);
        await tx.query(
          `UPDATE attendance_disputes SET resolution = $2, resolved_by = $3, resolved_at = now()
            WHERE attendance_id = $1 AND resolved_at IS NULL`,
          [a.attendance_id, `${decision}: ${reason.trim()}`, auth.userId],
        );
      });
    } else {
      throw new HttpError(409, `A ${a.status} record cannot be resolved with ${decision}`);
    }
    await this.event({ type: 'RESOLVE', attendanceId: a.attendance_id, tripId: a.trip_id, userId: a.user_id, v: null, deviceTs: null, detail: `${decision}: ${reason.trim()}` });
    await audit(this.db, { actorId: auth.userId, action: 'ATTENDANCE_RESOLVED', entity: 'attendance', entityId: a.attendance_id, reason: `${decision}: ${reason.trim()}`, ip });
    this.notify(a.user_id, 'attendance:updated', { attendanceId: a.attendance_id, status });
    return { attendanceId: a.attendance_id, status };
  }

  // ---- Views ------------------------------------------------------------------

  async myRecord(userId, month) {
    const range = monthRange(month);
    if (!range) throw new HttpError(400, 'month must be YYYY-MM');
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, a.trip_id, a.status, a.method, a.boarded_at, a.alighted_at, a.confidence,
              a.locked, a.flagged, a.auto_confirmed, a.adjusted_present, a.answered_at, a.created_at,
              ${PRESENT_SQL} AS present,
              b.fleet_code, r.code AS route_code, r.name AS route_name,
              bs.name AS boarding_stop, als.name AS alighting_stop,
              (SELECT row_to_json(d) FROM (SELECT reason, resolution, created_at, resolved_at FROM attendance_disputes
                 WHERE attendance_id = a.attendance_id ORDER BY created_at DESC LIMIT 1) d) AS dispute
         FROM attendance a
         JOIN trips t ON t.id = a.trip_id
         JOIN buses b ON b.id = a.bus_id
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
         LEFT JOIN stops als ON als.id = a.alighting_stop_id
        WHERE a.user_id = $1 AND (a.boarded_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
        ORDER BY a.boarded_at DESC`,
      [userId, range.from, range.to, this.config.timeZone],
    );
    const disputeDeadline = this.config.attendance.disputeWindowDays * 86400000;
    return {
      month,
      tripsPresent: rows.filter((r) => r.present).length,
      records: rows.map((r) => ({ ...r, canDispute: r.status !== 'DISPUTED' && r.status !== 'PROMPTED' && Date.now() - new Date(r.boarded_at).getTime() <= disputeDeadline })),
    };
  }

  /** The driver's boarded list, or the admin's register for one trip. */
  async tripAttendance(auth, tripId) {
    const trip = (await this.db.query('SELECT t.*, b.capacity, b.fleet_code FROM trips t JOIN buses b ON b.id = t.bus_id WHERE t.id = $1', [tripId])).rows[0];
    if (!trip) throw new HttpError(404, 'Trip not found');
    if (auth.role === 'driver' && trip.bus_id !== auth.busId) throw new HttpError(403, 'Not your trip');
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, u.username, u.full_name, u.register_no, a.status, a.method, a.boarded_at, a.alighted_at,
              a.flagged, ${PRESENT_SQL} AS present, bs.name AS boarding_stop, als.name AS alighting_stop
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
         LEFT JOIN stops als ON als.id = a.alighting_stop_id
        WHERE a.trip_id = $1 ORDER BY a.boarded_at`,
      [tripId],
    );
    const onBoard = rows.filter((r) => ONBOARD.includes(r.status) && !r.alighted_at).length;
    return { tripId: trip.id, fleetCode: trip.fleet_code, status: trip.status, capacity: trip.capacity, onBoard, records: rows };
  }

  async reviewQueue() {
    const { rows } = await this.db.query(
      `SELECT a.attendance_id, a.status, a.method, a.flagged, a.flag_reason, a.boarded_at, a.prompted_at, a.first_match_at,
              a.last_match_at, a.trip_id, u.username, u.full_name, b.fleet_code, r.code AS route_code,
              d.reason AS dispute_reason, d.claimed_present, d.previous_status,
              (SELECT json_agg(e ORDER BY e.server_ts) FROM (
                 SELECT event_type, distance_m, speed_kmph, bearing_delta, detail, server_ts
                   FROM attendance_events WHERE attendance_id = a.attendance_id) e) AS evidence
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN buses b ON b.id = a.bus_id
         JOIN trips t ON t.id = a.trip_id
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN attendance_disputes d ON d.attendance_id = a.attendance_id AND d.resolved_at IS NULL
        WHERE a.status IN ('PROVISIONAL', 'DISPUTED')
        ORDER BY a.created_at`,
    );
    return rows;
  }

  // ---- Helpers ------------------------------------------------------------------

  async event({ type, attendanceId = null, tripId, userId, v, deviceTs, detail = null }) {
    await this.db.query(
      `INSERT INTO attendance_events (attendance_id, trip_id, user_id, event_type, distance_m, speed_kmph, bearing_delta, device_ts, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        attendanceId, tripId, userId, type,
        v?.distanceM != null ? Math.round(v.distanceM * 100) / 100 : null,
        v?.speedKmh != null ? Math.round(v.speedKmh * 100) / 100 : null,
        v?.bearingDelta != null ? Math.round(v.bearingDelta * 100) / 100 : null,
        deviceTs ? new Date(deviceTs) : null,
        detail,
      ],
    );
  }

  async raiseIncident({ kind, userId = null, tripId = null, busId = null, routeId = null, lat = null, lng = null, message }) {
    const { rows } = await this.db.query(
      `INSERT INTO incidents (kind, source, message, route_id, bus_id, trip_id, user_id, lat, lng)
       VALUES ($1, 'system', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [kind, message, routeId, busId, tripId, userId, lat, lng],
    );
    this.io?.to('admins').emit('incident', rows[0]);
    return rows[0];
  }

  async flagTrip(tripId, reason, where) {
    if (this.flaggedTrips.has(`${reason}:${tripId}`)) return;
    this.flaggedTrips.add(`${reason}:${tripId}`);
    await this.db.query('UPDATE trips SET flagged = TRUE, flag_reason = $2 WHERE id = $1', [tripId, reason]);
    await this.raiseIncident({ kind: reason, tripId, busId: where.busId, routeId: where.routeId, lat: where.lat, lng: where.lng, message: `Trip ${tripId} flagged: ${reason}` });
  }

  /** More students on board than seats: flagged (doc 9.8). */
  async checkCapacity(tripId) {
    const { rows } = await this.db.query(
      `SELECT b.capacity, b.id AS bus_id, t.route_id,
              (SELECT count(*)::int FROM attendance a WHERE a.trip_id = t.id AND a.status = ANY($2) AND a.alighted_at IS NULL) AS on_board
         FROM trips t JOIN buses b ON b.id = t.bus_id WHERE t.id = $1`,
      [tripId, ONBOARD],
    );
    const r = rows[0];
    if (r?.capacity && r.on_board > r.capacity) {
      await this.flagTrip(tripId, 'CAPACITY_BREACH', { busId: r.bus_id, routeId: r.route_id });
    }
  }
}
