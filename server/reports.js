// Registers and reports for the transport office (doc 9.14), ETA accuracy
// (doc 7.3), attendance accuracy against a manual register (doc 9.9), and the
// administrator's KPI strip (doc B.8).
import { HttpError } from './auth.js';
import { PRESENT_SQL } from './attendance.js';
import { localDate } from './clock.js';
import { parseCsv } from './util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportService {
  constructor(db, config, tracking) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
  }

  /** Validated { from, to } dates (default: the last 30 days) and optional route code. */
  range(query) {
    const today = localDate(new Date(), this.config.timeZone);
    const from = query.from ?? localDate(new Date(Date.now() - 29 * 86400000), this.config.timeZone);
    const to = query.to ?? today;
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new HttpError(400, 'from/to must be YYYY-MM-DD with from <= to');
    return { from, to, route: query.route ? String(query.route) : null };
  }

  /** Attendance register: one row per student per trip, or totals per student. */
  async attendanceRegister(query) {
    const { from, to, route } = this.range(query);
    const tz = this.config.timeZone;
    const params = [from, to, tz, route];
    const base = `
      FROM attendance a
      JOIN trips t  ON t.id = a.trip_id
      JOIN routes r ON r.id = t.route_id
      JOIN buses b  ON b.id = a.bus_id
      JOIN users u  ON u.id = a.user_id
      LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
      LEFT JOIN stops als ON als.id = a.alighting_stop_id
     WHERE (a.boarded_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
       AND ($4::text IS NULL OR r.code = $4)`;
    if (query.group === 'student') {
      const { rows } = await this.db.query(
        `SELECT u.username, u.full_name, u.register_no, u.department,
                count(*) FILTER (WHERE ${PRESENT_SQL})::int AS trips_present,
                count(*) FILTER (WHERE a.method = 'GPS' AND ${PRESENT_SQL})::int AS by_gps,
                count(*) FILTER (WHERE a.method IN ('QR', 'MANUAL', 'STOP') AND ${PRESENT_SQL})::int AS by_fallback,
                count(*) FILTER (WHERE a.status = 'PROVISIONAL')::int AS provisional,
                count(*) FILTER (WHERE a.status = 'DISPUTED')::int AS disputed
         ${base} GROUP BY u.id ORDER BY u.username`,
        params,
      );
      return rows;
    }
    const { rows } = await this.db.query(
      `SELECT to_char(a.boarded_at AT TIME ZONE $3, 'YYYY-MM-DD') AS date, a.trip_id, r.code AS route, b.fleet_code AS bus,
              u.username, u.full_name, u.register_no, u.department, a.status, a.method,
              ${PRESENT_SQL} AS present,
              to_char(a.boarded_at AT TIME ZONE $3, 'HH24:MI') AS boarded, bs.name AS boarding_stop,
              to_char(a.alighted_at AT TIME ZONE $3, 'HH24:MI') AS alighted, als.name AS alighting_stop,
              a.confidence, a.flagged, a.auto_confirmed, a.locked
       ${base} ORDER BY a.boarded_at, r.code, u.username`,
      params,
    );
    return rows;
  }

  /** Boarding demand per stop and hour (doc 9.14). */
  async demand(query) {
    const { from, to, route } = this.range(query);
    const { rows } = await this.db.query(
      `SELECT r.code AS route, s.seq, s.name AS stop,
              extract(hour FROM a.boarded_at AT TIME ZONE $3)::int AS hour, count(*)::int AS boardings
         FROM attendance a
         JOIN trips t ON t.id = a.trip_id
         JOIN routes r ON r.id = t.route_id
         JOIN stops s ON s.id = a.boarding_stop_id
        WHERE ${PRESENT_SQL} AND (a.boarded_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
          AND ($4::text IS NULL OR r.code = $4)
        GROUP BY r.code, s.seq, s.name, hour
        ORDER BY r.code, s.seq, hour`,
      [from, to, this.config.timeZone, route],
    );
    return rows;
  }

  /** Occupancy against capacity per trip: the overloaded and the near-empty buses. */
  async occupancy(query) {
    const { from, to, route } = this.range(query);
    const { rows } = await this.db.query(
      `SELECT t.id AS trip_id, to_char(t.started_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS started,
              r.code AS route, b.fleet_code AS bus, b.capacity,
              count(a.*) FILTER (WHERE ${PRESENT_SQL})::int AS travelled, t.occupancy AS driver_reported, t.flagged
         FROM trips t
         JOIN routes r ON r.id = t.route_id
         JOIN buses b ON b.id = t.bus_id
         LEFT JOIN attendance a ON a.trip_id = t.id
        WHERE t.status IN ('active', 'completed') AND (t.started_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
          AND ($4::text IS NULL OR r.code = $4)
        GROUP BY t.id, r.code, b.fleet_code, b.capacity
        ORDER BY t.started_at DESC`,
      [from, to, this.config.timeZone, route],
    );
    return rows.map((r) => ({ ...r, load_pct: r.capacity ? Math.round((r.travelled / r.capacity) * 100) : null }));
  }

  /** Exceptions (doc 9.14): provisional, overrides, capacity breaches, flagged devices and trips. */
  async exceptions(query) {
    const { from, to } = this.range(query);
    const tz = this.config.timeZone;
    const [provisional, overrides, incidents, devices, trips] = await Promise.all([
      this.db.query(
        `SELECT a.attendance_id, u.username, a.trip_id, a.status, a.flagged, a.flag_reason, a.auto_confirmed, a.prompted_at
           FROM attendance a JOIN users u ON u.id = a.user_id
          WHERE (a.status = 'PROVISIONAL' OR a.auto_confirmed OR a.flagged)
            AND (a.created_at AT TIME ZONE $3)::date BETWEEN $1 AND $2 ORDER BY a.created_at DESC`,
        [from, to, tz],
      ),
      this.db.query(
        `SELECT e.attendance_id, u.username, e.trip_id, e.detail, e.server_ts
           FROM attendance_events e JOIN users u ON u.id = e.user_id
          WHERE e.event_type = 'OVERRIDE' AND (e.server_ts AT TIME ZONE $3)::date BETWEEN $1 AND $2
          ORDER BY e.server_ts DESC`,
        [from, to, tz],
      ),
      this.db.query(
        `SELECT id, kind, message, trip_id, bus_id, user_id, status, created_at FROM incidents
          WHERE source = 'system' AND (created_at AT TIME ZONE $3)::date BETWEEN $1 AND $2 ORDER BY created_at DESC`,
        [from, to, tz],
      ),
      this.db.query(
        `SELECT u.username, u.full_name, d.platform, d.bound_at FROM devices d JOIN users u ON u.id = d.user_id
          WHERE d.mock_location_flag ORDER BY d.bound_at DESC`,
      ),
      this.db.query(
        `SELECT t.id AS trip_id, r.code AS route, t.flag_reason, t.started_at FROM trips t JOIN routes r ON r.id = t.route_id
          WHERE t.flagged AND (t.started_at AT TIME ZONE $3)::date BETWEEN $1 AND $2 ORDER BY t.started_at DESC`,
        [from, to, tz],
      ),
    ]);
    return {
      provisionalOrFlagged: provisional.rows,
      manualOverrides: overrides.rows,
      systemIncidents: incidents.rows,
      flaggedDevices: devices.rows,
      flaggedTrips: trips.rows,
    };
  }

  /** Students recorded on buses with no active subscription that day: the leakage number. */
  async leakage(query) {
    const { from, to, route } = this.range(query);
    const { rows } = await this.db.query(
      `SELECT to_char(a.boarded_at AT TIME ZONE $3, 'YYYY-MM-DD') AS date, u.username, u.full_name, u.register_no,
              r.code AS route, a.method, a.trip_id
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN trips t ON t.id = a.trip_id
         JOIN routes r ON r.id = t.route_id
        WHERE ${PRESENT_SQL} AND (a.boarded_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
          AND ($4::text IS NULL OR r.code = $4)
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s
             WHERE s.user_id = a.user_id AND s.status IN ('ACTIVE', 'EXPIRED')
               AND (a.boarded_at AT TIME ZONE $3)::date BETWEEN s.valid_from AND s.valid_to)
        ORDER BY a.boarded_at DESC`,
      [from, to, this.config.timeZone, route],
    );
    return rows;
  }

  /** ETA mean absolute error by route, by time band and by method (doc 7.3). */
  async etaAccuracy(query) {
    const { from, to, route } = this.range(query);
    const tz = this.config.timeZone;
    const { rows } = await this.db.query(
      `WITH pairs AS (
         SELECT r.code AS route, p.method,
                extract(hour FROM p.predicted_at AT TIME ZONE $3)::int AS hour,
                abs(extract(epoch FROM (sa.arrived_at - p.predicted_arrival))) / 60 AS err_min,
                extract(epoch FROM (sa.arrived_at - p.predicted_at)) / 60 AS lead_min
           FROM eta_predictions p
           JOIN stop_arrivals sa ON sa.trip_id = p.trip_id AND sa.stop_seq = p.stop_seq
           JOIN trips t ON t.id = p.trip_id
           JOIN routes r ON r.id = t.route_id
          WHERE sa.arrived_at > p.predicted_at + interval '30 seconds'
            AND (p.predicted_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
            AND ($4::text IS NULL OR r.code = $4))
       SELECT 'route' AS dim, route AS key, count(*)::int AS n, round(avg(err_min)::numeric, 2)::float AS mae_min FROM pairs GROUP BY route
       UNION ALL
       SELECT 'hour', lpad(hour::text, 2, '0') || ':00', count(*)::int, round(avg(err_min)::numeric, 2)::float FROM pairs GROUP BY hour
       UNION ALL
       SELECT 'method', method, count(*)::int, round(avg(err_min)::numeric, 2)::float FROM pairs GROUP BY method
       UNION ALL
       SELECT 'lead', CASE WHEN lead_min < 5 THEN '0-5 min ahead' WHEN lead_min < 15 THEN '5-15 min ahead' ELSE '15+ min ahead' END,
              count(*)::int, round(avg(err_min)::numeric, 2)::float FROM pairs GROUP BY 2
       UNION ALL
       SELECT 'overall', 'all', count(*)::int, round(avg(err_min)::numeric, 2)::float FROM pairs`,
      [from, to, tz, route],
    );
    const pick = (dim) => rows.filter((r) => r.dim === dim).map(({ key, n, mae_min: mae }) => ({ key, n, maeMin: mae }));
    const overall = rows.find((r) => r.dim === 'overall');
    return {
      from, to,
      overall: { n: overall?.n ?? 0, maeMin: overall?.mae_min ?? null },
      targetMin: 3,
      byRoute: pick('route').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
      byHour: pick('hour').sort((a, b) => a.key.localeCompare(b.key)),
      byMethod: pick('method'),
      byLead: pick('lead'),
    };
  }

  /**
   * Precision and recall of the automatic register against a register taken
   * by hand on the same trips (doc 9.9). Input: CSV with trip_id,username.
   */
  async attendanceAccuracy(manualCsv) {
    const lines = parseCsv(manualCsv);
    if (!lines.length || !('trip_id' in lines[0]) || !('username' in lines[0])) {
      throw new HttpError(400, 'Upload a CSV with trip_id and username columns (one row per student seen on the bus)');
    }
    const manual = new Set(lines.map((l) => `${Number(l.trip_id)}:${l.username.toLowerCase()}`));
    const tripIds = [...new Set(lines.map((l) => Number(l.trip_id)))].filter(Number.isInteger);
    const { rows } = await this.db.query(
      `SELECT a.trip_id, u.username, a.status, a.method, ${PRESENT_SQL} AS present
         FROM attendance a JOIN users u ON u.id = a.user_id
        WHERE a.trip_id = ANY($1) AND a.method = 'GPS'`,
      [tripIds],
    );
    const auto = new Set(rows.filter((r) => r.present).map((r) => `${r.trip_id}:${r.username}`));
    const tp = [...auto].filter((k) => manual.has(k)).length;
    const fp = [...auto].filter((k) => !manual.has(k));
    const fn = [...manual].filter((k) => !auto.has(k));

    const prompts = await this.db.query(
      `SELECT count(*) FILTER (WHERE event_type = 'PROMPT')::int AS prompts,
              count(*) FILTER (WHERE event_type = 'ANSWER' AND detail = 'NO')::int AS answered_no,
              count(DISTINCT user_id) FILTER (WHERE event_type = 'PROMPT')::int AS students
         FROM attendance_events WHERE trip_id = ANY($1)`,
      [tripIds],
    );
    const answered = await this.db.query(
      `SELECT count(*)::int AS n FROM attendance
        WHERE trip_id = ANY($1) AND method = 'GPS' AND answered_at IS NOT NULL
          AND answered_at <= prompted_at + make_interval(secs => $2)`,
      [tripIds, this.config.attendance.rules.promptTimeoutS],
    );
    const provisional = rows.filter((r) => r.status === 'PROVISIONAL').length;
    const p = prompts.rows[0];
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    return {
      trips: tripIds.length,
      truePositives: tp,
      falsePositives: fp.length,
      falseNegatives: fn.length,
      precisionPct: pct(tp, tp + fp.length),
      recallPct: pct(tp, tp + fn.length),
      promptResponsePct: pct(answered.rows[0].n, p.prompts),
      falsePrompts: p.answered_no,
      provisionalSharePct: pct(provisional, rows.length),
      targets: { precisionPct: 97, recallPct: 95, promptResponsePct: 80, provisionalSharePct: 10 },
      falsePositiveList: fp,
      falseNegativeList: fn,
    };
  }

  /** The administrator's KPI strip (doc B.8). */
  async kpis() {
    const today = localDate(new Date(), this.config.timeZone);
    const tz = this.config.timeZone;
    const live = this.tracking.liveSnapshot();
    const [delay, failures, incidents, attendance, onTime, review] = await Promise.all([
      this.db.query(
        `SELECT round(avg(extract(epoch FROM (received_at - recorded_at)))::numeric, 1)::float AS s
           FROM location_pings WHERE received_at > now() - interval '1 hour'`,
      ),
      this.db.query(`SELECT count(*)::int AS n FROM rejected_pings WHERE (received_at AT TIME ZONE $1)::date = $2`, [tz, today]),
      this.db.query(`SELECT count(*)::int AS n FROM incidents WHERE status = 'OPEN'`),
      this.db.query(
        `SELECT count(*) FILTER (WHERE ${PRESENT_SQL})::int AS present, count(*) FILTER (WHERE a.method = 'GPS')::int AS gps
           FROM attendance a WHERE (a.boarded_at AT TIME ZONE $1)::date = $2`,
        [tz, today],
      ),
      // Schedule adherence: minutes from trip start to each stop vs the timetable offset.
      this.db.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE extract(epoch FROM (sa.arrived_at - t.started_at)) / 60
                                       <= (s.offset_minutes - first.offset_minutes) + 5)::int AS on_time
           FROM stop_arrivals sa
           JOIN trips t ON t.id = sa.trip_id
           JOIN stops s ON s.route_id = t.route_id AND s.seq = sa.stop_seq
           JOIN stops first ON first.route_id = t.route_id AND first.seq = 1
          WHERE (sa.arrived_at AT TIME ZONE $1)::date = $2 AND s.offset_minutes IS NOT NULL`,
        [tz, today],
      ),
      this.db.query(`SELECT count(*)::int AS n FROM attendance WHERE status IN ('PROVISIONAL', 'DISPUTED')`),
    ]);
    const ot = onTime.rows[0];
    return {
      busesRunning: live.length,
      busesByFreshness: live.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {}),
      onTimePct: ot.n ? Math.round((ot.on_time / ot.n) * 100) : null,
      avgUpdateDelayS: delay.rows[0].s,
      gpsFailuresToday: failures.rows[0].n,
      openIncidents: incidents.rows[0].n,
      presentToday: attendance.rows[0].present,
      gpsRecordsToday: attendance.rows[0].gps,
      awaitingReview: review.rows[0].n,
    };
  }
}
