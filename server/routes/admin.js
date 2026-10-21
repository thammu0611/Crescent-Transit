// Administrator API (doc 4.1, Phase 4): buses, drivers, routes and stops,
// trip scheduling, announcements, incidents, students and attendance review.
// Every route here is behind requireRole('admin') (see app.js).
import express from 'express';
import { HttpError, hashPassword } from '../auth.js';
import { localDate } from '../clock.js';
import { PRESENT_SQL } from '../attendance.js';
import { audit, intParam } from '../util.js';

const str = (v, max = 200) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, max));
const fkError = (err, what) => {
  if (err.code === '23503') throw new HttpError(409, `${what} has history and cannot be deleted; deactivate it instead`);
  if (err.code === '23505') throw new HttpError(409, 'That code or name is already in use');
  throw err;
};

/** Build "SET a = $2, b = $3" from the defined keys of `fields`. */
function setClause(fields, first = 2) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  return { sql: keys.map((k, i) => `${k} = $${i + first}`).join(', '), values: keys.map((k) => fields[k]) };
}

export function adminRouter({ db, config, tracking, attendance, reports, jobs, io }) {
  const r = express.Router();

  const routeIdByCode = async (code) => {
    if (code === null || code === '') return null;
    const { rows } = await db.query('SELECT id FROM routes WHERE code = $1', [String(code)]);
    if (!rows[0]) throw new HttpError(400, `Unknown route ${code}`);
    return rows[0].id;
  };
  const busIdByCode = async (code) => {
    if (code === null || code === '') return null;
    const { rows } = await db.query('SELECT id FROM buses WHERE fleet_code = $1', [String(code)]);
    if (!rows[0]) throw new HttpError(400, `Unknown bus ${code}`);
    return rows[0].id;
  };

  r.get('/kpis', async (_req, res) => res.json(await reports.kpis()));

  // ---- Buses ---------------------------------------------------------------

  r.get('/buses', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT b.id, b.fleet_code, b.registration_number, b.bus_type, b.capacity, b.is_ac, b.status,
              r.code AS route_code, r.name AS route_name, u.username AS driver_username, u.full_name AS driver_name,
              (SELECT count(*)::int FROM trips t WHERE t.bus_id = b.id) AS trips,
              (SELECT unique_id FROM bus_trackers g WHERE g.bus_id = b.id) AS tracker_id,
              (SELECT count(*)::int FROM users st WHERE st.role = 'student' AND st.status = 'active'
                  AND b.route_id IS NOT NULL AND st.home_route_id = b.route_id) AS students
         FROM buses b LEFT JOIN routes r ON r.id = b.route_id LEFT JOIN users u ON u.bus_id = b.id AND u.role = 'driver'
        ORDER BY b.fleet_code`,
    );
    res.json(rows.map((b) => ({ ...b, live: tracking.latest.has(b.id), liveSource: tracking.latest.get(b.id)?.source ?? null })));
  });

  const busFields = async (body) => ({
    fleet_code: str(body.fleetCode, 30),
    registration_number: str(body.registrationNumber, 30),
    bus_type: str(body.busType, 60),
    capacity: body.capacity === undefined ? undefined : validCapacity(body.capacity),
    is_ac: body.isAc === undefined ? undefined : Boolean(body.isAc),
    status: body.status === undefined ? undefined : validStatus(body.status),
    route_id: body.routeCode === undefined ? undefined : await routeIdByCode(body.routeCode),
  });
  const validCapacity = (c) => {
    const n = Number(c);
    if (!Number.isInteger(n) || n < 1 || n > 120) throw new HttpError(400, 'capacity must be 1-120');
    return n;
  };
  const validStatus = (s) => {
    if (!['active', 'inactive', 'maintenance'].includes(s)) throw new HttpError(400, 'status must be active, inactive or maintenance');
    return s;
  };

  r.post('/buses', async (req, res) => {
    const f = await busFields(req.body ?? {});
    if (!f.fleet_code) throw new HttpError(400, 'fleetCode is required');
    const keys = Object.keys(f).filter((k) => f[k] !== undefined);
    try {
      const { rows } = await db.query(
        `INSERT INTO buses (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        keys.map((k) => f[k]),
      );
      await audit(db, { actorId: req.auth.userId, action: 'BUS_CREATED', entity: 'bus', entityId: rows[0].id });
      res.status(201).json(rows[0]);
    } catch (err) {
      fkError(err, 'Bus');
    }
  });

  r.patch('/buses/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const { sql, values } = setClause(await busFields(req.body ?? {}));
    if (tracking.latest.has(id) && req.body.routeCode !== undefined) throw new HttpError(409, 'End the running trip before moving the bus to another route');
    try {
      const { rows } = await db.query(`UPDATE buses SET ${sql} WHERE id = $1 RETURNING *`, [id, ...values]);
      if (!rows[0]) throw new HttpError(404, 'Bus not found');
      await audit(db, { actorId: req.auth.userId, action: 'BUS_UPDATED', entity: 'bus', entityId: id, detail: req.body });
      res.json(rows[0]);
    } catch (err) {
      fkError(err, 'Bus');
    }
  });

  r.delete('/buses/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    try {
      await db.query('UPDATE users SET bus_id = NULL WHERE bus_id = $1', [id]);
      const { rows } = await db.query('DELETE FROM buses WHERE id = $1 RETURNING id', [id]);
      if (!rows[0]) throw new HttpError(404, 'Bus not found');
      await audit(db, { actorId: req.auth.userId, action: 'BUS_DELETED', entity: 'bus', entityId: id });
      res.json({ deleted: id });
    } catch (err) {
      fkError(err, 'This bus');
    }
  });

  // ---- Drivers --------------------------------------------------------------

  r.get('/drivers', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.phone, u.status, u.bus_id, b.fleet_code, r.code AS route_code, r.name AS route_name,
              (SELECT max(started_at) FROM trips t WHERE t.driver_id = u.id) AS last_trip,
              (SELECT count(*)::int FROM trips t WHERE t.driver_id = u.id AND t.status <> 'scheduled') AS trips_total,
              (SELECT count(*)::int FROM trips t WHERE t.driver_id = u.id AND t.status = 'completed') AS trips_completed,
              EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = u.id AND t.status = 'active') AS on_trip
         FROM users u LEFT JOIN buses b ON b.id = u.bus_id LEFT JOIN routes r ON r.id = b.route_id
        WHERE u.role = 'driver' ORDER BY u.username`,
    );
    res.json(rows);
  });

  const assignBus = async (driverId, fleetCode) => {
    const busId = await busIdByCode(fleetCode);
    if (busId) {
      const other = await db.query(`SELECT username FROM users WHERE bus_id = $1 AND role = 'driver' AND id <> $2`, [busId, driverId ?? 0]);
      if (other.rows[0]) throw new HttpError(409, `${fleetCode} is already assigned to ${other.rows[0].username}`);
    }
    return busId;
  };

  r.post('/drivers', async (req, res) => {
    const b = req.body ?? {};
    const username = str(b.username, 30)?.toLowerCase();
    if (!username || !/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'username: 3-30 letters or digits');
    if (!str(b.fullName)) throw new HttpError(400, 'fullName is required');
    if (typeof b.password !== 'string' || b.password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    const busId = b.fleetCode ? await assignBus(null, b.fleetCode) : null;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, full_name, role, phone, bus_id) VALUES ($1, $2, $3, 'driver', $4, $5)
         RETURNING id, username, full_name`,
        [username, await hashPassword(b.password), str(b.fullName, 100), str(b.phone, 20) ?? null, busId],
      );
      await audit(db, { actorId: req.auth.userId, action: 'DRIVER_CREATED', entity: 'user', entityId: rows[0].id });
      res.status(201).json(rows[0]);
    } catch (err) {
      fkError(err, 'Driver');
    }
  });

  r.patch('/drivers/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const b = req.body ?? {};
    const fields = {
      full_name: str(b.fullName, 100),
      phone: str(b.phone, 20),
      status: b.status === undefined ? undefined : ['active', 'suspended'].includes(b.status) ? b.status : (() => { throw new HttpError(400, 'status must be active or suspended'); })(),
      bus_id: b.fleetCode === undefined ? undefined : await assignBus(id, b.fleetCode),
      password_hash: b.password === undefined ? undefined : b.password.length >= 8 ? await hashPassword(b.password) : (() => { throw new HttpError(400, 'password must be at least 8 characters'); })(),
    };
    const { sql, values } = setClause(fields);
    const { rows } = await db.query(`UPDATE users SET ${sql} WHERE id = $1 AND role = 'driver' RETURNING id, username`, [id, ...values]);
    if (!rows[0]) throw new HttpError(404, 'Driver not found');
    await audit(db, { actorId: req.auth.userId, action: 'DRIVER_UPDATED', entity: 'user', entityId: id, detail: { ...b, password: b.password ? '***' : undefined } });
    res.json(rows[0]);
  });

  r.delete('/drivers/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    try {
      const { rows } = await db.query(`DELETE FROM users WHERE id = $1 AND role = 'driver' RETURNING id`, [id]);
      if (!rows[0]) throw new HttpError(404, 'Driver not found');
      await audit(db, { actorId: req.auth.userId, action: 'DRIVER_DELETED', entity: 'user', entityId: id });
      res.json({ deleted: id });
    } catch (err) {
      fkError(err, 'This driver');
    }
  });

  // ---- Routes and stops ---------------------------------------------------

  r.get('/routes', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT r.*, (SELECT count(*)::int FROM stops s WHERE s.route_id = r.id) AS stop_count,
              (SELECT string_agg(fleet_code, ', ') FROM buses b WHERE b.route_id = r.id) AS buses,
              (SELECT count(*)::int FROM users u WHERE u.home_route_id = r.id AND u.role = 'student') AS students
         FROM routes r ORDER BY r.id`,
    );
    res.json(rows.map((x) => ({ ...x, segments_learned: tracking.segmentInfo(x.id).learned })));
  });

  const routeFields = (b) => ({
    code: str(b.code, 20),
    name: str(b.name, 100),
    start_point: str(b.startPoint, 100),
    end_point: str(b.endPoint, 100),
    departure_time: str(b.departureTime, 20),
    duration_minutes: b.durationMinutes === undefined ? undefined : Number(b.durationMinutes) || null,
    description: str(b.description, 500),
    active: b.active === undefined ? undefined : Boolean(b.active),
  });

  r.post('/routes', async (req, res) => {
    const f = routeFields(req.body ?? {});
    if (!f.code || !f.name) throw new HttpError(400, 'code and name are required');
    f.start_point ??= f.name;
    f.end_point ??= 'BSACIST';
    const keys = Object.keys(f).filter((k) => f[k] !== undefined);
    try {
      const { rows } = await db.query(
        `INSERT INTO routes (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        keys.map((k) => f[k]),
      );
      await audit(db, { actorId: req.auth.userId, action: 'ROUTE_CREATED', entity: 'route', entityId: rows[0].id });
      res.status(201).json(rows[0]);
    } catch (err) {
      fkError(err, 'Route');
    }
  });

  r.patch('/routes/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const { sql, values } = setClause(routeFields(req.body ?? {}));
    try {
      const { rows } = await db.query(`UPDATE routes SET ${sql} WHERE id = $1 RETURNING *`, [id, ...values]);
      if (!rows[0]) throw new HttpError(404, 'Route not found');
      await audit(db, { actorId: req.auth.userId, action: 'ROUTE_UPDATED', entity: 'route', entityId: id, detail: req.body });
      res.json(rows[0]);
    } catch (err) {
      fkError(err, 'Route');
    }
  });

  r.delete('/routes/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    try {
      const { rows } = await db.query('DELETE FROM routes WHERE id = $1 RETURNING id', [id]);
      if (!rows[0]) throw new HttpError(404, 'Route not found');
      await tracking.reloadStops();
      await audit(db, { actorId: req.auth.userId, action: 'ROUTE_DELETED', entity: 'route', entityId: id });
      res.json({ deleted: id });
    } catch (err) {
      fkError(err, 'This route');
    }
  });

  /** Renumber a route's stops 1..n in the given order (two passes: seq is unique). */
  const resequence = async (tx, routeId, orderedIds) => {
    await tx.query('UPDATE stops SET seq = seq + 100000 WHERE route_id = $1', [routeId]);
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.query('UPDATE stops SET seq = $3 WHERE id = $1 AND route_id = $2', [orderedIds[i], routeId, i + 1]);
    }
  };
  const afterStopChange = async () => {
    await tracking.reloadStops();
    await tracking.refreshSegmentTimes();
  };
  const stopIds = async (tx, routeId) => (await tx.query('SELECT id FROM stops WHERE route_id = $1 ORDER BY seq', [routeId])).rows.map((s) => s.id);
  const coord = (v, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > max) throw new HttpError(400, 'Invalid coordinates');
    return n;
  };

  r.get('/routes/:id/stops', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM stops WHERE route_id = $1 ORDER BY seq', [intParam(req.params.id, 'id')]);
    res.json(rows);
  });

  r.post('/routes/:id/stops', async (req, res) => {
    const routeId = intParam(req.params.id, 'id');
    const b = req.body ?? {};
    if (!str(b.name)) throw new HttpError(400, 'name is required');
    const lat = coord(b.lat, 90);
    const lng = coord(b.lng, 180);
    const stop = await db.transaction(async (tx) => {
      const ids = await stopIds(tx, routeId);
      const { rows } = await tx.query(
        `INSERT INTO stops (route_id, seq, name, lat, lng, scheduled_time, offset_minutes, geo_source)
         VALUES ($1, 200000, $2, $3, $4, $5, $6, 'admin') RETURNING *`,
        [routeId, str(b.name, 100), lat, lng, str(b.scheduledTime, 20) ?? null, Number.isFinite(b.offsetMinutes) ? b.offsetMinutes : null],
      );
      const pos = Number.isInteger(b.position) ? Math.max(0, Math.min(ids.length, b.position - 1)) : ids.length;
      ids.splice(pos, 0, rows[0].id);
      await resequence(tx, routeId, ids);
      return rows[0];
    });
    await afterStopChange();
    await audit(db, { actorId: req.auth.userId, action: 'STOP_CREATED', entity: 'stop', entityId: stop.id });
    res.status(201).json(stop);
  });

  r.patch('/stops/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const b = req.body ?? {};
    const fields = {
      name: str(b.name, 100),
      lat: b.lat === undefined ? undefined : coord(b.lat, 90),
      lng: b.lng === undefined ? undefined : coord(b.lng, 180),
      scheduled_time: str(b.scheduledTime, 20),
      offset_minutes: b.offsetMinutes === undefined ? undefined : Number.isFinite(b.offsetMinutes) ? b.offsetMinutes : null,
      geo_source: b.lat !== undefined || b.lng !== undefined ? 'admin' : undefined,
    };
    const { sql, values } = setClause(fields);
    const { rows } = await db.query(`UPDATE stops SET ${sql} WHERE id = $1 RETURNING *`, [id, ...values]);
    if (!rows[0]) throw new HttpError(404, 'Stop not found');
    await afterStopChange();
    await audit(db, { actorId: req.auth.userId, action: 'STOP_UPDATED', entity: 'stop', entityId: id, detail: b });
    res.json(rows[0]);
  });

  r.delete('/stops/:id', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    try {
      await db.transaction(async (tx) => {
        const { rows } = await tx.query('DELETE FROM stops WHERE id = $1 RETURNING route_id', [id]);
        if (!rows[0]) throw new HttpError(404, 'Stop not found');
        await resequence(tx, rows[0].route_id, await stopIds(tx, rows[0].route_id));
      });
    } catch (err) {
      fkError(err, 'This stop');
    }
    await afterStopChange();
    await audit(db, { actorId: req.auth.userId, action: 'STOP_DELETED', entity: 'stop', entityId: id });
    res.json({ deleted: id });
  });

  r.put('/routes/:id/stops/order', async (req, res) => {
    const routeId = intParam(req.params.id, 'id');
    const order = req.body?.stopIds;
    await db.transaction(async (tx) => {
      const ids = await stopIds(tx, routeId);
      if (!Array.isArray(order) || order.length !== ids.length || [...order].sort((a, b) => a - b).join() !== [...ids].sort((a, b) => a - b).join()) {
        throw new HttpError(400, 'stopIds must list every stop of the route exactly once');
      }
      await resequence(tx, routeId, order);
    });
    await afterStopChange();
    await audit(db, { actorId: req.auth.userId, action: 'STOPS_REORDERED', entity: 'route', entityId: routeId });
    res.json({ ok: true });
  });

  // ---- Trips ---------------------------------------------------------------

  r.get('/trips', async (req, res) => {
    const { status, route, date } = req.query;
    const driver = req.query.driver ? intParam(req.query.driver, 'driver') : null;
    const { rows } = await db.query(
      `SELECT t.id, t.status, t.started_at, t.ended_at, t.scheduled_for, t.flagged, t.flag_reason, t.occupancy, t.started_by,
              r.code AS route_code, r.name AS route_name, b.fleet_code, u.full_name AS driver_name, t.driver_id,
              (SELECT count(*)::int FROM location_pings p WHERE p.trip_id = t.id) AS fixes,
              (SELECT count(*)::int FROM attendance a WHERE a.trip_id = t.id) AS attendance
         FROM trips t
         JOIN routes r ON r.id = t.route_id
         JOIN buses b ON b.id = t.bus_id
         LEFT JOIN users u ON u.id = t.driver_id
        WHERE ($1::text IS NULL OR t.status = $1)
          AND ($2::text IS NULL OR r.code = $2)
          AND ($3::text IS NULL OR (coalesce(t.scheduled_for, t.started_at) AT TIME ZONE $4)::date = $3::date)
          AND ($5::int IS NULL OR t.driver_id = $5)
        ORDER BY coalesce(t.scheduled_for, t.started_at) DESC LIMIT ${driver ? 1000 : 200}`,
      [status || null, route || null, date || null, config.timeZone, driver],
    );
    res.json(rows);
  });

  r.post('/trips', async (req, res) => {
    const busId = await busIdByCode(req.body?.fleetCode);
    if (!busId) throw new HttpError(400, 'fleetCode is required');
    const when = new Date(req.body?.scheduledFor);
    if (Number.isNaN(when.getTime())) throw new HttpError(400, 'scheduledFor must be a date-time');
    const { rows } = await db.query(
      `INSERT INTO trips (bus_id, route_id, driver_id, status, scheduled_for, started_at)
       SELECT b.id, b.route_id, u.id, 'scheduled', $2, $2
         FROM buses b JOIN users u ON u.bus_id = b.id AND u.role = 'driver'
        WHERE b.id = $1 AND b.route_id IS NOT NULL
       RETURNING id`,
      [busId, when],
    );
    if (!rows[0]) throw new HttpError(409, 'The bus needs a route and a driver before a trip can be scheduled');
    await audit(db, { actorId: req.auth.userId, action: 'TRIP_SCHEDULED', entity: 'trip', entityId: rows[0].id });
    res.status(201).json(rows[0]);
  });

  const loadTrip = async (id) => {
    const { rows } = await db.query('SELECT * FROM trips WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Trip not found');
    return rows[0];
  };

  r.post('/trips/:id/start', async (req, res) => {
    const trip = await loadTrip(intParam(req.params.id, 'id'));
    if (trip.status !== 'scheduled') throw new HttpError(409, `Trip is ${trip.status}`);
    try {
      await db.query(`UPDATE trips SET status = 'active', started_at = now(), started_by = 'admin' WHERE id = $1`, [trip.id]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'That bus already has a running trip');
      throw err;
    }
    await audit(db, { actorId: req.auth.userId, action: 'TRIP_STARTED_BY_ADMIN', entity: 'trip', entityId: trip.id });
    res.json({ id: trip.id, status: 'active' });
  });

  r.post('/trips/:id/end', async (req, res) => {
    const trip = await loadTrip(intParam(req.params.id, 'id'));
    const ended = await tracking.endTrip({ busId: trip.bus_id }, trip.id);
    await audit(db, { actorId: req.auth.userId, action: 'TRIP_ENDED_BY_ADMIN', entity: 'trip', entityId: trip.id });
    res.json(ended);
  });

  r.post('/trips/:id/cancel', async (req, res) => {
    const trip = await loadTrip(intParam(req.params.id, 'id'));
    if (trip.status === 'active') await tracking.endTrip({ busId: trip.bus_id }, trip.id, 'cancelled');
    else if (trip.status === 'scheduled') await db.query(`UPDATE trips SET status = 'cancelled' WHERE id = $1`, [trip.id]);
    else throw new HttpError(409, `Trip is ${trip.status}`);
    await audit(db, { actorId: req.auth.userId, action: 'TRIP_CANCELLED', entity: 'trip', entityId: trip.id, reason: str(req.body?.reason) ?? null });
    res.json({ id: trip.id, status: 'cancelled' });
  });

  // ---- Incidents -------------------------------------------------------------

  r.get('/incidents', async (req, res) => {
    const { rows } = await db.query(
      `SELECT i.*, r.code AS route_code, b.fleet_code, u.username
         FROM incidents i LEFT JOIN routes r ON r.id = i.route_id LEFT JOIN buses b ON b.id = i.bus_id
         LEFT JOIN users u ON u.id = i.user_id
        WHERE ($1::text IS NULL OR i.status = $1)
        ORDER BY (i.kind IN ('SOS', 'EMERGENCY')) DESC, i.created_at DESC LIMIT 200`,
      [req.query.status || null],
    );
    res.json(rows);
  });

  r.post('/incidents/:id/resolve', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const { rows } = await db.query(
      `UPDATE incidents SET status = 'RESOLVED', resolution = $2, resolved_by = $3, resolved_at = now()
        WHERE id = $1 AND status = 'OPEN' RETURNING *`,
      [id, str(req.body?.resolution, 500) || 'Resolved', req.auth.userId],
    );
    if (!rows[0]) throw new HttpError(404, 'No open incident with that id');
    io.to('admins').emit('incident', rows[0]);
    res.json(rows[0]);
  });

  // ---- Students and attendance review ---------------------------------------

  r.get('/students', async (req, res) => {
    const today = localDate(new Date(), config.timeZone);
    const q = str(req.query.q, 50);
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.register_no, u.department, u.status, u.location_consent,
              u.phone, u.email, u.home_stop_seq, r.name AS route_name,
              r.code AS route_code, s.name AS home_stop, d.platform AS device, d.mock_location_flag,
              EXISTS (SELECT 1 FROM subscriptions x WHERE x.user_id = u.id AND x.status = 'ACTIVE'
                        AND x.valid_from <= $1::date AND x.valid_to >= $1::date - $2::int) AS subscribed
         FROM users u
         LEFT JOIN routes r ON r.id = u.home_route_id
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
         LEFT JOIN devices d ON d.user_id = u.id
        WHERE u.role = 'student' AND ($3::text IS NULL OR u.username ILIKE '%' || $3 || '%' OR u.full_name ILIKE '%' || $3 || '%'
                                       OR u.register_no ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR r.code = $4)
        ORDER BY ${req.query.route ? 'u.home_stop_seq NULLS LAST, u.full_name' : 'u.username'} LIMIT 500`,
      [today, config.subscription.graceDays, q || null, str(req.query.route, 20) || null],
    );
    res.json(rows);
  });

  /**
   * One student's attendance, day by day. A day counts when the student's own
   * route ran a trip, or when the student was recorded on any bus: Present
   * (a present record), Pending (only provisional or disputed records) or
   * Absent (the route ran and nothing was recorded).
   */
  r.get('/students/:id/attendance', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const tz = config.timeZone;
    const { from, to } = reports.range(req.query);
    const st = (await db.query(
      `SELECT u.id, u.username, u.full_name, u.register_no, u.department, u.phone, u.email, u.home_route_id,
              r.code AS route_code, r.name AS route_name, s.name AS home_stop
         FROM users u LEFT JOIN routes r ON r.id = u.home_route_id
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE u.id = $1 AND u.role = 'student'`,
      [id],
    )).rows[0];
    if (!st) throw new HttpError(404, 'Student not found');
    const [records, routeDays] = await Promise.all([
      db.query(
        `SELECT a.attendance_id, a.trip_id, a.status, a.method, a.flagged, a.flag_reason, a.auto_confirmed,
                ${PRESENT_SQL} AS present,
                to_char(coalesce(a.boarded_at, t.started_at) AT TIME ZONE $2, 'YYYY-MM-DD') AS date,
                a.boarded_at, a.alighted_at, bs.name AS boarding_stop, als.name AS alighting_stop,
                r.code AS route_code, r.name AS route_name, b.fleet_code
           FROM attendance a
           JOIN trips t ON t.id = a.trip_id
           JOIN routes r ON r.id = t.route_id
           JOIN buses b ON b.id = a.bus_id
           LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
           LEFT JOIN stops als ON als.id = a.alighting_stop_id
          WHERE a.user_id = $1 AND (coalesce(a.boarded_at, t.started_at) AT TIME ZONE $2)::date BETWEEN $3 AND $4
          ORDER BY coalesce(a.boarded_at, t.started_at) DESC`,
        [id, tz, from, to],
      ),
      st.home_route_id ? db.query(
        `SELECT to_char(t.started_at AT TIME ZONE $2, 'YYYY-MM-DD') AS date, count(*)::int AS trips
           FROM trips t
          WHERE t.route_id = $1 AND t.status IN ('active', 'completed')
            AND (t.started_at AT TIME ZONE $2)::date BETWEEN $3 AND $4
          GROUP BY 1`,
        [st.home_route_id, tz, from, to],
      ) : { rows: [] },
    ]);
    const days = new Map(routeDays.rows.map((d) => [d.date, { date: d.date, routeTrips: d.trips, records: [] }]));
    for (const rec of records.rows) {
      if (!days.has(rec.date)) days.set(rec.date, { date: rec.date, routeTrips: 0, records: [] });
      days.get(rec.date).records.push(rec);
    }
    const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).map((d) => ({
      ...d,
      status: d.records.some((x) => x.present) ? 'PRESENT'
        : d.records.some((x) => ['PROVISIONAL', 'DISPUTED', 'PROMPTED'].includes(x.status)) ? 'PENDING' : 'ABSENT',
    }));
    const count = (k) => list.filter((d) => d.status === k).length;
    const decided = count('PRESENT') + count('ABSENT');
    res.json({
      student: st,
      from,
      to,
      summary: {
        days: list.length,
        present: count('PRESENT'),
        absent: count('ABSENT'),
        pending: count('PENDING'),
        trips: records.rows.filter((x) => x.present).length,
        attendancePct: decided ? Math.round((count('PRESENT') / decided) * 100) : null,
        lastBoardedAt: records.rows.find((x) => x.present)?.boarded_at ?? null,
      },
      days: list,
    });
  });

  /** The dashboard's overview: fleet totals, a day-by-day series, boarding methods, busiest routes and recent activity. */
  r.get('/overview', async (req, res) => {
    const tz = config.timeZone;
    const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
    const today = localDate(new Date(), tz);
    const [totals, series, methods, routes, activity] = await Promise.all([
      db.query(
        `SELECT (SELECT count(*)::int FROM buses) AS buses,
                (SELECT count(*)::int FROM buses WHERE status = 'active') AS buses_active,
                (SELECT count(*)::int FROM users WHERE role = 'driver' AND status = 'active') AS drivers,
                (SELECT count(*)::int FROM users WHERE role = 'student' AND status = 'active') AS students,
                (SELECT count(*)::int FROM routes WHERE active) AS routes,
                (SELECT count(DISTINCT user_id)::int FROM subscriptions
                  WHERE status = 'ACTIVE' AND valid_from <= $1::date AND valid_to >= $1::date) AS subscribers,
                (SELECT count(*)::int FROM trips WHERE status IN ('active', 'completed')
                  AND (started_at AT TIME ZONE $2)::date = $1::date) AS trips_today,
                (SELECT count(*)::int FROM trips WHERE status = 'scheduled'
                  AND (scheduled_for AT TIME ZONE $2)::date = $1::date) AS scheduled_today`,
        [today, tz],
      ),
      db.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                (SELECT count(*)::int FROM trips t WHERE t.status IN ('active', 'completed')
                  AND (t.started_at AT TIME ZONE $2)::date = d) AS trips,
                (SELECT count(*)::int FROM attendance a WHERE ${PRESENT_SQL}
                  AND (a.boarded_at AT TIME ZONE $2)::date = d) AS present
           FROM (SELECT ($1::date - g)::date AS d FROM generate_series(0, $3::int - 1) AS g) days
          ORDER BY d`,
        [today, tz, days],
      ),
      db.query(
        `SELECT a.method, count(*)::int AS n FROM attendance a
          WHERE ${PRESENT_SQL} AND (a.boarded_at AT TIME ZONE $2)::date > $1::date - $3::int
          GROUP BY a.method ORDER BY n DESC`,
        [today, tz, days],
      ),
      db.query(
        `SELECT r.code, r.name, count(*)::int AS riders FROM attendance a
           JOIN trips t ON t.id = a.trip_id JOIN routes r ON r.id = t.route_id
          WHERE ${PRESENT_SQL} AND (a.boarded_at AT TIME ZONE $2)::date > $1::date - $3::int
          GROUP BY r.code, r.name ORDER BY riders DESC LIMIT 6`,
        [today, tz, days],
      ),
      db.query(
        `SELECT * FROM (
           SELECT 'trip_started' AS kind, t.started_at AS at, r.code AS route_code, b.fleet_code, u.full_name AS who, NULL AS detail
             FROM trips t JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = t.bus_id LEFT JOIN users u ON u.id = t.driver_id
            WHERE t.status IN ('active', 'completed')
           UNION ALL
           SELECT 'trip_ended', t.ended_at, r.code, b.fleet_code, u.full_name, NULL
             FROM trips t JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = t.bus_id LEFT JOIN users u ON u.id = t.driver_id
            WHERE t.ended_at IS NOT NULL
           UNION ALL
           SELECT 'incident', i.created_at, r.code, b.fleet_code, i.kind, i.message
             FROM incidents i LEFT JOIN routes r ON r.id = i.route_id LEFT JOIN buses b ON b.id = i.bus_id
         ) x WHERE at IS NOT NULL ORDER BY at DESC LIMIT 12`,
      ),
    ]);
    res.json({ totals: totals.rows[0], series: series.rows, methods: methods.rows, routes: routes.rows, activity: activity.rows });
  });

  r.delete('/students/:id/device', async (req, res) => {
    const id = intParam(req.params.id, 'id');
    await db.query('DELETE FROM devices WHERE user_id = $1', [id]);
    await db.query('DELETE FROM device_otps WHERE user_id = $1', [id]);
    await audit(db, { actorId: req.auth.userId, action: 'DEVICE_UNBOUND', entity: 'user', entityId: id, reason: str(req.body?.reason) ?? null });
    res.json({ unbound: id });
  });

  r.get('/attendance/review', async (_req, res) => res.json(await attendance.reviewQueue()));

  r.post('/attendance/:id/resolve', async (req, res) => {
    res.json(await attendance.resolve(req.auth, intParam(req.params.id, 'id'), req.body ?? {}, req.ip));
  });

  r.get('/audit', async (_req, res) => {
    // The transport admin sees operations, not money (least privilege, doc 4.4).
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.created_at, u.username AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity IS NULL OR a.entity NOT IN ('payment', 'subscription', 'webhook')
        ORDER BY a.created_at DESC LIMIT 200`,
    );
    res.json(rows);
  });

  r.post('/jobs/:name', async (req, res) => {
    const name = req.params.name;
    if (!['tick', 'nightly', 'expire'].includes(name)) throw new HttpError(404, 'Unknown job');
    res.json(await jobs.run(name));
  });

  return r;
}
