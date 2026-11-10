// Student services and the transport office's service desk: trip feedback and
// complaints, route-change requests, lost and found, the driver's pre-trip
// check, parent links and the digital bus pass.
import { CHECKLIST_ITEMS, CHECKLIST_TEXT, FEEDBACK_TAGS } from '../../shared/service.js';
import { HttpError } from '../auth.js';
import { PRESENT_SQL } from '../attendance.js';
import { localDate } from '../clock.js';
import { audit, intParam, rateLimit } from '../util.js';

const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const TAGS = new Set(FEEDBACK_TAGS.map(([k]) => k));

export function mountServices(app, { db, config, tracking, guardians, pass, calendar, fleetCare, reports, io, push, role, anyUser, student, driverOnly, adminOnly }) {
  const linkLimit = rateLimit({ windowMs: 60000, max: config.rateLimits.register, message: 'Too many attempts; wait a minute' });

  // ---- Parents ---------------------------------------------------------------------

  app.post('/api/guardians/code', student, async (req, res) => res.status(201).json(await guardians.createCode(req.auth.userId)));
  app.get('/api/guardians', student, async (req, res) => res.json(await guardians.parentsOf(req.auth.userId)));
  app.delete('/api/guardians/:parentId', student, async (req, res) => {
    res.json(await guardians.unlink(req.auth.userId, intParam(req.params.parentId, 'parentId')));
  });
  app.post('/api/parent/link', role('parent'), linkLimit, async (req, res) => res.status(201).json(await guardians.link(req.auth.userId, req.body?.code)));
  app.get('/api/parent/children', role('parent'), async (req, res) => res.json(await guardians.children(req.auth.userId)));
  app.get('/api/parent/alerts', role('parent'), async (req, res) => res.json(await guardians.alertsFor(req.auth.userId)));

  // ---- Holidays and special days ---------------------------------------------------------

  app.get('/api/calendar', async (_req, res) => res.json({ today: await calendar.today(), upcoming: await calendar.upcoming() }));
  app.post('/api/admin/calendar', adminOnly, async (req, res) => {
    const day = await calendar.save(req.body, req.auth.userId);
    await audit(db, { actorId: req.auth.userId, action: 'SPECIAL_DAY_SAVED', entity: 'special_day', entityId: null, reason: `${day.day} ${day.title}` });
    res.status(201).json(day);
  });
  app.delete('/api/admin/calendar/:day', adminOnly, async (req, res) => res.json(await calendar.remove(String(req.params.day))));

  // ---- Bus care: documents, service, fuel, scorecards, stops ------------------------------------

  app.get('/api/admin/fleet-care', adminOnly, async (_req, res) => res.json(await fleetCare.overview()));
  app.put('/api/admin/buses/:id/documents/:kind', adminOnly, async (req, res) => res.json(await fleetCare.setDocument(intParam(req.params.id, 'id'), req.params.kind, req.body)));
  app.put('/api/admin/buses/:id/service', adminOnly, async (req, res) => res.json(await fleetCare.setService(intParam(req.params.id, 'id'), req.body)));
  app.post('/api/fuel', role('driver', 'admin'), async (req, res) => res.status(201).json(await fleetCare.addFuel(req.auth, req.body)));
  app.get('/api/admin/fuel', adminOnly, async (req, res) => res.json({ report: await fleetCare.fuelReport(reports.range(req.query)), logs: await fleetCare.fuelLogs() }));
  app.get('/api/admin/scorecards', adminOnly, async (req, res) => res.json(await fleetCare.scorecards(req.query.days)));
  app.get('/api/admin/stop-suggestions', adminOnly, async (req, res) => res.json(await fleetCare.stopSuggestions(req.query.days)));

  // ---- Digital bus pass ----------------------------------------------------------------

  app.get('/api/pass', student, async (req, res) => res.json(await pass.issue(req.auth.userId)));
  app.put('/api/pass/photo', student, async (req, res) => res.json(await pass.setPhoto(req.auth.userId, req.body?.photo ?? null)));
  app.get('/api/me/photo', anyUser, async (req, res) => res.json(await pass.getPhoto(req.auth.userId)));
  app.put('/api/me/photo', anyUser, async (req, res) => res.json(await pass.setPhoto(req.auth.userId, req.body?.photo ?? null)));
  app.post('/api/driver/pass-scan', driverOnly, async (req, res) => res.json(await pass.scan(req.auth, req.body?.code)));

  // ---- Trip feedback and complaints ------------------------------------------------------

  app.post('/api/feedback', student, async (req, res) => {
    const b = req.body ?? {};
    const tripId = intParam(String(b.tripId ?? ''), 'tripId');
    const rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be 1 to 5');
    const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map(String))] : [];
    if (tags.some((t) => !TAGS.has(t))) throw new HttpError(400, 'Unknown feedback tag');
    const comment = text(b.comment, 500);
    const complaint = Boolean(b.complaint);
    if (complaint && !comment && !tags.length) throw new HttpError(400, 'Say what went wrong so the transport office can act on it');
    const { rows: rec } = await db.query(
      `SELECT a.bus_id, t.route_id, t.started_at FROM attendance a JOIN trips t ON t.id = a.trip_id
        WHERE a.user_id = $1 AND a.trip_id = $2 AND ${PRESENT_SQL}`,
      [req.auth.userId, tripId],
    );
    if (!rec[0]) throw new HttpError(403, 'You can rate only the trips you travelled on');
    if (Date.now() - new Date(rec[0].started_at).getTime() > config.service.feedbackDays * 86400000) {
      throw new HttpError(409, `Trips can be rated for ${config.service.feedbackDays} days`);
    }
    const { rows } = await db.query(
      `INSERT INTO trip_feedback (user_id, trip_id, bus_id, route_id, rating, tags, comment, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, trip_id) DO NOTHING RETURNING *`,
      [req.auth.userId, tripId, rec[0].bus_id, rec[0].route_id, rating, JSON.stringify(tags), comment, complaint ? 'OPEN' : 'NOTED'],
    );
    if (!rows[0]) throw new HttpError(409, 'You have already rated this trip');
    if (complaint) io?.to('admins').emit('feedback', { id: rows[0].id });
    res.status(201).json(rows[0]);
  });

  app.get('/api/feedback/me', student, async (req, res) => {
    const { rows } = await db.query(
      `SELECT f.id, f.trip_id, f.rating, f.tags, f.comment, f.status, f.response, f.created_at, f.responded_at,
              b.fleet_code, r.code AS route_code
         FROM trip_feedback f JOIN buses b ON b.id = f.bus_id JOIN routes r ON r.id = f.route_id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
      [req.auth.userId],
    );
    res.json(rows);
  });

  app.get('/api/admin/feedback', adminOnly, async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const { rows } = await db.query(
      `SELECT f.*, u.full_name, u.register_no, b.fleet_code, r.code AS route_code, t.direction, t.started_at
         FROM trip_feedback f
         JOIN users u ON u.id = f.user_id
         JOIN buses b ON b.id = f.bus_id
         JOIN routes r ON r.id = f.route_id
         JOIN trips t ON t.id = f.trip_id
        WHERE ($1::text IS NULL OR f.status = $1)
        ORDER BY (f.status = 'OPEN') DESC, f.created_at DESC LIMIT 200`,
      [status],
    );
    res.json(rows);
  });

  app.post('/api/admin/feedback/:id/respond', adminOnly, async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const response = text(req.body?.response, 500);
    if (!response || response.length < 3) throw new HttpError(400, 'Write a reply to the student');
    const { rows } = await db.query(
      `UPDATE trip_feedback SET status = 'RESOLVED', response = $2, responded_by = $3, responded_at = now()
        WHERE id = $1 RETURNING user_id`,
      [id, response, req.auth.userId],
    );
    if (!rows[0]) throw new HttpError(404, 'Feedback not found');
    await audit(db, { actorId: req.auth.userId, action: 'FEEDBACK_RESOLVED', entity: 'trip_feedback', entityId: id });
    push?.toUser(rows[0].user_id, { title: 'The transport office replied', body: response, data: { type: 'feedback', id } });
    res.json({ ok: true });
  });

  /** The dashboard's service quality: the last 30 days. */
  app.get('/api/admin/service-quality', adminOnly, async (_req, res) => {
    const [summary, tags, pending] = await Promise.all([
      db.query(
        `SELECT round(avg(rating)::numeric, 1)::float AS rating, count(*)::int AS ratings,
                count(*) FILTER (WHERE status = 'OPEN')::int AS open_complaints
           FROM trip_feedback WHERE created_at > now() - interval '30 days'`,
      ),
      db.query(
        `SELECT tag, count(*)::int AS n FROM trip_feedback f, jsonb_array_elements_text(f.tags) tag
          WHERE f.created_at > now() - interval '30 days' GROUP BY tag ORDER BY n DESC LIMIT 5`,
      ),
      db.query(
        `SELECT (SELECT count(*)::int FROM route_requests WHERE status = 'PENDING') AS route_requests,
                (SELECT count(*)::int FROM lost_items WHERE status = 'OPEN') AS lost_items`,
      ),
    ]);
    res.json({ ...summary.rows[0], topTags: tags.rows, ...pending.rows[0] });
  });

  // ---- Route-change requests ------------------------------------------------------------

  app.post('/api/route-requests', student, async (req, res) => {
    const b = req.body ?? {};
    const route = (await db.query('SELECT id FROM routes WHERE code = $1 AND active', [String(b.routeCode ?? '')])).rows[0];
    if (!route) throw new HttpError(400, 'Choose a route');
    const stopSeq = Number(b.stopSeq);
    const stops = (await db.query('SELECT seq FROM stops WHERE route_id = $1 ORDER BY seq', [route.id])).rows.map((s) => s.seq);
    if (!stops.includes(stopSeq) || stopSeq === stops.at(-1)) throw new HttpError(400, 'Choose a stop on that route');
    const me = (await db.query('SELECT home_route_id, home_stop_seq FROM users WHERE id = $1', [req.auth.userId])).rows[0];
    if (me.home_route_id === route.id && me.home_stop_seq === stopSeq) throw new HttpError(400, 'That is already your route and stop');
    try {
      const { rows } = await db.query(
        `INSERT INTO route_requests (user_id, from_route_id, from_stop_seq, to_route_id, to_stop_seq, reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.auth.userId, me.home_route_id, me.home_stop_seq, route.id, stopSeq, text(b.reason, 300)],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'You already have a request waiting. Cancel it to make a new one.');
      throw err;
    }
  });

  const REQUEST_SELECT = `
    SELECT q.*, tr.code AS to_route_code, tr.name AS to_route_name, ts.name AS to_stop_name,
           fr.code AS from_route_code, fs.name AS from_stop_name
      FROM route_requests q
      JOIN routes tr ON tr.id = q.to_route_id
      LEFT JOIN stops ts ON ts.route_id = q.to_route_id AND ts.seq = q.to_stop_seq
      LEFT JOIN routes fr ON fr.id = q.from_route_id
      LEFT JOIN stops fs ON fs.route_id = q.from_route_id AND fs.seq = q.from_stop_seq`;

  app.get('/api/route-requests/me', student, async (req, res) => {
    res.json((await db.query(`${REQUEST_SELECT} WHERE q.user_id = $1 ORDER BY q.created_at DESC LIMIT 20`, [req.auth.userId])).rows);
  });

  app.delete('/api/route-requests/:id', student, async (req, res) => {
    const { rows } = await db.query(
      `UPDATE route_requests SET status = 'CANCELLED', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'PENDING' RETURNING id`,
      [intParam(req.params.id, 'id'), req.auth.userId],
    );
    if (!rows[0]) throw new HttpError(404, 'No waiting request with that id');
    res.json({ ok: true });
  });

  /** Seats on a route against the students who have it as their home route. */
  const routeLoad = async (routeId) => (await db.query(
    `SELECT (SELECT coalesce(sum(capacity), 0)::int FROM buses WHERE route_id = $1 AND status = 'active') AS seats,
            (SELECT count(*)::int FROM users WHERE role = 'student' AND status = 'active' AND home_route_id = $1) AS students`,
    [routeId],
  )).rows[0];

  app.get('/api/admin/route-requests', adminOnly, async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const { rows } = await db.query(
      `SELECT x.*, u.full_name, u.register_no FROM (${REQUEST_SELECT} WHERE ($1::text IS NULL OR q.status = $1)) x
         JOIN users u ON u.id = x.user_id ORDER BY (x.status = 'PENDING') DESC, x.created_at DESC LIMIT 200`,
      [status],
    );
    res.json(await Promise.all(rows.map(async (r) => {
      const load = await routeLoad(r.to_route_id);
      return { ...r, ...load, full: load.seats > 0 && load.students >= load.seats };
    })));
  });

  app.post('/api/admin/route-requests/:id/decide', adminOnly, async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const { decision, note, override } = req.body ?? {};
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw new HttpError(400, "decision must be 'APPROVE' or 'REJECT'");
    const q = (await db.query(`SELECT * FROM route_requests WHERE id = $1 AND status = 'PENDING'`, [id])).rows[0];
    if (!q) throw new HttpError(404, 'No waiting request with that id');
    if (decision === 'REJECT' && !text(note, 300)) throw new HttpError(400, 'Give the student a reason');
    if (decision === 'APPROVE') {
      const load = await routeLoad(q.to_route_id);
      if (load.seats > 0 && load.students >= load.seats && !override) {
        throw new HttpError(409, `That route is full: ${load.students} students for ${load.seats} seats`, { code: 'ROUTE_FULL', ...load });
      }
    }
    await db.transaction(async (tx) => {
      await tx.query(
        'UPDATE route_requests SET status = $2, admin_note = $3, decided_by = $4, decided_at = now() WHERE id = $1',
        [id, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', text(note, 300), req.auth.userId],
      );
      if (decision === 'APPROVE') await tx.query('UPDATE users SET home_route_id = $2, home_stop_seq = $3 WHERE id = $1', [q.user_id, q.to_route_id, q.to_stop_seq]);
    });
    await audit(db, { actorId: req.auth.userId, action: `ROUTE_REQUEST_${decision}D`, entity: 'route_request', entityId: id, reason: text(note, 300) });
    push?.toUser(q.user_id, {
      title: decision === 'APPROVE' ? 'Your route change is approved' : 'Your route change was not approved',
      body: text(note, 300) ?? 'Your new route and stop are saved.',
      data: { type: 'route-request', id },
    });
    res.json({ ok: true });
  });

  // ---- Lost and found ------------------------------------------------------------------------

  const busOfRoute = async (routeId) => (await db.query('SELECT id FROM buses WHERE route_id = $1 ORDER BY id LIMIT 1', [routeId])).rows[0]?.id ?? null;

  app.get('/api/lost-items', role('student', 'driver', 'admin'), async (req, res) => {
    const status = req.query.status === 'all' ? null : String(req.query.status ?? 'OPEN');
    const staff = req.auth.role === 'admin';
    const { rows } = await db.query(
      `SELECT l.id, l.kind, l.title, l.description, l.status, l.created_at, l.reported_by, b.fleet_code, r.code AS route_code, r.name AS route_name
              ${staff ? ', u.full_name AS reporter, u.role AS reporter_role, u.email AS reporter_email, u.phone AS reporter_phone' : ''}
         FROM lost_items l
         LEFT JOIN buses b ON b.id = l.bus_id
         LEFT JOIN routes r ON r.id = b.route_id
         LEFT JOIN users u ON u.id = l.reported_by
        WHERE ($1::text IS NULL OR l.status = $1) AND ($2::text IS NULL OR r.code = $2)
        ORDER BY l.created_at DESC LIMIT 200`,
      [status, req.query.route ? String(req.query.route) : null],
    );
    res.json(rows.map(({ reported_by: by, ...r }) => ({ ...r, mine: by === req.auth.userId })));
  });

  app.post('/api/lost-items', role('student', 'driver', 'admin'), async (req, res) => {
    const b = req.body ?? {};
    const kind = req.auth.role === 'driver' ? 'FOUND' : String(b.kind ?? '');
    if (kind !== 'LOST' && kind !== 'FOUND') throw new HttpError(400, "kind must be 'LOST' or 'FOUND'");
    const title = text(b.title, 80);
    if (!title || title.length < 3) throw new HttpError(400, 'Say what the item is');
    let busId = null;
    if (req.auth.role === 'driver') busId = req.auth.busId;
    else if (b.fleetCode) {
      busId = (await db.query('SELECT id FROM buses WHERE fleet_code = $1', [String(b.fleetCode)])).rows[0]?.id ?? null;
      if (!busId) throw new HttpError(400, 'Unknown bus');
    } else if (req.auth.role === 'student') {
      const me = (await db.query('SELECT home_route_id FROM users WHERE id = $1', [req.auth.userId])).rows[0];
      if (me.home_route_id) busId = await busOfRoute(me.home_route_id);
    }
    const { rows } = await db.query(
      'INSERT INTO lost_items (kind, bus_id, title, description, reported_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [kind, busId, title, text(b.description, 400), req.auth.userId],
    );
    res.status(201).json(rows[0]);
  });

  app.post('/api/lost-items/:id/status', role('student', 'driver', 'admin'), async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const status = String(req.body?.status ?? '');
    if (status !== 'RETURNED' && status !== 'CLOSED') throw new HttpError(400, "status must be 'RETURNED' or 'CLOSED'");
    const item = (await db.query('SELECT * FROM lost_items WHERE id = $1', [id])).rows[0];
    if (!item) throw new HttpError(404, 'Item not found');
    const allowed = req.auth.role === 'admin' || item.reported_by === req.auth.userId || (req.auth.role === 'driver' && item.bus_id === req.auth.busId);
    if (!allowed) throw new HttpError(403, 'Only the person who reported it or the transport office can close this');
    await db.query('UPDATE lost_items SET status = $2, closed_by = $3, closed_at = now() WHERE id = $1', [id, status, req.auth.userId]);
    res.json({ ok: true });
  });

  // ---- The driver's pre-trip check ---------------------------------------------------------------

  const todayDate = () => localDate(new Date(), config.timeZone);

  app.get('/api/driver/checklist', driverOnly, async (req, res) => {
    const direction = tracking.defaultDirection();
    const row = req.auth.busId ? (await db.query(
      'SELECT * FROM bus_checklists WHERE bus_id = $1 AND day = $2 AND direction = $3',
      [req.auth.busId, todayDate(), direction],
    )).rows[0] : null;
    res.json({ direction, done: row ?? null });
  });

  app.post('/api/driver/checklist', driverOnly, async (req, res) => {
    if (!req.auth.busId) throw new HttpError(400, 'This driver has no bus assigned');
    const b = req.body ?? {};
    const results = b.results ?? {};
    if (CHECKLIST_ITEMS.some(([k]) => typeof results[k] !== 'boolean')) throw new HttpError(400, 'Answer every item on the check');
    const clean = Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, results[k]]));
    const failed = CHECKLIST_ITEMS.filter(([k]) => !results[k]).map(([k]) => k);
    const direction = ['UP', 'DOWN'].includes(b.direction) ? b.direction : tracking.defaultDirection();
    const note = text(b.note, 300);
    const { rows } = await db.query(
      `INSERT INTO bus_checklists (bus_id, driver_id, day, direction, results, failed, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id, day, direction) DO UPDATE SET driver_id = EXCLUDED.driver_id, results = EXCLUDED.results,
         failed = EXCLUDED.failed, note = EXCLUDED.note, created_at = now()
       RETURNING *`,
      [req.auth.busId, req.auth.userId, todayDate(), direction, JSON.stringify(clean), failed.length, note],
    );
    if (failed.length) {
      const bus = (await db.query('SELECT fleet_code, route_id FROM buses WHERE id = $1', [req.auth.busId])).rows[0];
      const list = failed.map((k) => CHECKLIST_TEXT[k]).join(', ');
      const message = `${bus.fleet_code} pre-trip check failed: ${list}.${note ? ` ${note}` : ''}`;
      const inc = await db.query(
        `INSERT INTO incidents (kind, source, message, route_id, bus_id, user_id) VALUES ('VEHICLE_CHECK', 'driver', $1, $2, $3, $4) RETURNING *`,
        [message, bus.route_id, req.auth.busId, req.auth.userId],
      );
      io?.to('admins').emit('incident', inc.rows[0]);
      push?.toRole('admin', { title: 'Pre-trip check failed', body: message, data: { type: 'incident', id: inc.rows[0].id } });
    }
    res.status(201).json(rows[0]);
  });

  app.get('/api/admin/checklists', adminOnly, async (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? req.query.date : todayDate();
    const { rows } = await db.query(
      `SELECT c.*, to_char(c.day, 'YYYY-MM-DD') AS day, b.fleet_code, r.code AS route_code, u.full_name AS driver_name
         FROM bus_checklists c JOIN buses b ON b.id = c.bus_id
         LEFT JOIN routes r ON r.id = b.route_id LEFT JOIN users u ON u.id = c.driver_id
        WHERE c.day = $1 ORDER BY c.failed DESC, b.fleet_code, c.direction DESC`,
      [day],
    );
    res.json({ day, rows });
  });
}
