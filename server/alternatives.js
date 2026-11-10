// Another bus, when the student's own has gone or not come.
//
// Nothing here needs the student to ask. Once a minute (jobs.js) every student
// in their travel window is checked: has their bus passed their stop, stopped
// reporting, or not started by its time? If so, and a live bus of another route
// can still pick them up near their stop, they get one alert for that run: a
// pop-up in an open app, a push to a closed one. "No, I didn't board" checks
// at once. Students who are recorded on the run, or have no bus to offer, hear
// nothing.
import { busLabel } from '../shared/institution.js';
import { inWindows } from '../shared/colocation.js';
import { DOWN, describeOption } from '../shared/direction.js';
import { haversineMeters } from '../shared/geo.js';
import { localDate, localMinutes } from './clock.js';

const WALK_M_PER_MIN = 75; // 4.5 km/h

/** Minutes after midnight of a timetable time such as "6.15 AM". */
export function clockMinutes(text) {
  const m = /(\d{1,2})[.:](\d{2})\s*(AM|PM)/i.exec(text ?? '');
  if (!m) return null;
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3].toUpperCase() === 'PM' ? 720 : 0);
}

export class BusAlternativesService {
  constructor(db, config, { tracking, attendance, billing, calendar = null, io = null, push = null, eveningDeparture = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.busAlternatives;
    this.tracking = tracking;
    this.attendance = attendance;
    this.billing = billing;
    this.calendar = calendar;
    this.io = io;
    this.push = push;
    this.eveningDeparture = eveningDeparture;
  }

  /** Students with a saved stop who may see live buses: one, or all of them. */
  async students(userId = null) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.travel_windows, u.boarding_reminders, u.home_route_id AS route_id, u.home_stop_seq AS seq,
              s.name AS stop_name, s.lat, s.lng, s.scheduled_time, r.code AS route_code, r.departure_time
         FROM users u
         JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
         JOIN routes r ON r.id = u.home_route_id
        WHERE u.role = 'student' AND u.status = 'active' AND ($1::int IS NULL OR u.id = $1)
          AND (NOT $2 OR EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.user_id = u.id AND sub.status = 'ACTIVE'
                                  AND sub.valid_from <= $3 AND sub.valid_to >= $3))`,
      [userId, Boolean(this.config.subscription.studentRequired), this.billing.today()],
    );
    return rows;
  }

  /** What today already holds for this run: routes that finished it, and students it needs to leave alone. */
  async dayState(direction, now) {
    const tz = this.config.timeZone;
    const date = localDate(new Date(now), tz);
    const [ran, travelled, asked] = await Promise.all([
      this.db.query(
        `SELECT DISTINCT route_id FROM trips
          WHERE status = 'completed' AND direction = $1 AND (started_at AT TIME ZONE $2)::date = $3`,
        [direction, tz, date],
      ),
      this.db.query(
        `SELECT DISTINCT a.user_id FROM attendance a JOIN trips t ON t.id = a.trip_id
          WHERE t.direction = $1 AND (a.boarded_at AT TIME ZONE $2)::date = $3 AND a.status NOT IN ('REJECTED', 'VOID')`,
        [direction, tz, date],
      ),
      // "Did you board?" was only just asked: that answer comes first.
      this.db.query(
        `SELECT DISTINCT user_id FROM boarding_checks WHERE status = 'PENDING' AND created_at > $1`,
        [new Date(Date.now() - this.settings.askWaitMinutes * 60000)],
      ),
    ]);
    return {
      date,
      direction,
      shift: (await this.calendar?.shift(direction, now)) ?? 0,
      ran: new Set(ran.rows.map((r) => r.route_id)),
      travelled: new Set(travelled.rows.map((r) => r.user_id)),
      asked: new Set(asked.rows.map((r) => r.user_id)),
    };
  }

  /** Has this DOWN bus left the campus? */
  leftCampus(bus) {
    const campus = (this.tracking.stopsByRoute.get(bus.routeId) ?? []).at(-1);
    return !campus || haversineMeters(campus, bus) >= this.config.boardingCheck.departRadiusM;
  }

  stillToCome(bus, seq, direction) {
    if (direction === DOWN) return !this.leftCampus(bus);
    const eta = this.tracking.estimate(bus.routeId, bus, seq);
    return Boolean(eta) && !eta.passed;
  }

  /** PASSED, UNAVAILABLE, NO_BUS, or null when the student's own bus is fine. */
  situation(st, day, now) {
    const { direction } = day;
    const buses = this.tracking.liveSnapshot().filter((b) => b.routeId === st.route_id && b.direction === direction);
    const reporting = buses.filter((b) => b.freshness !== 'offline');
    if (buses.length && !reporting.length) return 'UNAVAILABLE';
    if (reporting.length) return reporting.some((b) => this.stillToCome(b, st.seq, direction)) ? null : 'PASSED';
    if (day.ran.has(st.route_id)) return 'PASSED';
    const due = clockMinutes(direction === DOWN ? this.eveningDeparture : st.scheduled_time ?? st.departure_time);
    if (due == null) return null;
    return localMinutes(new Date(now), this.config.timeZone) > due + day.shift + this.settings.lateAfterMinutes ? 'NO_BUS' : null;
  }

  /** Live buses of other routes that can still pick this student up, soonest first. */
  options(st, direction) {
    const out = [];
    for (const bus of this.tracking.liveSnapshot()) {
      if (bus.routeId === st.route_id || bus.direction !== direction) continue;
      if (bus.freshness === 'offline' || bus.occupancy === 'FULL') continue;
      const stops = this.tracking.stopsByRoute.get(bus.routeId) ?? [];
      const nearest = stops.slice(0, -1) // not the campus
        .map((stop) => ({ stop, walkM: Math.round(haversineMeters(stop, st)) }))
        .sort((a, b) => a.walkM - b.walkM)[0];
      if (!nearest || nearest.walkM > this.settings.nearbyM) continue;
      const base = {
        busId: bus.busId,
        fleetCode: bus.fleetCode,
        routeCode: bus.routeCode,
        routeName: bus.routeName,
        direction,
        walkM: nearest.walkM,
        occupancy: bus.occupancy,
      };
      if (direction === DOWN) {
        // Everyone boards at the college: it has to be there still.
        if (this.leftCampus(bus)) continue;
        out.push({ ...base, boardStop: stops.at(-1).name, getOffStop: nearest.stop.name, eta: null });
      } else {
        const eta = this.tracking.estimate(bus.routeId, bus, nearest.stop.seq);
        if (!eta || eta.passed || eta.high < nearest.walkM / WALK_M_PER_MIN) continue; // cannot walk there in time
        out.push({ ...base, boardStop: nearest.stop.name, eta: { low: eta.low, high: eta.high } });
      }
    }
    return out.sort((a, b) => (a.eta?.low ?? 0) - (b.eta?.low ?? 0) || a.walkM - b.walkM).slice(0, this.settings.maxOptions);
  }

  /** The alert this student should see now, or null. */
  evaluate(st, day, now) {
    const stops = this.tracking.stopsByRoute.get(st.route_id) ?? [];
    if (st.seq >= (stops.at(-1)?.seq ?? 0)) return null; // lives at the campus
    if (!inWindows(localMinutes(new Date(now), this.config.timeZone), this.attendance.windowsFor(st))) return null;
    if (day.travelled.has(st.id) || day.asked.has(st.id)) return null;
    const reason = this.situation(st, day, now);
    if (!reason) return null;
    const options = this.options(st, day.direction);
    if (!options.length) return null;
    const bus = `Bus ${st.route_code}`;
    const message = {
      PASSED: day.direction === DOWN ? `${bus} has left the college` : `${bus} has passed ${st.stop_name}`,
      UNAVAILABLE: `${bus} is not available right now`,
      NO_BUS: `${bus} has not started yet`,
    }[reason];
    return { date: day.date, direction: day.direction, reason, message, stopName: st.stop_name, options };
  }

  /** What the apps load when they open: the alert for this run, if there is one. */
  async forStudent(userId, now = Date.now()) {
    const [st] = await this.students(userId);
    if (!st || !this.settings.enabled || (await this.calendar?.isPaused(now))) return null;
    return this.evaluate(st, await this.dayState(this.tracking.defaultDirection(new Date(now)), now), now);
  }

  /** One alert per student per run: the table is what makes it one. */
  async notify(userId, alert) {
    const { rows } = await this.db.query(
      `INSERT INTO bus_alternative_alerts (user_id, day, direction, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, day, direction) DO NOTHING RETURNING user_id`,
      [userId, alert.date, alert.direction, alert.reason],
    );
    if (!rows[0]) return false;
    this.io?.to(`user:${userId}`).emit('bus:alternatives', alert);
    const first = alert.options[0];
    this.push?.toUser(userId, {
      title: 'Another bus can take you',
      body: `${alert.message}. ${busLabel(first.fleetCode)}: ${describeOption(first).join(' · ')}`,
      data: { type: 'bus:alternatives' },
    });
    return true;
  }

  /** The student has just said they did not board. */
  async afterMissed(userId, now = Date.now()) {
    const alert = await this.forStudent(userId, now);
    return alert ? this.notify(userId, alert) : false;
  }

  /** Every minute (jobs.js). */
  async sweep(now = Date.now()) {
    if (!this.settings.enabled || !this.tracking.liveSnapshot().length || (await this.calendar?.isPaused(now))) return { alerted: 0 };
    const day = await this.dayState(this.tracking.defaultDirection(new Date(now)), now);
    const sent = await this.db.query('SELECT user_id FROM bus_alternative_alerts WHERE day = $1 AND direction = $2', [day.date, day.direction]);
    const done = new Set(sent.rows.map((r) => r.user_id));
    let alerted = 0;
    for (const st of await this.students()) {
      if (!st.boarding_reminders || done.has(st.id)) continue;
      const alert = this.evaluate(st, day, now);
      if (alert && (await this.notify(st.id, alert))) alerted += 1;
    }
    return { alerted };
  }
}
