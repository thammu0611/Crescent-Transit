// Looking after the fleet: documents with expiry dates, service by distance,
// the fuel log and its cost per km, driver scorecards, and little-used stops.
import { haversineMeters } from '../shared/geo.js';
import { HttpError } from './auth.js';
import { PRESENT_SQL } from './attendance.js';
import { localDate } from './clock.js';

export const DOCUMENT_KINDS = ['INSURANCE', 'FITNESS', 'PERMIT', 'PUC'];
const DOC_TEXT = { INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PERMIT: 'Permit', PUC: 'PUC' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Reminders before a document expires; once it has expired, every day until it is renewed.
const REMIND_DAYS = [30, 15, 7, 3, 1, 0];
// A GPS trip adds its distance to the odometer; gaps longer than this between fixes are skipped (signal lost).
const MAX_HOP_M = 3000;
const SERVICE_WARN_KM = 500;

const daysUntil = (date, today) => Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
const whole = (v, name, max = 9_999_999) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${name} must be a whole number`);
  return n;
};

export class FleetCareService {
  constructor(db, config, { tracking, io = null, push = null }) {
    this.db = db;
    this.config = config;
    this.care = config.fleetCare;
    this.tracking = tracking;
    this.io = io;
    this.push = push;
    // The odometer moves by itself: each finished trip adds the distance the bus GPS drove.
    tracking?.on?.('tripEnded', ({ tripId, busId }) => this.addTripDistance(tripId, busId).catch(() => {}));
  }

  /** Adds a finished trip's GPS distance to the bus's odometer (when a reading exists to add to). */
  async addTripDistance(tripId, busId) {
    const { rows } = await this.db.query(
      `SELECT lat, lng, accuracy_m FROM location_pings WHERE trip_id = $1 ORDER BY recorded_at`,
      [tripId],
    );
    let metres = 0;
    let prev = null;
    for (const p of rows) {
      if (p.accuracy_m != null && p.accuracy_m > 150) continue; // a poor fix would add zig-zags
      if (prev) {
        const hop = haversineMeters(prev, p);
        if (hop <= MAX_HOP_M) metres += hop;
      }
      prev = p;
    }
    const km = Math.round(metres / 1000);
    if (km < 1) return 0;
    await this.db.query(
      `UPDATE buses SET odometer_km = odometer_km + $2, odometer_gps_km = COALESCE(odometer_gps_km, 0) + $2
        WHERE id = $1 AND odometer_km IS NOT NULL`,
      [busId, km],
    );
    return km;
  }

  today() {
    return localDate(new Date(), this.config.timeZone);
  }

  // ---- Documents and service ----------------------------------------------------------

  async overview() {
    const today = this.today();
    const [buses, docs] = await Promise.all([
      this.db.query(
        `SELECT b.id, b.fleet_code, b.status, b.odometer_km, b.odometer_gps_km, b.service_interval_km, b.last_service_km,
                to_char(b.last_service_on, 'YYYY-MM-DD') AS last_service_on, r.code AS route_code
           FROM buses b LEFT JOIN routes r ON r.id = b.route_id ORDER BY b.fleet_code`,
      ),
      this.db.query(`SELECT bus_id, kind, doc_number, to_char(expires_on, 'YYYY-MM-DD') AS expires_on FROM bus_documents`),
    ]);
    return buses.rows.map((b) => {
      const documents = DOCUMENT_KINDS.map((kind) => {
        const d = docs.rows.find((x) => x.bus_id === b.id && x.kind === kind);
        if (!d) return { kind, number: null, expiresOn: null, daysLeft: null, state: 'MISSING' };
        const daysLeft = daysUntil(d.expires_on, today);
        return { kind, number: d.doc_number, expiresOn: d.expires_on, daysLeft, state: daysLeft < 0 ? 'EXPIRED' : daysLeft <= 30 ? 'SOON' : 'OK' };
      });
      const nextServiceKm = b.last_service_km != null && b.service_interval_km ? b.last_service_km + b.service_interval_km : null;
      const kmLeft = nextServiceKm != null && b.odometer_km != null ? nextServiceKm - b.odometer_km : null;
      return {
        id: b.id,
        fleetCode: b.fleet_code,
        routeCode: b.route_code,
        status: b.status,
        odometerKm: b.odometer_km,
        odometerGpsKm: b.odometer_gps_km ?? 0,
        serviceIntervalKm: b.service_interval_km,
        lastServiceKm: b.last_service_km,
        lastServiceOn: b.last_service_on,
        nextServiceKm,
        kmLeft,
        serviceState: kmLeft == null ? 'UNKNOWN' : kmLeft <= 0 ? 'DUE' : kmLeft <= SERVICE_WARN_KM ? 'SOON' : 'OK',
        documents,
      };
    });
  }

  async setDocument(busId, kind, body = {}) {
    if (!DOCUMENT_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${DOCUMENT_KINDS.join(', ')}`);
    const expiresOn = String(body.expiresOn ?? '');
    if (!DATE_RE.test(expiresOn)) throw new HttpError(400, 'Give the expiry date');
    await this.db.query(
      `INSERT INTO bus_documents (bus_id, kind, doc_number, expires_on) VALUES ($1, $2, $3, $4)
       ON CONFLICT (bus_id, kind) DO UPDATE SET doc_number = EXCLUDED.doc_number, expires_on = EXCLUDED.expires_on`,
      [busId, kind, body.number ? String(body.number).trim().slice(0, 40) : null, expiresOn],
    );
    return { ok: true };
  }

  async setService(busId, body = {}) {
    const sets = [];
    const vals = [busId];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (body.odometerKm !== undefined) { add('odometer_km', whole(body.odometerKm, 'Odometer')); add('odometer_gps_km', 0); }
    if (body.serviceIntervalKm !== undefined) add('service_interval_km', whole(body.serviceIntervalKm, 'Service interval', 200000));
    if (body.lastServiceKm !== undefined) add('last_service_km', whole(body.lastServiceKm, 'Last service reading'));
    if (body.lastServiceOn !== undefined) {
      if (!DATE_RE.test(String(body.lastServiceOn))) throw new HttpError(400, 'Give the last service date');
      add('last_service_on', body.lastServiceOn);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    const { rowCount } = await this.db.query(`UPDATE buses SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!rowCount) throw new HttpError(404, 'Bus not found');
    return { ok: true };
  }

  /** A reminder to the transport office, once for each key. */
  async remind(key, busId, message) {
    const { rows } = await this.db.query('INSERT INTO care_reminders (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
    if (!rows[0]) return false;
    const inc = await this.db.query(
      `INSERT INTO incidents (kind, source, message, bus_id) VALUES ('VEHICLE_DOCUMENT', 'system', $1, $2) RETURNING *`,
      [message, busId],
    );
    this.io?.to('admins').emit('incident', inc.rows[0]);
    this.push?.toRole('admin', { title: 'Bus care reminder', body: message, data: { type: 'incident', id: inc.rows[0].id } });
    return true;
  }

  /**
   * Reminders to the transport office, each sent once: 30, 15, 7, 3 and 1 days
   * before a document expires and on the day; then every day while it stays
   * expired. Service: once when it falls due soon, then every day while overdue.
   */
  async sendReminders() {
    let sent = 0;
    const today = this.today();
    for (const bus of await this.overview()) {
      for (const d of bus.documents) {
        if (d.daysLeft == null) continue;
        let key;
        let message;
        if (d.daysLeft < 0) {
          key = `doc:${bus.id}:${d.kind}:${d.expiresOn}:expired:${today}`;
          message = `${bus.fleetCode}: ${DOC_TEXT[d.kind]} EXPIRED ${-d.daysLeft} day${d.daysLeft === -1 ? '' : 's'} ago (${d.expiresOn}). Renew it - the bus should not run without it.`;
        } else {
          const i = REMIND_DAYS.findIndex((n, k) => d.daysLeft <= n && d.daysLeft > (REMIND_DAYS[k + 1] ?? -1));
          if (i < 0) continue;
          key = `doc:${bus.id}:${d.kind}:${d.expiresOn}:${REMIND_DAYS[i]}`;
          message = `${bus.fleetCode}: ${DOC_TEXT[d.kind]} ${d.daysLeft === 0 ? 'expires TODAY' : `expires in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} (${d.expiresOn})`}.`;
        }
        if (await this.remind(key, bus.id, message)) sent += 1;
      }
      if (bus.serviceState === 'DUE') {
        const key = `service:${bus.id}:${bus.nextServiceKm}:due:${today}`;
        if (await this.remind(key, bus.id, `${bus.fleetCode}: service is OVERDUE by ${-bus.kmLeft} km (due at ${bus.nextServiceKm} km).`)) sent += 1;
      } else if (bus.serviceState === 'SOON') {
        if (await this.remind(`service:${bus.id}:${bus.nextServiceKm}:SOON`, bus.id, `${bus.fleetCode}: service is due in ${bus.kmLeft} km.`)) sent += 1;
      }
    }
    return { sent };
  }

  // ---- Fuel ------------------------------------------------------------------------------

  async addFuel(auth, body = {}) {
    let busId = auth.role === 'driver' ? auth.busId : null;
    if (auth.role !== 'driver') busId = (await this.db.query('SELECT id FROM buses WHERE fleet_code = $1', [String(body.fleetCode ?? '')])).rows[0]?.id;
    if (!busId) throw new HttpError(400, 'Choose a bus');
    const odometer = whole(body.odometerKm, 'Odometer');
    const litres = Number(body.litres);
    const cost = Number(body.costRupees);
    if (!(litres > 0 && litres < 1000)) throw new HttpError(400, 'Litres must be between 0 and 1000');
    if (!(cost > 0 && cost < 1000000)) throw new HttpError(400, 'Enter the amount paid');
    const bus = (await this.db.query('SELECT odometer_km, odometer_gps_km FROM buses WHERE id = $1', [busId])).rows[0];
    const lastReading = bus.odometer_km == null ? null : bus.odometer_km - (bus.odometer_gps_km ?? 0);
    if (lastReading != null && odometer < lastReading) throw new HttpError(400, `The odometer cannot go backwards: it was ${lastReading} km`);
    const { rows } = await this.db.query(
      `INSERT INTO fuel_logs (bus_id, entered_by, day, odometer_km, litres, cost_paise, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [busId, auth.userId, this.today(), odometer, litres, Math.round(cost * 100), body.note ? String(body.note).slice(0, 200) : null],
    );
    await this.db.query('UPDATE buses SET odometer_km = $2, odometer_gps_km = 0 WHERE id = $1', [busId, odometer]);
    return rows[0];
  }

  /**
   * Cost per km between fills: each fill pays for the distance since the one
   * before, so a bus's first fill in the period only sets the starting reading.
   */
  async fuelReport({ from, to }) {
    const { rows } = await this.db.query(
      `SELECT f.bus_id, b.fleet_code, r.code AS route_code, r.name AS route_name, f.odometer_km, f.litres::float AS litres, f.cost_paise
         FROM fuel_logs f JOIN buses b ON b.id = f.bus_id LEFT JOIN routes r ON r.id = b.route_id
        WHERE f.day BETWEEN $1 AND $2 ORDER BY f.bus_id, f.odometer_km, f.id`,
      [from, to],
    );
    const byBus = new Map();
    for (const r of rows) {
      if (!byBus.has(r.bus_id)) byBus.set(r.bus_id, { fleetCode: r.fleet_code, routeCode: r.route_code, routeName: r.route_name, fills: 0, startKm: r.odometer_km, endKm: r.odometer_km, litres: 0, costPaise: 0 });
      const b = byBus.get(r.bus_id);
      b.fills += 1;
      b.endKm = r.odometer_km;
      if (b.fills > 1) {
        b.litres += r.litres;
        b.costPaise += r.cost_paise;
      }
    }
    const list = [...byBus.values()].map((b) => {
      const km = b.endKm - b.startKm;
      return {
        ...b,
        litres: Math.round(b.litres * 10) / 10,
        km,
        costPerKmPaise: km > 0 ? Math.round(b.costPaise / km) : null,
        kmPerLitre: km > 0 && b.litres > 0 ? Math.round((km / b.litres) * 10) / 10 : null,
      };
    });
    const costPaise = list.reduce((n, b) => n + b.costPaise, 0);
    const km = list.reduce((n, b) => n + b.km, 0);
    return {
      from,
      to,
      buses: list.sort((a, b) => (b.costPerKmPaise ?? 0) - (a.costPerKmPaise ?? 0)),
      total: { km, costPaise, costPerKmPaise: km ? Math.round(costPaise / km) : null },
      plannedMonthlyPaise: this.config.finance.monthlyRunningCostPaise,
    };
  }

  async fuelLogs(limit = 50) {
    const { rows } = await this.db.query(
      `SELECT f.id, to_char(f.day, 'YYYY-MM-DD') AS day, f.odometer_km, f.litres::float AS litres, f.cost_paise, f.note, b.fleet_code, u.full_name AS entered_by
         FROM fuel_logs f JOIN buses b ON b.id = f.bus_id LEFT JOIN users u ON u.id = f.entered_by
        ORDER BY f.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  // ---- Driver scorecards --------------------------------------------------------------------

  /**
   * One card per driver. The score weighs punctuality 50%, trip ratings 30% and
   * safety 20% (each speeding alert or failed check takes 10 off safety). A part
   * with no data yet is left out, so a new driver is not marked down for it.
   */
  async scorecards(days = 30) {
    const window = `${Math.max(1, Math.min(365, Number(days) || 30))} days`;
    const { rows } = await this.db.query(
      `SELECT u.id, u.full_name, u.username, b.fleet_code, r.code AS route_code,
              (SELECT count(*)::int FROM trips t WHERE t.driver_id = u.id AND t.status = 'completed' AND t.started_at > now() - $1::interval) AS trips,
              (SELECT count(*)::int FROM stop_arrivals sa JOIN trips t ON t.id = sa.trip_id
                 JOIN stops s ON s.route_id = t.route_id AND s.seq = sa.stop_seq
                 JOIN stops first ON first.route_id = t.route_id AND first.seq = 1
                WHERE t.driver_id = u.id AND t.direction = 'UP' AND s.offset_minutes IS NOT NULL AND sa.arrived_at > now() - $1::interval) AS stops_timed,
              (SELECT count(*)::int FROM stop_arrivals sa JOIN trips t ON t.id = sa.trip_id
                 JOIN stops s ON s.route_id = t.route_id AND s.seq = sa.stop_seq
                 JOIN stops first ON first.route_id = t.route_id AND first.seq = 1
                WHERE t.driver_id = u.id AND t.direction = 'UP' AND s.offset_minutes IS NOT NULL AND sa.arrived_at > now() - $1::interval
                  AND extract(epoch FROM (sa.arrived_at - t.started_at)) / 60 <= (s.offset_minutes - first.offset_minutes) + 5) AS stops_on_time,
              (SELECT count(*)::int FROM incidents i JOIN trips t ON t.id = i.trip_id
                WHERE i.kind = 'SPEEDING' AND t.driver_id = u.id AND i.created_at > now() - $1::interval) AS speeding,
              (SELECT round(avg(f.rating)::numeric, 1)::float FROM trip_feedback f JOIN trips t ON t.id = f.trip_id
                WHERE t.driver_id = u.id AND f.created_at > now() - $1::interval) AS rating,
              (SELECT count(*)::int FROM trip_feedback f JOIN trips t ON t.id = f.trip_id
                WHERE t.driver_id = u.id AND f.created_at > now() - $1::interval) AS ratings,
              (SELECT count(*)::int FROM bus_checklists c WHERE c.driver_id = u.id AND c.failed > 0 AND c.created_at > now() - $1::interval) AS failed_checks,
              (SELECT count(*)::int FROM bus_checklists c WHERE c.driver_id = u.id AND c.created_at > now() - $1::interval) AS checks
         FROM users u
         LEFT JOIN buses b ON b.id = u.bus_id
         LEFT JOIN routes r ON r.id = b.route_id
        WHERE u.role = 'driver' AND u.status = 'active'
        ORDER BY u.full_name`,
      [window],
    );
    return rows.map((d) => {
      const onTimePct = d.stops_timed ? Math.round((d.stops_on_time / d.stops_timed) * 100) : null;
      const safety = Math.max(0, 100 - 10 * (d.speeding + d.failed_checks));
      const parts = [[onTimePct, 0.5], [d.rating == null ? null : (d.rating / 5) * 100, 0.3], [d.trips || d.checks ? safety : null, 0.2]].filter(([v]) => v != null);
      const weight = parts.reduce((n, [, w]) => n + w, 0);
      const score = weight ? Math.round(parts.reduce((n, [v, w]) => n + v * w, 0) / weight) : null;
      return {
        id: d.id,
        name: d.full_name,
        username: d.username,
        fleetCode: d.fleet_code,
        routeCode: d.route_code,
        trips: d.trips,
        onTimePct,
        speeding: d.speeding,
        rating: d.rating,
        ratings: d.ratings,
        failedChecks: d.failed_checks,
        checks: d.checks,
        score,
      };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  // ---- Stops almost nobody uses ------------------------------------------------------------------

  /** Stops with few boardings and no student living there, and the nearby stop to merge them into. */
  async stopSuggestions(days = 30) {
    const window = `${Math.max(7, Math.min(365, Number(days) || 30))} days`;
    const { rows } = await this.db.query(
      `SELECT s.route_id, s.seq,
              (SELECT count(*)::int FROM attendance a JOIN trips t ON t.id = a.trip_id
                WHERE a.boarding_stop_id = s.id AND t.direction = 'UP' AND ${PRESENT_SQL} AND a.boarded_at > now() - $1::interval) AS boardings,
              (SELECT count(*)::int FROM users u WHERE u.role = 'student' AND u.status = 'active' AND u.home_route_id = s.route_id AND u.home_stop_seq = s.seq) AS students
         FROM stops s`,
      [window],
    );
    const { rows: routes } = await this.db.query('SELECT id, code, name FROM routes WHERE active ORDER BY code');
    const use = new Map(rows.map((r) => [`${r.route_id}:${r.seq}`, r]));
    const out = [];
    for (const route of routes) {
      const stops = (this.tracking.stopsByRoute.get(route.id) ?? []).slice(0, -1); // never the campus
      for (const stop of stops) {
        const u = use.get(`${route.id}:${stop.seq}`);
        if (!u || u.students > 0 || u.boardings > this.care.quietStopBoardings) continue;
        const near = stops.filter((s) => s !== stop)
          .map((s) => ({ stop: s, distanceM: Math.round(haversineMeters(s, stop)), load: (use.get(`${route.id}:${s.seq}`)?.boardings ?? 0) + (use.get(`${route.id}:${s.seq}`)?.students ?? 0) }))
          .sort((a, b) => a.distanceM - b.distanceM)[0];
        const merge = near && near.distanceM <= this.care.mergeWithinM;
        out.push({
          routeCode: route.code,
          routeName: route.name,
          stopName: stop.name,
          boardings: u.boardings,
          students: u.students,
          mergeInto: merge ? near.stop.name : null,
          distanceM: merge ? near.distanceM : null,
          suggestion: merge ? `Merge into ${near.stop.name} (${near.distanceM} m away)` : 'Little used, and no stop close by. Review it.',
        });
      }
    }
    return out.sort((a, b) => (a.mergeInto ? 0 : 1) - (b.mergeInto ? 0 : 1) || a.distanceM - b.distanceM);
  }
}
