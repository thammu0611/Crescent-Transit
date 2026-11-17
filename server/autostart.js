// Phone-only drivers: the trip starts by itself.
//
// A bus with a GPS tracker already starts its own trips (gps/trackers.js). A bus
// tracked only by the driver's phone used to need the Start button, and a
// forgotten Start breaks attendance, arrival times and alerts for the whole
// route. While the driver's app is open with no trip running, it sends its
// position here every few seconds. When the phone has moved more than
// PHONE_AUTO_START's distance from where it stood (the depot) and keeps moving,
// inside the trip hours, the trip starts as if Start had been pressed.
//
// These positions are only compared in memory: none is stored.
import { inWindows, parseWindows } from '../shared/colocation.js';
import { haversineMeters } from '../shared/geo.js';
import { localMinutes } from './clock.js';
import { audit } from './util.js';

const STALE_MS = 10 * 60000; // a standby gap longer than this starts over

export class PhoneAutoStart {
  constructor(db, config, { tracking, push = null, calendar = null }) {
    this.calendar = calendar;
    this.db = db;
    this.config = config;
    this.tracking = tracking;
    this.push = push;
    this.state = new Map(); // busId -> { anchor, movingSince, last }
  }

  tripWindows() {
    const g = this.config.gps;
    return parseWindows(g.tripWindows ?? '') ?? parseWindows(this.config.attendance.travelWindows) ?? [[0, 1440]];
  }

  /**
   * Positions from a driver's phone while no trip runs. Returns
   * { trip } once started, else { waiting: reason }.
   */
  async standby(auth, body = {}, now = Date.now()) {
    if (!auth.busId) return { waiting: 'This driver has no bus assigned' };
    const running = await this.tracking.activeTrip(auth.busId);
    if (running) return { trip: running, started: false };
    if (!this.config.phoneAutoStart.enabled) return { waiting: 'Automatic start is off' };
    // No automatic trip on a day without buses (Sundays, holidays); the driver can still start one by hand.
    if (await this.calendar?.isPaused(now)) return { waiting: 'No buses today' };
    if (this.tracking.trackerActive(auth.busId)) return { waiting: 'The bus GPS tracker starts this trip' };

    const fixes = (Array.isArray(body.fixes) ? body.fixes : [body])
      .filter((f) => Number.isFinite(f?.lat) && Number.isFinite(f?.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180)
      .map((f) => ({ lat: f.lat, lng: f.lng, speedKmh: Number.isFinite(f.speedKmh) ? f.speedKmh : undefined, t: Date.parse(f.recordedAt) || now }))
      .filter((f) => f.t <= now + 60000 && now - f.t < STALE_MS)
      .sort((a, b) => a.t - b.t);
    if (!fixes.length) return { waiting: 'No position yet' };

    const g = this.config.gps;
    let s = this.state.get(auth.busId);
    if (!s || now - s.last.t > STALE_MS) s = { anchor: fixes[0], movingSince: null, last: fixes[0] };
    for (const f of fixes) {
      let speed = f.speedKmh;
      if (speed === undefined && f.t > s.last.t) speed = (haversineMeters(s.last, f) / ((f.t - s.last.t) / 1000)) * 3.6;
      if (speed >= g.autoStartSpeedKmh) s.movingSince ??= f.t;
      else {
        s.movingSince = null;
        // Standing still: this is where the bus is parked now.
        if (haversineMeters(s.anchor, f) < this.config.phoneAutoStart.leaveDepotM) s.anchor = { ...s.anchor, t: f.t };
        else s.anchor = f;
      }
      s.last = f;
    }
    this.state.set(auth.busId, s);

    const away = Math.round(haversineMeters(s.anchor, s.last));
    if (s.movingSince === null) return { waiting: 'The bus is not moving', away };
    if (s.last.t - s.movingSince < g.autoStartAfterS * 1000) return { waiting: 'The bus has only just started moving', away };
    if (away < this.config.phoneAutoStart.leaveDepotM) return { waiting: 'The bus has not left the depot yet', away };
    if (!inWindows(localMinutes(new Date(now), this.config.timeZone), this.tripWindows())) return { waiting: 'Outside the trip hours', away };

    const { rows } = await this.db.query(
      'SELECT status, route_id, (SELECT max(ended_at) FROM trips WHERE bus_id = b.id) AS last_ended FROM buses b WHERE b.id = $1',
      [auth.busId],
    );
    const bus = rows[0];
    if (!bus?.route_id || bus.status !== 'active') return { waiting: 'This bus cannot start a trip' };
    if (bus.last_ended && now - new Date(bus.last_ended).getTime() < g.autoStartCooldownMin * 60000) {
      return { waiting: `The last trip ended less than ${g.autoStartCooldownMin} min ago` };
    }
    const { trip, resumed } = await this.tracking.startTrip({ userId: auth.userId, busId: auth.busId }, { startedBy: 'auto' });
    this.state.delete(auth.busId);
    if (!resumed) {
      await audit(this.db, { actorId: auth.userId, action: 'TRIP_STARTED_AUTOMATICALLY', entity: 'trip', entityId: trip.id, detail: { away } });
      this.push?.toUser(auth.userId, {
        title: 'Trip started automatically',
        body: 'Your bus left the depot, so the trip started and students can see it. End it from the app if this is not a trip.',
        data: { type: 'trip-started', tripId: trip.id },
      });
    }
    return { trip, started: !resumed };
  }
}
