import { haversineMeters } from '../shared/geo.js';
import { freshnessOf } from '../shared/freshness.js';
import { estimateArrival, timetableSegmentMinutes } from '../shared/eta.js';
import { HttpError } from './auth.js';
import { REJECT, serviceAreaFromStops, validateFix } from './validation.js';

const MAX_BATCH = 200;
// After this many consecutive "impossible jumps" that agree with each other,
// the new position is trusted: the earlier accepted fix was the wrong one.
export const REANCHOR_AFTER = 3;

/**
 * The location pipeline: driver fix -> validate -> store -> broadcast.
 *
 * Keeps the newest accepted fix of every active bus in memory (the "cache" in
 * the architecture), so the live map, the ETA and the attendance engine never
 * have to scan the location history.
 */
export class TrackingService {
  constructor(db, config, io) {
    this.db = db;
    this.config = config;
    this.io = io;
    this.latest = new Map(); // busId -> live snapshot row
    this.stopsByRoute = new Map(); // routeId -> [{ id, seq, name, lat, lng, offset_minutes }]
    this.area = null;
    this.timer = null;
    this.busLocks = new Map(); // busId -> tail of that bus's ingest queue
    this.jumpChains = new Map(); // busId -> consecutive rejected jumps
    this.lastArrivedSeq = new Map(); // tripId -> seq of the last stop reached
    this.lastPrediction = new Map(); // busId -> ms of the last logged ETA sample
    this.segmentMinutes = new Map(); // routeId -> { minutes: [...], learned: n }
    this.lastTrackerFixAt = new Map(); // busId -> ms (server clock) of the tracker's last accepted fix
    this.motion = new Map(); // busId -> { lat, lng, movedAt }: where and when the bus last moved
    // Other modules (attendance) react to the pipeline without being part of it.
    this.hooks = { fix: [], tripEnded: [] };
  }

  on(event, fn) {
    this.hooks[event].push(fn);
  }

  async runHooks(event, ...args) {
    for (const fn of this.hooks[event]) {
      try {
        await fn(...args);
      } catch (err) {
        console.error(`[tracking] ${event} hook failed:`, err);
      }
    }
  }

  async init() {
    await this.reloadStops();

    // Restore the live cache after a restart from the active trips.
    const { rows } = await this.db.query(`${LIVE_SELECT} WHERE t.status = 'active'`);
    for (const row of rows) this.latest.set(row.bus_id, this.toSnapshot(row));
    const arrived = await this.db.query(
      `SELECT a.trip_id, max(a.stop_seq) AS seq FROM stop_arrivals a JOIN trips t ON t.id = a.trip_id
        WHERE t.status = 'active' GROUP BY a.trip_id`,
    );
    for (const r of arrived.rows) this.lastArrivedSeq.set(r.trip_id, r.seq);
    await this.refreshSegmentTimes();
  }

  /** Re-read stops (after the administrator edits a route). */
  async reloadStops() {
    const { rows: stops } = await this.db.query(
      'SELECT id, route_id, seq, name, lat, lng, offset_minutes FROM stops ORDER BY route_id, seq',
    );
    this.stopsByRoute = new Map();
    for (const s of stops) {
      if (!this.stopsByRoute.has(s.route_id)) this.stopsByRoute.set(s.route_id, []);
      this.stopsByRoute.get(s.route_id).push({
        id: s.id, seq: s.seq, name: s.name, lat: s.lat, lng: s.lng, offset_minutes: s.offset_minutes,
      });
    }
    this.area = stops.length ? serviceAreaFromStops(stops, this.config.validation.serviceAreaMarginDeg) : null;
    for (const snap of this.latest.values()) snap.nearestStop = this.nearestStop(snap.routeId, snap);
  }

  /**
   * Segment travel times per route (doc 7.2): the average of recorded stop
   * arrivals where at least `minSegmentSamples` trips exist, otherwise the
   * timetable's scheduled minutes for that segment.
   */
  async refreshSegmentTimes() {
    const { rows } = await this.db.query(
      `SELECT t.route_id, a.stop_seq,
              avg(extract(epoch FROM (b.arrived_at - a.arrived_at)) / 60)::float AS minutes, count(*)::int AS n
         FROM stop_arrivals a
         JOIN stop_arrivals b ON b.trip_id = a.trip_id AND b.stop_seq = a.stop_seq + 1
         JOIN trips t ON t.id = a.trip_id
        WHERE a.arrived_at > now() - interval '60 days' AND b.arrived_at > a.arrived_at
        GROUP BY t.route_id, a.stop_seq`,
    );
    const learned = new Map();
    for (const r of rows) {
      if (r.n < this.config.eta.minSegmentSamples) continue;
      if (!learned.has(r.route_id)) learned.set(r.route_id, new Map());
      learned.get(r.route_id).set(r.stop_seq, r.minutes);
    }
    const next = new Map();
    for (const [routeId, stops] of this.stopsByRoute) {
      const got = learned.get(routeId) ?? new Map();
      let n = 0;
      const minutes = timetableSegmentMinutes(stops).map((m, i) => {
        const l = got.get(stops[i].seq);
        if (!Number.isFinite(l)) return m;
        n += 1;
        return l;
      });
      next.set(routeId, { minutes, learned: n });
    }
    this.segmentMinutes = next;
  }

  segmentInfo(routeId) {
    return this.segmentMinutes.get(routeId) ?? { minutes: null, learned: 0 };
  }

  estimate(routeId, bus, stopSeq, now = Date.now()) {
    const seg = this.segmentInfo(routeId);
    return estimateArrival(this.stopsByRoute.get(routeId) ?? [], bus, stopSeq, seg.minutes, {
      defaultSpeedKmh: this.config.eta.defaultSpeedKmh,
      now,
      segmentSource: seg.learned ? 'segment-history' : 'timetable',
    });
  }

  /** ETA of every live bus on a route to one stop. */
  etaFor(routeId, stopSeq, now = Date.now()) {
    return this.liveSnapshot()
      .filter((b) => b.routeId === routeId)
      .map((b) => ({
        busId: b.busId,
        fleetCode: b.fleetCode,
        tripId: b.tripId,
        freshness: b.freshness,
        occupancy: b.occupancy,
        recordedAt: b.recordedAt,
        nearestStop: b.nearestStop,
        eta: this.estimate(routeId, b, stopSeq, now),
      }));
  }

  /** Re-evaluate freshness every few seconds and push state changes. */
  startFreshnessTicker(intervalMs = 5000) {
    this.timer = setInterval(() => {
      for (const snap of this.latest.values()) {
        const state = freshnessOf(snap.recordedAt, Date.now(), this.config.freshness);
        if (state !== snap.freshness) {
          snap.freshness = state;
          this.emit(snap.routeCode, 'bus:freshness', { busId: snap.busId, freshness: state });
        }
      }
    }, intervalMs);
    this.timer.unref?.();
    this.segmentTimer = setInterval(() => this.refreshSegmentTimes().catch((e) => console.error(e)), 10 * 60000);
    this.segmentTimer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.segmentTimer);
  }

  emit(routeCode, event, payload) {
    this.io?.to(['all', `route:${routeCode}`]).emit(event, payload);
  }

  nearestStop(routeId, point) {
    let best = null;
    for (const s of this.stopsByRoute.get(routeId) ?? []) {
      const d = haversineMeters(s, point);
      if (!best || d < best.distanceM) best = { id: s.id, seq: s.seq, name: s.name, distanceM: Math.round(d) };
    }
    return best;
  }

  toSnapshot(row) {
    const recordedAt = new Date(row.recorded_at).toISOString();
    return {
      busId: row.bus_id,
      fleetCode: row.fleet_code,
      routeId: row.route_id,
      routeCode: row.route_code,
      routeName: row.route_name,
      driverName: row.driver_name,
      tripId: row.trip_id,
      capacity: row.capacity,
      occupancy: row.occupancy ?? null,
      lat: row.lat,
      lng: row.lng,
      speedKmh: row.speed_kmh,
      heading: row.heading,
      accuracyM: row.accuracy_m,
      recordedAt,
      freshness: freshnessOf(recordedAt, Date.now(), this.config.freshness),
      nearestStop: this.nearestStop(row.route_id, row),
      source: row.source ?? 'phone', // 'phone' (driver app) or 'tracker' (GPS unit in the bus)
    };
  }

  /** Is the bus's own tracker reporting? Then the driver's phone stands by. */
  trackerActive(busId, now = Date.now()) {
    const at = this.lastTrackerFixAt.get(busId);
    return at !== undefined && now - at < this.config.gps.preferTrackerForS * 1000;
  }

  /** Remember where and when the bus last moved (automatic trip end, server/gps). */
  noteMotion(busId, fix) {
    const last = this.motion.get(busId);
    if (!last || (fix.speedKmh ?? 0) >= 5 || haversineMeters(last, fix) > 100) {
      this.motion.set(busId, { lat: fix.lat, lng: fix.lng, movedAt: fix.recordedAt.getTime() });
    }
  }

  liveSnapshot() {
    const now = Date.now();
    return [...this.latest.values()].map((s) => ({ ...s, freshness: freshnessOf(s.recordedAt, now, this.config.freshness) }));
  }

  // ---- Trips -------------------------------------------------------------

  async activeTrip(busId) {
    const { rows } = await this.db.query(
      `SELECT t.id, t.bus_id, t.route_id, t.started_at, t.occupancy, t.started_by, r.code AS route_code
         FROM trips t JOIN routes r ON r.id = t.route_id
        WHERE t.bus_id = $1 AND t.status = 'active'`,
      [busId],
    );
    return rows[0] ?? null;
  }

  /**
   * Start a trip for the driver's bus. Returns the running trip if one exists.
   * A trip the administrator scheduled around now is activated rather than
   * creating a second one. The bus tracker starts trips too (startedBy
   * 'tracker'), with the bus's assigned driver if there is one.
   */
  async startTrip({ userId, busId }, { startedBy = 'driver' } = {}) {
    if (!busId) throw new HttpError(400, 'This driver has no bus assigned');
    const existing = await this.activeTrip(busId);
    if (existing) return { trip: existing, resumed: true };
    const bus = await this.db.query('SELECT status, route_id FROM buses WHERE id = $1', [busId]);
    if (!bus.rows[0]?.route_id) throw new HttpError(409, 'This bus is not assigned to a route');
    if (bus.rows[0].status !== 'active') throw new HttpError(409, `This bus is marked ${bus.rows[0].status}`);
    try {
      const scheduled = await this.db.query(
        `UPDATE trips SET status = 'active', started_at = now(), driver_id = coalesce($2, driver_id), route_id = $3, started_by = $4
          WHERE id = (SELECT id FROM trips WHERE bus_id = $1 AND status = 'scheduled'
                        AND scheduled_for BETWEEN now() - interval '3 hours' AND now() + interval '3 hours'
                      ORDER BY scheduled_for LIMIT 1)
          RETURNING id`,
        [busId, userId ?? null, bus.rows[0].route_id, startedBy],
      );
      if (!scheduled.rows[0]) {
        await this.db.query('INSERT INTO trips (bus_id, route_id, driver_id, started_by) VALUES ($1, $2, $3, $4)', [
          busId,
          bus.rows[0].route_id,
          userId ?? null,
          startedBy,
        ]);
      }
    } catch (err) {
      // Two "start" taps at once: the unique index lets only one trip through.
      if (err.code !== '23505') throw err;
      return { trip: await this.activeTrip(busId), resumed: true };
    }
    this.motion.delete(busId); // "parked for N minutes" counts from the start
    return { trip: await this.activeTrip(busId), resumed: false };
  }

  async endTrip({ busId }, tripId, status = 'completed') {
    const { rows } = await this.db.query(
      `UPDATE trips SET status = $3, ended_at = now()
        WHERE id = $1 AND bus_id = $2 AND status = 'active'
        RETURNING id, route_id, bus_id`,
      [tripId, busId, status],
    );
    if (!rows[0]) throw new HttpError(404, 'No active trip with that id for your bus');
    const snap = this.latest.get(busId);
    this.latest.delete(busId);
    this.lastArrivedSeq.delete(tripId);
    this.lastPrediction.delete(busId);
    this.motion.delete(busId);
    if (snap) this.emit(snap.routeCode, 'bus:trip-ended', { busId, tripId, status });
    await this.runHooks('tripEnded', { tripId, busId, routeId: rows[0].route_id, lastPosition: snap ?? null });
    return rows[0];
  }

  /** Occupancy chip tapped by the driver after a stop (doc A.1.2). */
  async setOccupancy({ busId }, occupancy) {
    if (!['SEATS_FREE', 'STANDING', 'FULL'].includes(occupancy)) {
      throw new HttpError(400, 'occupancy must be SEATS_FREE, STANDING or FULL');
    }
    const trip = await this.activeTrip(busId);
    if (!trip) throw new HttpError(409, 'No trip running');
    await this.db.query('UPDATE trips SET occupancy = $2 WHERE id = $1', [trip.id, occupancy]);
    const snap = this.latest.get(busId);
    if (snap) {
      snap.occupancy = occupancy;
      this.emit(snap.routeCode, 'bus:location', snap);
    }
    return { tripId: trip.id, occupancy };
  }

  // ---- ETA evaluation data (doc 7.3) --------------------------------------

  /** Record the first time the bus comes within the arrival radius of each next stop. */
  async recordStopArrival(snap, at) {
    const last = this.lastArrivedSeq.get(snap.tripId) ?? 0;
    let reached = null;
    for (const s of this.stopsByRoute.get(snap.routeId) ?? []) {
      if (s.seq > last && haversineMeters(s, snap) <= this.config.eta.stopArrivalRadiusM) reached = s;
    }
    if (!reached) return;
    this.lastArrivedSeq.set(snap.tripId, reached.seq);
    await this.db.query('INSERT INTO stop_arrivals (trip_id, stop_seq, arrived_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      snap.tripId,
      reached.seq,
      at,
    ]);
  }

  /** Once a minute per bus, log the prediction for the next three stops. */
  async logPredictions(snap, nowMs) {
    const lastAt = this.lastPrediction.get(snap.busId) ?? 0;
    if (nowMs - lastAt < this.config.eta.predictionSampleS * 1000 || snap.freshness !== 'live') return;
    this.lastPrediction.set(snap.busId, nowMs);
    const last = this.lastArrivedSeq.get(snap.tripId) ?? 0;
    const ahead = (this.stopsByRoute.get(snap.routeId) ?? []).filter((s) => s.seq > last).slice(0, 3);
    for (const s of ahead) {
      const eta = this.estimate(snap.routeId, snap, s.seq, nowMs);
      if (!eta || eta.passed) continue;
      await this.db.query(
        'INSERT INTO eta_predictions (trip_id, stop_seq, predicted_at, predicted_arrival, method) VALUES ($1, $2, $3, $4, $5)',
        [snap.tripId, s.seq, new Date(nowMs), eta.arrivalAt, eta.method],
      );
    }
  }

  // ---- Location ingestion ------------------------------------------------

  /**
   * A jump is rejected, but if the device keeps reporting positions that are
   * consistent with each other, the previously accepted fix was the outlier
   * (or the bus really moved while offline). Re-anchor after REANCHOR_AFTER.
   */
  checkReanchor(busId, fix, rejection) {
    const chain = this.jumpChains.get(busId) ?? [];
    const last = chain.at(-1) ?? null;
    const consistent = !last || validateFix(fix, last, this.config.validation, this.area).ok;
    const next = [...(consistent ? chain : []), { lat: fix.lat, lng: fix.lng, recordedAt: fix.recordedAt }];
    if (next.length < REANCHOR_AFTER) {
      this.jumpChains.set(busId, next);
      return rejection;
    }
    this.jumpChains.delete(busId);
    return { ...validateFix(fix, null, this.config.validation, this.area), reanchored: true };
  }

  /**
   * Accept one fix or a batch (a phone that lost network uploads its buffer).
   * Each fix gets its own verdict; only the newest accepted one is broadcast.
   * `source` is 'phone' (driver app) or 'tracker' (the bus's GPS unit).
   */
  ingest(auth, body, { source = 'phone' } = {}) {
    // Requests from one bus are processed one at a time so that each fix is
    // compared with the fix accepted just before it - whichever sender it came from.
    const run = (this.busLocks.get(auth.busId) ?? Promise.resolve()).then(() => this.ingestNow(auth, body, source));
    const tail = run.catch(() => {});
    this.busLocks.set(auth.busId, tail);
    tail.then(() => {
      if (this.busLocks.get(auth.busId) === tail) this.busLocks.delete(auth.busId);
    });
    return run;
  }

  async ingestNow({ busId }, body, source = 'phone') {
    const fixes = Array.isArray(body?.fixes) ? body.fixes : [body];
    if (fixes.length === 0 || fixes.length > MAX_BATCH) {
      throw new HttpError(400, `Send between 1 and ${MAX_BATCH} fixes`);
    }
    const trip = await this.activeTrip(busId);
    if (!trip) throw new HttpError(409, 'Start a trip before sending locations');

    // The bus's own tracker is reporting: it is the better source (fixed
    // antenna, bus power), so the phone's fixes are not used. Two senders
    // interleaving would also make each look like a jump from the other.
    if (source === 'phone' && this.trackerActive(busId)) {
      const detail = 'The bus GPS tracker is reporting; this phone is on standby';
      return { tripId: trip.id, accepted: 0, rejected: 0, standby: true, results: fixes.map(() => ({ accepted: false, standby: true, reason: 'TRACKER_ACTIVE', detail })) };
    }

    // Oldest first, so a buffered batch is checked in the order it was recorded.
    const ordered = fixes
      .map((fix, index) => ({ fix, index }))
      .sort((a, b) => new Date(a.fix?.recordedAt) - new Date(b.fix?.recordedAt));

    const cached = this.latest.get(busId);
    let previous = cached && cached.tripId === trip.id ? cached : null;
    const results = new Array(fixes.length);
    let newest = null;

    for (const { fix, index } of ordered) {
      let verdict = validateFix(fix, previous, this.config.validation, this.area);
      if (!verdict.ok && verdict.reason === REJECT.IMPOSSIBLE_JUMP) verdict = this.checkReanchor(busId, fix, verdict);
      else if (verdict.ok) this.jumpChains.delete(busId);
      if (!verdict.ok) {
        await this.db.query('INSERT INTO rejected_pings (bus_id, trip_id, reason, payload) VALUES ($1, $2, $3, $4)', [
          busId,
          trip.id,
          verdict.reason,
          JSON.stringify(fix ?? null),
        ]);
        results[index] = { accepted: false, reason: verdict.reason, detail: verdict.detail };
        continue;
      }
      const f = verdict.fix;
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO location_pings (trip_id, bus_id, lat, lng, speed_kmh, heading, accuracy_m, recorded_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [trip.id, busId, f.lat, f.lng, f.speedKmh, f.heading, f.accuracyM, f.recordedAt, source],
        );
        await tx.query(
          `INSERT INTO bus_latest (bus_id, trip_id, lat, lng, speed_kmh, heading, accuracy_m, recorded_at, received_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
           ON CONFLICT (bus_id) DO UPDATE SET
             trip_id = EXCLUDED.trip_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
             speed_kmh = EXCLUDED.speed_kmh, heading = EXCLUDED.heading, accuracy_m = EXCLUDED.accuracy_m,
             recorded_at = EXCLUDED.recorded_at, received_at = EXCLUDED.received_at, source = EXCLUDED.source`,
          [busId, trip.id, f.lat, f.lng, f.speedKmh, f.heading, f.accuracyM, f.recordedAt, source],
        );
      });
      previous = { lat: f.lat, lng: f.lng, recordedAt: f.recordedAt.toISOString(), tripId: trip.id };
      newest = f;
      this.noteMotion(busId, f);
      if (source === 'tracker') this.lastTrackerFixAt.set(busId, Date.now());
      results[index] = verdict.reanchored ? { accepted: true, reanchored: true } : { accepted: true };
    }

    if (newest) {
      const { rows } = await this.db.query(`${LIVE_SELECT} WHERE bl.bus_id = $1`, [busId]);
      const snap = this.toSnapshot(rows[0]);
      this.latest.set(busId, snap);
      this.emit(snap.routeCode, 'bus:location', snap);
      await this.recordStopArrival(snap, newest.recordedAt);
      await this.logPredictions(snap, Date.now());
      await this.runHooks('fix', snap);
    }

    return {
      tripId: trip.id,
      accepted: results.filter((r) => r.accepted).length,
      rejected: results.filter((r) => !r.accepted).length,
      results,
    };
  }
}

const LIVE_SELECT = `
  SELECT bl.bus_id, bl.trip_id, bl.lat, bl.lng, bl.speed_kmh, bl.heading, bl.accuracy_m, bl.recorded_at, bl.source,
         b.fleet_code, b.capacity, t.occupancy, r.id AS route_id, r.code AS route_code, r.name AS route_name,
         u.full_name AS driver_name
    FROM bus_latest bl
    JOIN trips t  ON t.id = bl.trip_id
    JOIN buses b  ON b.id = bl.bus_id
    JOIN routes r ON r.id = t.route_id
    LEFT JOIN users u ON u.id = t.driver_id -- a tracker-run trip may have no driver
`;
