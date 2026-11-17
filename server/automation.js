// What the system does by itself from the bus position, with nobody pressing anything:
//
//   Bus approaching   a push to each student a few minutes before the bus reaches
//                     their stop, once per trip. On the way home it goes only to
//                     students on board, so they can get ready to get off.
//   Geofence          a trip ends when the bus has stayed at the end of its run,
//                     whoever started it, so a forgotten "End trip" cannot run on.
//   Speeding          a sustained speed over the limit raises an incident for
//                     the transport office.
//   Running late      a bus well behind its timetable tells the route's students
//                     and their parents once per trip.
import { busLabel } from '../shared/institution.js';
import { inWindows } from '../shared/colocation.js';
import { DOWN, travelOrder } from '../shared/direction.js';
import { haversineMeters } from '../shared/geo.js';
import { clockMinutes } from './alternatives.js';
import { localMinutes } from './clock.js';
import { audit } from './util.js';

export class AutomationService {
  constructor(db, config, { tracking, attendance, billing, calendar, notify, eveningDeparture = null, fleetCare = null, io = null, push = null, guardians = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.automation;
    this.tracking = tracking;
    this.attendance = attendance;
    this.billing = billing;
    this.io = io;
    this.push = push;
    this.guardians = guardians;
    this.calendar = calendar;
    this.notify = notify;
    this.eveningDeparture = eveningDeparture;
    this.fleetCare = fleetCare;
    this.lateChecked = new Map(); // tripId -> seq of the last stop compared with the timetable
    this.lastLook = new Map(); // busId -> ms of the last stop-alert check
    this.overLimit = new Map(); // busId -> fixes in a row over the speed limit
    this.lastSpeedAlert = new Map(); // tripId -> ms
    this.atEnd = new Map(); // tripId -> { busId, since }

    tracking.on('fix', (snap) => this.onFix(snap));
    tracking.on('tripEnded', ({ tripId, busId }) => {
      // The trip is over, so its "tracker offline" flag needs nobody any more.
      this.db.query(
        `UPDATE incidents SET status = 'RESOLVED', resolution = 'Closed automatically: the trip ended', resolved_at = now()
          WHERE trip_id = $1 AND kind = 'TRACKER_OFFLINE' AND status = 'OPEN' RETURNING *`,
        [tripId],
      ).then(({ rows }) => rows.forEach((r) => this.io?.to('admins').emit('incident', r))).catch(() => {});
      this.atEnd.delete(tripId);
      this.lastSpeedAlert.delete(tripId);
      this.overLimit.delete(busId);
      this.lastLook.delete(busId);
      this.lateChecked.delete(tripId);
    });
  }

  async onFix(snap, now = Date.now()) {
    await this.checkSpeed(snap, now);
    this.noteEnd(snap, now);
    await this.checkLate(snap, now);
    const last = this.lastLook.get(snap.busId) ?? 0;
    if (now - last < this.settings.stopAlertEveryS * 1000) return;
    this.lastLook.set(snap.busId, now);
    await this.alertStops(snap, now);
  }

  // ---- Bus approaching --------------------------------------------------------------

  /** The stops this bus reaches within the alert time. */
  stopsSoon(snap, now) {
    const ahead = this.tracking.stopsAhead(snap).slice(0, snap.direction === DOWN ? undefined : -1); // nobody waits at the campus
    const soon = [];
    for (const stop of ahead) {
      const eta = this.tracking.estimate(snap.routeId, snap, stop.seq, now);
      if (!eta || eta.passed) continue;
      if (eta.minutes > this.settings.stopAlertMinutes) break;
      soon.push({ stop, eta });
    }
    return soon;
  }

  async alertStops(snap, now = Date.now()) {
    if (!this.settings.stopAlerts || (await this.calendar.isPaused(now))) return { alerted: 0 };
    const soon = this.stopsSoon(snap, now);
    if (!soon.length) return { alerted: 0 };
    const going = snap.direction === DOWN;
    const required = Boolean(this.config.subscription.studentRequired);
    const { rows } = await this.db.query(
      `SELECT u.id, u.travel_windows, u.home_stop_seq FROM users u
        WHERE u.role = 'student' AND u.status = 'active' AND u.arrival_alerts
          AND u.home_route_id = $1 AND u.home_stop_seq = ANY($2::int[])
          AND NOT EXISTS (SELECT 1 FROM stop_alerts x WHERE x.user_id = u.id AND x.trip_id = $3)
          AND ${going ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.trip_id = $3
                AND a.alighted_at IS NULL AND a.status NOT IN ('REJECTED', 'VOID'))
          AND (NOT $4 OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'ACTIVE' AND s.valid_to >= $5))`,
      [snap.routeId, soon.map((s) => s.stop.seq), snap.tripId, required, this.billing.today()],
    );
    const minutes = localMinutes(new Date(now), this.config.timeZone);
    const bus = busLabel(snap.fleetCode);
    let alerted = 0;
    for (const u of rows) {
      if (!inWindows(minutes, this.attendance.windowsFor(u))) continue;
      const { rows: fresh } = await this.db.query(
        'INSERT INTO stop_alerts (user_id, trip_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id',
        [u.id, snap.tripId],
      );
      if (!fresh[0]) continue;
      const { stop, eta } = soon.find((s) => s.stop.seq === u.home_stop_seq);
      const when = eta.low === eta.high ? `${eta.low} min` : `${eta.low}-${eta.high} min`;
      const message = {
        title: going ? `Your stop is coming up on ${bus}` : `${bus} is almost at your stop`,
        body: going ? `${stop.name} in about ${when}. Get ready to get off.` : `It reaches ${stop.name} in about ${when}.`,
      };
      this.io?.to(`user:${u.id}`).emit('bus:approaching', { ...message, tripId: snap.tripId, stopName: stop.name, low: eta.low, high: eta.high });
      this.push?.toUser(u.id, { ...message, data: { type: 'bus:approaching', tripId: snap.tripId } });
      alerted += 1;
    }
    return { alerted };
  }

  // ---- Running late --------------------------------------------------------------------

  /** Minutes after midnight the timetable has this stop on this run, today. */
  async scheduledAt(stop, stops, direction, now) {
    const shift = await this.calendar.shift(direction, now);
    if (direction === DOWN) {
      const leaves = clockMinutes(this.eveningDeparture);
      const campus = stops.at(-1);
      if (leaves == null || stop.offset_minutes == null || campus.offset_minutes == null) return null;
      return leaves + (campus.offset_minutes - stop.offset_minutes) + shift;
    }
    const at = clockMinutes(stop.scheduled_time);
    return at == null ? null : at + shift;
  }

  /** Compare each stop reached with the timetable; well behind, tell everyone once. */
  async checkLate(snap, now = Date.now()) {
    const seq = this.tracking.lastArrivedSeq.get(snap.tripId);
    if (seq === undefined || this.lateChecked.get(snap.tripId) === seq) return null;
    this.lateChecked.set(snap.tripId, seq);
    if (await this.calendar.isPaused(now)) return null;
    const stops = this.tracking.stopsByRoute.get(snap.routeId) ?? [];
    const stop = stops.find((s) => s.seq === seq);
    if (!stop) return null;
    const due = await this.scheduledAt(stop, stops, snap.direction, now);
    if (due == null) return null;
    const late = localMinutes(new Date(snap.recordedAt), this.config.timeZone) - due;
    if (late < this.settings.lateAfterMinutes || late > this.settings.lateIgnoreOverMinutes) return null;
    const minutes = Math.max(5, Math.round(late / 5) * 5);
    const { rows } = await this.db.query('INSERT INTO late_alerts (trip_id, minutes) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING trip_id', [snap.tripId, minutes]);
    if (!rows[0]) return null;
    const bus = busLabel(snap.fleetCode);
    const title = `${bus} is running late`;
    const body = `${bus} is running ~${minutes} min late.`;
    await this.notify({ kind: 'DELAY', title, message: body, routeId: snap.routeId, tripId: snap.tripId });
    await this.guardians?.toRouteParents(snap.routeId, { kind: 'LATE', title, body });
    return { minutes };
  }

  // ---- Geofence: the end of the run ----------------------------------------------------

  /** Remember when the bus settled inside the geofence around the last stop of its run. */
  noteEnd(snap, now) {
    const last = travelOrder(this.tracking.stopsByRoute.get(snap.routeId) ?? [], snap.direction).at(-1);
    const arrived = last && this.tracking.lastArrivedSeq.get(snap.tripId) === last.seq
      && haversineMeters(last, snap) <= this.settings.geofenceM;
    if (!arrived) this.atEnd.delete(snap.tripId);
    else if (!this.atEnd.has(snap.tripId)) this.atEnd.set(snap.tripId, { busId: snap.busId, since: now });
  }

  /** Trips that have stayed at the end of their run long enough. */
  async endArrivedTrips(now = Date.now()) {
    if (!this.settings.autoEndAtGeofence) return [];
    const ended = [];
    for (const [tripId, { busId, since }] of this.atEnd) {
      if (now - since < this.settings.geofenceDwellMin * 60000) continue;
      try {
        await this.tracking.endTrip({ busId }, tripId);
      } catch (err) {
        if (err.status === 404) {
          this.atEnd.delete(tripId); // ended by the driver meanwhile
          continue;
        }
        throw err;
      }
      await audit(this.db, { action: 'TRIP_ENDED_BY_GEOFENCE', entity: 'trip', entityId: tripId, reason: 'arrived at the end of the route' });
      ended.push(tripId);
    }
    return ended;
  }

  // ---- Speeding ---------------------------------------------------------------------------

  async checkSpeed(snap, now = Date.now()) {
    const limit = this.settings.speedLimitKmh;
    const over = (snap.speedKmh ?? 0) > limit ? (this.overLimit.get(snap.busId) ?? 0) + 1 : 0;
    this.overLimit.set(snap.busId, over);
    if (over < this.settings.speedFixesInARow) return null;
    const last = this.lastSpeedAlert.get(snap.tripId) ?? 0;
    if (now - last < this.settings.speedAlertEveryMin * 60000) return null;
    this.lastSpeedAlert.set(snap.tripId, now);
    const message = `${snap.fleetCode} at ${Math.round(snap.speedKmh)} km/h near ${snap.nearestStop?.name ?? 'the route'} (limit ${limit} km/h).`;
    const { rows } = await this.db.query(
      `INSERT INTO incidents (kind, source, message, route_id, bus_id, trip_id, lat, lng)
       VALUES ('SPEEDING', 'system', $1, $2, $3, $4, $5, $6) RETURNING *`,
      [message, snap.routeId, snap.busId, snap.tripId, snap.lat, snap.lng],
    );
    this.io?.to('admins').emit('incident', rows[0]);
    this.push?.toRole('admin', { title: 'Speeding alert', body: message, data: { type: 'incident', id: rows[0].id, kind: 'SPEEDING' } });
    return rows[0];
  }

  /** Trips nobody ended (the driver forgot, the phone died): closed after STALE_TRIP_HOURS. */
  async endStaleTrips() {
    const hours = this.settings.staleTripHours;
    if (!hours) return [];
    const { rows } = await this.db.query(
      `SELECT id, bus_id FROM trips WHERE status = 'active' AND started_at < now() - make_interval(hours => $1)`,
      [hours],
    );
    const ended = [];
    for (const trip of rows) {
      try {
        await this.tracking.endTrip({ busId: trip.bus_id }, trip.id);
      } catch (err) {
        if (err.status === 404) continue; // ended meanwhile
        throw err;
      }
      await audit(this.db, { action: 'TRIP_ENDED_STALE', entity: 'trip', entityId: trip.id, reason: `still running after ${hours} hours` });
      ended.push(trip.id);
    }
    return ended;
  }

  /** Every minute (jobs.js). */
  async tick(now = Date.now()) {
    const stale = await this.endStaleTrips();
    const ended = await this.endArrivedTrips(now);
    const notices = await this.guardians?.sendNotices(now);
    const care = await this.fleetCare?.sendReminders();
    return { tripsEnded: ended.length + stale.length, parentNotices: notices?.sent ?? 0, careReminders: care?.sent ?? 0 };
  }
}
