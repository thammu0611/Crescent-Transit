// Suggestions for the transport office, each approved or dismissed with one tap:
//
//   Timetable    once the times buses really take between stops keep differing
//                from the printed timetable, a corrected timetable for the route.
//   Overcrowding a route that keeps running full, with a spare bus to add and a
//                less crowded nearby route that could take some students.
//   Replacement  when a bus breaks down, the nearest free bus and its driver;
//                approving it tells the route's students and parents.
import { busLabel } from '../shared/institution.js';
import { haversineMeters } from '../shared/geo.js';
import { PRESENT_SQL } from './attendance.js';
import { HttpError } from './auth.js';
import { clockMinutes } from './alternatives.js';
import { audit } from './util.js';

/** Minutes after midnight -> "7.35 AM", the timetable's own style. */
export function clockText(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}.${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export class InsightsService {
  constructor(db, config, { tracking, notify = null, guardians = null, push = null, io = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.insights;
    this.tracking = tracking;
    this.notify = notify;
    this.guardians = guardians;
    this.push = push;
    this.io = io;
  }

  async suggest({ kind, key, routeId = null, busId = null, incidentId = null, title, detail }) {
    const { rows } = await this.db.query(
      `INSERT INTO ops_suggestions (kind, key, route_id, bus_id, incident_id, title, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO NOTHING RETURNING *`,
      [kind, key, routeId, busId, incidentId, title, JSON.stringify(detail)],
    );
    if (rows[0]) {
      this.io?.to('admins').emit('suggestion', rows[0]);
      this.push?.toRole('admin', { title: 'New suggestion', body: title, data: { type: 'suggestion', id: rows[0].id } });
    }
    return rows[0] ?? null;
  }

  async open(kind, routeId) {
    const { rows } = await this.db.query(`SELECT id FROM ops_suggestions WHERE kind = $1 AND route_id = $2 AND status = 'PENDING'`, [kind, routeId]);
    return rows[0] ?? null;
  }

  // ---- Timetable ------------------------------------------------------------------------

  /** Per route and stop: how long after the first stop buses really arrive (morning run, last 30 days). */
  async actualOffsets() {
    const { rows } = await this.db.query(
      `SELECT t.route_id, sa.stop_seq,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (sa.arrived_at - s1.arrived_at)) / 60)::float AS minutes,
              count(DISTINCT t.id)::int AS trips
         FROM stop_arrivals sa
         JOIN trips t ON t.id = sa.trip_id
         JOIN stop_arrivals s1 ON s1.trip_id = t.id AND s1.stop_seq = 1
        WHERE t.direction = 'UP' AND t.status = 'completed' AND sa.arrived_at > now() - interval '30 days' AND sa.arrived_at >= s1.arrived_at
        GROUP BY t.route_id, sa.stop_seq`,
    );
    return rows;
  }

  async timetableProposals() {
    const s = this.settings;
    const actual = await this.actualOffsets();
    const byRoute = new Map();
    for (const r of actual) {
      if (!byRoute.has(r.route_id)) byRoute.set(r.route_id, new Map());
      byRoute.get(r.route_id).set(r.stop_seq, r);
    }
    let made = 0;
    for (const [routeId, seen] of byRoute) {
      const stops = this.tracking.stopsByRoute.get(routeId) ?? [];
      const route = (await this.db.query('SELECT code, departure_time FROM routes WHERE id = $1', [routeId])).rows[0];
      const leaves = clockMinutes(route?.departure_time);
      const first = stops[0];
      if (leaves == null || !first || first.offset_minutes == null) continue;
      const changes = [];
      for (const stop of stops) {
        const got = seen.get(stop.seq);
        if (!got || got.trips < s.timetableMinTrips || stop.offset_minutes == null) continue;
        const printed = stop.offset_minutes - first.offset_minutes;
        const real = Math.round(got.minutes);
        changes.push({
          seq: stop.seq,
          name: stop.name,
          current: stop.scheduled_time ?? clockText(leaves + printed),
          proposed: clockText(leaves + real),
          offset: first.offset_minutes + real,
          diff: real - printed,
          trips: got.trips,
        });
      }
      const off = changes.filter((c) => Math.abs(c.diff) >= s.timetableDiffMin);
      if (off.length < s.timetableMinStops || (await this.open('TIMETABLE', routeId))) continue;
      const avg = Math.round(off.reduce((n, c) => n + c.diff, 0) / off.length);
      const week = new Date().toISOString().slice(0, 10);
      const made1 = await this.suggest({
        kind: 'TIMETABLE',
        key: `timetable:${routeId}:${week}`,
        routeId,
        title: `Route ${route.code}: ${off.length} stops are ${avg > 0 ? `${avg} min later` : `${-avg} min earlier`} than the timetable`,
        detail: { routeCode: route.code, stops: changes.filter((c) => c.diff !== 0) },
      });
      if (made1) made += 1;
    }
    return { proposals: made };
  }

  async applyTimetable(sugg) {
    const stops = sugg.detail?.stops ?? [];
    await this.db.transaction(async (tx) => {
      for (const c of stops) {
        await tx.query('UPDATE stops SET scheduled_time = $3, offset_minutes = $4 WHERE route_id = $1 AND seq = $2', [sugg.route_id, c.seq, c.proposed, c.offset]);
      }
    });
    await this.tracking.reloadStops();
    return { stopsUpdated: stops.length };
  }

  // ---- Overcrowding ---------------------------------------------------------------------

  async overcrowding() {
    const s = this.settings;
    const { rows } = await this.db.query(
      `WITH loads AS (
         SELECT t.id, t.route_id, b.capacity, t.occupancy,
                count(a.*) FILTER (WHERE ${PRESENT_SQL})::int AS travelled
           FROM trips t JOIN buses b ON b.id = t.bus_id LEFT JOIN attendance a ON a.trip_id = t.id
          WHERE t.status = 'completed' AND t.started_at > now() - make_interval(days => $1)
          GROUP BY t.id, b.capacity)
       SELECT route_id, count(*)::int AS trips,
              count(*) FILTER (WHERE occupancy = 'FULL' OR (capacity > 0 AND travelled > capacity))::int AS full_trips,
              max(travelled)::int AS most, max(capacity)::int AS capacity,
              round(avg(CASE WHEN capacity > 0 THEN travelled::numeric / capacity END) * 100)::int AS avg_load
         FROM loads GROUP BY route_id`,
      [s.crowdedDays],
    );
    let made = 0;
    for (const r of rows.filter((x) => x.full_trips >= s.crowdedTrips)) {
      if (await this.open('OVERCROWDING', r.route_id)) continue;
      const route = (await this.db.query('SELECT code, name FROM routes WHERE id = $1', [r.route_id])).rows[0];
      // A spare bus: active, with no route of its own.
      const spare = (await this.db.query(
        `SELECT b.fleet_code, b.capacity, (SELECT full_name FROM users WHERE bus_id = b.id AND role = 'driver' AND status = 'active' LIMIT 1) AS driver
           FROM buses b WHERE b.status = 'active' AND b.route_id IS NULL ORDER BY b.capacity DESC NULLS LAST LIMIT 1`,
      )).rows[0] ?? null;
      // Nearby routes with room: a stop within 1.5 km of one of this route's stops, average load under 60%.
      const mine = this.tracking.stopsByRoute.get(r.route_id) ?? [];
      const nearby = [];
      for (const other of rows) {
        if (other.route_id === r.route_id || other.avg_load == null || other.avg_load >= 60) continue;
        const theirs = this.tracking.stopsByRoute.get(other.route_id) ?? [];
        const close = mine.some((a) => theirs.some((b) => haversineMeters(a, b) <= 1500));
        if (!close) continue;
        const code = (await this.db.query('SELECT code FROM routes WHERE id = $1', [other.route_id])).rows[0]?.code;
        nearby.push({ routeCode: code, avgLoad: other.avg_load });
      }
      nearby.sort((a, b) => a.avgLoad - b.avgLoad);
      const week = new Date().toISOString().slice(0, 10);
      if (await this.suggest({
        kind: 'OVERCROWDING',
        key: `crowded:${r.route_id}:${week}`,
        routeId: r.route_id,
        title: `Route ${route.code} ran full ${r.full_trips} times in ${s.crowdedDays} days`,
        detail: {
          routeCode: route.code,
          fullTrips: r.full_trips,
          trips: r.trips,
          most: r.most,
          capacity: r.capacity,
          spareBus: spare ? { fleetCode: spare.fleet_code, capacity: spare.capacity, driver: spare.driver } : null,
          nearbyRoutes: nearby.slice(0, 3),
        },
      })) made += 1;
    }
    return { flagged: made };
  }

  // ---- Breakdown: a replacement bus -----------------------------------------------------

  /** Called when a driver reports a breakdown: suggest the nearest free bus and its driver. */
  async suggestReplacement(incident) {
    if (incident.kind !== 'BREAKDOWN' || !incident.bus_id) return null;
    const broken = this.tracking.latest.get(incident.bus_id);
    const at = incident.lat != null ? { lat: incident.lat, lng: incident.lng } : broken ? { lat: broken.lat, lng: broken.lng } : null;
    const { rows } = await this.db.query(
      `SELECT b.id, b.fleet_code, b.capacity, bl.lat, bl.lng, u.id AS driver_id, u.full_name AS driver, u.phone AS driver_phone
         FROM buses b
         JOIN users u ON u.bus_id = b.id AND u.role = 'driver' AND u.status = 'active'
         LEFT JOIN bus_latest bl ON bl.bus_id = b.id
        WHERE b.status = 'active' AND b.id <> $1
          AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.bus_id = b.id AND t.status = 'active')`,
      [incident.bus_id],
    );
    if (!rows.length) return null;
    const ranked = rows
      .map((b) => ({ ...b, km: at && b.lat != null ? Math.round(haversineMeters(at, b) / 100) / 10 : null }))
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    const pick = ranked[0];
    const brokenCode = (await this.db.query('SELECT fleet_code FROM buses WHERE id = $1', [incident.bus_id])).rows[0]?.fleet_code;
    return this.suggest({
      kind: 'REPLACEMENT',
      key: `replace:${incident.id}`,
      routeId: incident.route_id,
      busId: pick.id,
      incidentId: incident.id,
      title: `${busLabel(brokenCode)} broke down: send ${busLabel(pick.fleet_code)}${pick.km != null ? ` (${pick.km} km away)` : ''}`,
      detail: {
        brokenBus: brokenCode,
        replacement: { fleetCode: pick.fleet_code, driver: pick.driver, driverId: pick.driver_id, km: pick.km, capacity: pick.capacity },
        alternatives: ranked.slice(1, 4).map((b) => ({ fleetCode: b.fleet_code, driver: b.driver, km: b.km })),
        at,
      },
    });
  }

  async applyReplacement(sugg) {
    const d = sugg.detail;
    const broken = busLabel(d.brokenBus);
    const coming = busLabel(d.replacement.fleetCode);
    const title = `${broken} broke down - ${coming} is on its way`;
    const body = `${coming}${d.replacement.driver ? ` (driver ${d.replacement.driver})` : ''} is coming to take everyone on. Wait with the group.`;
    if (sugg.route_id) {
      await this.notify?.({ kind: 'BREAKDOWN', title, message: body, routeId: sugg.route_id });
      await this.guardians?.toRouteParents(sugg.route_id, { kind: 'BREAKDOWN', title, body });
    }
    if (d.replacement.driverId) {
      const where = d.at ? ` Location: https://maps.google.com/?q=${d.at.lat},${d.at.lng}` : '';
      this.push?.toUser(d.replacement.driverId, {
        title: `Go to ${broken}`,
        body: `${broken} has broken down. The transport office is sending your bus to pick up its students.${where}`,
        data: { type: 'replacement', incidentId: sugg.incident_id },
      });
    }
    if (sugg.incident_id) {
      await this.db.query('UPDATE incidents SET acknowledged_at = coalesce(acknowledged_at, now()) WHERE id = $1', [sugg.incident_id]);
    }
    return { told: true };
  }

  // ---- The queue ------------------------------------------------------------------------

  async list(status = 'PENDING') {
    const { rows } = await this.db.query(
      `SELECT s.*, r.code AS route_code, u.full_name AS decided_by_name
         FROM ops_suggestions s LEFT JOIN routes r ON r.id = s.route_id LEFT JOIN users u ON u.id = s.decided_by
        WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.created_at DESC LIMIT 100`,
      [status || null],
    );
    return rows;
  }

  /** Approve ("apply") or dismiss a suggestion. */
  async decide(id, action, userId) {
    if (!['apply', 'dismiss'].includes(action)) throw new HttpError(400, "action must be 'apply' or 'dismiss'");
    const { rows } = await this.db.query(
      `UPDATE ops_suggestions SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id, action === 'apply' ? 'APPLIED' : 'DISMISSED', userId],
    );
    const sugg = rows[0];
    if (!sugg) throw new HttpError(404, 'No pending suggestion with that id');
    let result = {};
    if (action === 'apply') {
      if (sugg.kind === 'TIMETABLE') result = await this.applyTimetable(sugg);
      else if (sugg.kind === 'REPLACEMENT') result = await this.applyReplacement(sugg);
    }
    await audit(this.db, { actorId: userId, action: `SUGGESTION_${sugg.status}`, entity: 'ops_suggestion', entityId: sugg.id, detail: { kind: sugg.kind, ...result } });
    this.io?.to('admins').emit('suggestion', sugg);
    return { ...sugg, result };
  }

  /** Nightly (jobs.js). */
  async daily() {
    return { ...(await this.timetableProposals()), ...(await this.overcrowding()) };
  }
}
