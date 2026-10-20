import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { parseWindows } from '../shared/colocation.js';
import { AttendanceService } from './attendance.js';
import { BoardingCheckService } from './boarding.js';
import { changePassword, HttpError, loadProfile, login, registerStudent, requireRole, verifyToken } from './auth.js';
import { cacheFor } from './cache.js';
import { createGateway } from './billing/gateway.js';
import { TrackerService } from './gps/trackers.js';
import { receiptPdf } from './billing/pdf.js';
import { BillingService } from './billing/service.js';
import { localMonth } from './clock.js';
import { JobRunner } from './jobs.js';
import { PushService } from './push.js';
import { ReportService } from './reports.js';
import { adminRouter } from './routes/admin.js';
import { financeRouter } from './routes/finance.js';
import { TrackingService } from './tracking.js';
import { audit, intParam, rateLimit, sendTable } from './util.js';

const INCIDENT_TO_NOTICE = { BREAKDOWN: 'BREAKDOWN', DELAY: 'DELAY', EMERGENCY: 'EMERGENCY' };
// Incidents urgent enough to push to the transport office's phones.
const PUSH_INCIDENTS = new Set(['SOS', 'EMERGENCY', 'BREAKDOWN']);

/** Build the HTTP server, REST API and Socket.IO layer around an open database. */
export async function createServer(db, config) {
  const app = express();
  const httpServer = http.createServer(app);
  // Keep idle connections open longer than a hosting proxy does (Render and
  // most load balancers use 60 s), so phones polling every few seconds reuse
  // one connection instead of a new TCP + TLS handshake each time.
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  const cache = cacheFor(db);
  // Reference data (routes, stops, timetable) changes only when the
  // administrator edits it; any such write refreshes these at once.
  const REFERENCE_TTL = 5 * 60000;
  const routeIdByCode = async (code) => cache.get(`routeId:${code}`, ['routes'], REFERENCE_TTL, async () => (
    (await db.query('SELECT id FROM routes WHERE code = $1', [code])).rows[0]?.id ?? null
  ));
  const io = new SocketServer(httpServer, { cors: { origin: '*' } });

  // The evening run leaves campus at one time for every route (timetable circular).
  const eveningDeparture = (() => {
    try { return JSON.parse(fs.readFileSync(config.datasetPath, 'utf8')).evening_departure ?? null; } catch { return null; }
  })();

  const tracking = new TrackingService(db, config, io);
  await tracking.init();
  const trackers = new TrackerService(db, config, tracking);
  const gateway = createGateway(db, config.payment);
  const billing = new BillingService(db, config, gateway, io);
  const push = new PushService(db, config, billing);
  const attendance = new AttendanceService(db, config, tracking, billing, io, push);
  const boarding = new BoardingCheckService(db, config, { tracking, attendance, io, push });
  const reports = new ReportService(db, config, tracking);
  const jobs = new JobRunner(db, config, { attendance, billing, boarding });

  // The test gateway calls our webhook over HTTP, like the real one.
  httpServer.on('listening', () => {
    if (gateway.mode === 'mock') gateway.webhookUrl = `http://127.0.0.1:${httpServer.address().port}/api/webhooks/payment`;
  });

  const role = (...roles) => requireRole(config, db, ...roles);
  const anyUser = role('admin', 'driver', 'student', 'finance');
  const driverOnly = role('driver');
  const adminOnly = role('admin');
  const financeOnly = role('finance');
  const student = role('student');
  // Live positions, ETA and alerts: staff who operate the buses, and students
  // (paying ones, when subscriptions are required for students). The finance
  // officer has no access to live locations (doc 4.4).
  const liveViewer = role('admin', 'driver', 'student');
  const entitled = billing.requireSubscription();

  // Behind a hosting proxy (Render, Nginx) req.ip must be the caller's address,
  // or every user shares one rate-limit bucket and the webhook allow-list fails.
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // Browser hardening headers. No Content-Security-Policy: the maps (Google /
  // OpenStreetMap tiles), Razorpay checkout and web fonts load from other origins.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    // Personal data (profiles, payments, attendance) must not sit in shared caches.
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  // Raw bytes are kept for the webhook: its signature covers the exact body.
  app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  async function broadcastNotification({ kind, title, message, routeId = null, tripId = null, createdBy = null }) {
    const { rows } = await db.query(
      `INSERT INTO notifications (kind, title, message, route_id, trip_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, title, message, route_id, created_at`,
      [kind, title, message, routeId, tripId, createdBy],
    );
    const code = routeId ? (await db.query('SELECT code FROM routes WHERE id = $1', [routeId])).rows[0]?.code : null;
    const n = { ...rows[0], route_code: code };
    if (code) io.to(['all', `route:${code}`, 'admins']).emit('notification', n);
    else io.emit('notification', n);
    // And to subscribed students' phones (the route's, or everyone's), app open or not.
    push.toSubscribers(routeId, { title, body: message, data: { type: 'notification', id: n.id, routeCode: code } });
    return n;
  }

  async function reportIncident(auth, body, source) {
    const kinds = source === 'driver'
      ? ['BREAKDOWN', 'DELAY', 'EMERGENCY', 'SOS']
      : ['MISSING_BUS', 'DELAY', 'SOS', 'LOST_AND_FOUND', 'OTHER'];
    const kind = String(body?.kind ?? '');
    if (!kinds.includes(kind)) throw new HttpError(400, `kind must be one of ${kinds.join(', ')}`);
    const message = body.message ? String(body.message).slice(0, 1000) : null;
    let tripId = null;
    let busId = null;
    let routeId = null;
    if (source === 'driver') {
      const trip = await tracking.activeTrip(auth.busId);
      busId = auth.busId;
      tripId = trip?.id ?? null;
      routeId = trip?.route_id ?? (await db.query('SELECT route_id FROM buses WHERE id = $1', [auth.busId])).rows[0]?.route_id ?? null;
    } else if (body.routeCode) {
      routeId = (await db.query('SELECT id FROM routes WHERE code = $1', [String(body.routeCode)])).rows[0]?.id ?? null;
    }
    const lat = Number.isFinite(body.lat) ? body.lat : null;
    const lng = Number.isFinite(body.lng) ? body.lng : null;
    const { rows } = await db.query(
      `INSERT INTO incidents (kind, source, message, route_id, bus_id, trip_id, user_id, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [kind, source, message, routeId, busId, tripId, auth.userId, lat, lng],
    );
    io.to('admins').emit('incident', rows[0]);
    // An SOS or emergency reaches the transport office's phones straight away.
    if (PUSH_INCIDENTS.has(kind)) {
      push.toRole('admin', {
        title: `${kind === 'SOS' ? 'SOS' : kind.charAt(0) + kind.slice(1).toLowerCase()} reported`,
        body: message ?? `A ${source} reported ${kind === 'SOS' ? 'an SOS' : `a ${kind.toLowerCase()}`}.`,
        data: { type: 'incident', id: rows[0].id, kind },
      });
    }
    // A driver's breakdown, delay or emergency is also an alert to the route.
    if (source === 'driver' && INCIDENT_TO_NOTICE[kind] && routeId) {
      const bus = (await db.query('SELECT fleet_code FROM buses WHERE id = $1', [busId])).rows[0];
      await broadcastNotification({
        kind: INCIDENT_TO_NOTICE[kind],
        title: `${bus?.fleet_code ?? 'Bus'}: ${kind.toLowerCase()}`,
        message: message ?? `The driver reported a ${kind.toLowerCase()}.`,
        routeId,
        tripId,
        createdBy: auth.userId,
      });
    }
    return rows[0];
  }

  // ---- Health and reference data (public, read-only) --------------------

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, database: db.kind, liveBuses: tracking.latest.size, paymentGateway: gateway.mode });
  });

  app.get('/api/routes', async (_req, res) => {
    res.json(await cache.get('routes', ['routes', 'buses', 'stops'], REFERENCE_TTL, async () => (await db.query(
      `SELECT r.code, r.name, r.start_point, r.end_point, r.departure_time, r.duration_minutes,
              min(b.fleet_code) AS fleet_code, min(b.bus_type) AS bus_type, max(b.capacity) AS capacity,
              (SELECT count(*)::int FROM stops s WHERE s.route_id = r.id) AS stop_count
         FROM routes r
         LEFT JOIN buses b ON b.route_id = r.id
        WHERE r.active
        GROUP BY r.id
        ORDER BY r.id`,
    )).rows));
  });

  app.get('/api/routes/:code', async (req, res) => {
    const detail = await cache.get(`route:${req.params.code}`, ['routes', 'buses', 'stops'], REFERENCE_TTL, async () => {
      const { rows } = await db.query(
        `SELECT r.id, r.code, r.name, r.start_point, r.end_point, r.departure_time, r.duration_minutes, r.description,
                b.fleet_code, b.bus_type, b.capacity, b.is_ac
           FROM routes r LEFT JOIN buses b ON b.route_id = r.id
          WHERE r.code = $1 ORDER BY b.id LIMIT 1`,
        [req.params.code],
      );
      if (!rows[0]) return null;
      const stops = await db.query(
        `SELECT id, seq, name, lat, lng, scheduled_time, offset_minutes, geo_source
           FROM stops WHERE route_id = $1 ORDER BY seq`,
        [rows[0].id],
      );
      return { ...rows[0], stops: stops.rows };
    });
    if (!detail) throw new HttpError(404, 'Route not found');
    // Learned segment times change as trips finish: read live, not cached.
    const seg = tracking.segmentInfo(detail.id);
    const { id, stops, ...route } = detail;
    res.json({ ...route, evening_departure: eveningDeparture, stops, segmentMinutes: seg.minutes, segmentsLearned: seg.learned });
  });

  /** Doc 6.3 name: stops of a route by numeric id. */
  app.get('/api/routes/:routeId/stops', async (req, res) => {
    const routeId = intParam(req.params.routeId, 'routeId');
    res.json(await cache.get(`stops:${routeId}`, ['stops'], REFERENCE_TTL, async () => (
      await db.query('SELECT id, seq, name, lat, lng, scheduled_time FROM stops WHERE route_id = $1 ORDER BY seq', [routeId])
    ).rows));
  });

  /** Free view (doc 8.4): notice board and emergency contacts. */
  app.get('/api/notices', async (_req, res) => {
    res.json(await cache.get('notices', ['notifications'], 30000, async () => (await db.query(
      `SELECT id, kind, title, message, created_at FROM notifications
        WHERE route_id IS NULL ORDER BY created_at DESC LIMIT 20`,
    )).rows));
  });
  app.get('/api/contacts', (_req, res) => res.json(config.emergencyContacts));
  app.get('/api/plans', async (_req, res) => res.json(await billing.plans()));

  /** Pipeline counters: accepted fixes and rejections by reason. */
  app.get('/api/stats', async (_req, res) => {
    const [accepted, rejected, trips] = await Promise.all([
      db.query('SELECT count(*)::int AS n FROM location_pings'),
      db.query('SELECT reason, count(*)::int AS n FROM rejected_pings GROUP BY reason ORDER BY n DESC'),
      db.query(`SELECT status, count(*)::int AS n FROM trips GROUP BY status`),
    ]);
    res.json({
      acceptedFixes: accepted.rows[0].n,
      rejectedFixes: rejected.rows.reduce((sum, r) => sum + r.n, 0),
      rejectedByReason: Object.fromEntries(rejected.rows.map((r) => [r.reason, r.n])),
      trips: Object.fromEntries(trips.rows.map((r) => [r.status, r.n])),
    });
  });

  // ---- Authentication and profile ----------------------------------------

  const loginLimit = rateLimit({ windowMs: 60000, max: config.rateLimits.login, key: (req) => `${req.ip}:${String(req.body?.username ?? '').toLowerCase()}`, message: 'Too many sign-in attempts; wait a minute' });
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    res.json(await login(db, config, req.body?.username, req.body?.password));
  });
  app.post('/api/auth/register', rateLimit({ windowMs: 60000, max: config.rateLimits.register }), async (req, res) => {
    res.status(201).json(await registerStudent(db, config, req.body ?? {}));
  });
  app.post('/api/auth/logout', anyUser, (_req, res) => res.json({ ok: true })); // tokens are stateless

  /** Every role changes its own password; other signed-in devices are signed out. */
  const passwordLimit = rateLimit({ windowMs: 60000, max: config.rateLimits.passwordChange ?? 5, key: (req) => `pwd:${req.auth.userId}`, message: 'Too many attempts; wait a minute' });
  app.post('/api/auth/change-password', anyUser, passwordLimit, async (req, res) => {
    const result = await changePassword(db, config, req.auth.userId, req.body ?? {});
    await audit(db, { actorId: req.auth.userId, action: 'PASSWORD_CHANGED', entity: 'user', entityId: req.auth.userId, ip: req.ip });
    res.json(result);
  });

  app.get('/api/me', anyUser, async (req, res) => {
    const profile = await loadProfile(db, req.auth.userId);
    const out = { user: profile };
    if (profile.role === 'student') out.entitlement = await billing.access(req.auth.userId);
    res.json(out);
  });

  /** The phone's Expo push token, sent after sign-in (server/push.js). */
  app.post('/api/push/register', anyUser, async (req, res) => {
    const token = req.body?.token;
    if (!push.isToken(token)) throw new HttpError(400, 'token must be an Expo push token');
    const platform = ['android', 'ios'].includes(req.body?.platform) ? req.body.platform : null;
    await push.register(req.auth.userId, token, platform);
    res.json({ ok: true });
  });
  /** Sign-out: this phone stops receiving the account's notifications. */
  app.post('/api/push/unregister', anyUser, async (req, res) => {
    if (push.isToken(req.body?.token)) await push.unregister(req.auth.userId, req.body.token);
    res.json({ ok: true });
  });

  /** Student settings: saved stop, travel window, language, boarding reminders, location consent (doc 9.11). */
  app.patch('/api/me', student, async (req, res) => {
    const b = req.body ?? {};
    const sets = [];
    const vals = [req.auth.userId];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.homeRouteCode !== undefined) {
      const r = b.homeRouteCode ? (await db.query('SELECT id FROM routes WHERE code = $1', [String(b.homeRouteCode)])).rows[0] : null;
      if (b.homeRouteCode && !r) throw new HttpError(400, 'Unknown route');
      add('home_route_id', r?.id ?? null);
    }
    if (b.homeStopSeq !== undefined) add('home_stop_seq', Number.isInteger(b.homeStopSeq) ? b.homeStopSeq : null);
    if (b.travelWindows !== undefined) {
      if (b.travelWindows && !parseWindows(b.travelWindows)) throw new HttpError(400, 'Travel windows look like 07:00-09:00,16:00-18:00');
      add('travel_windows', b.travelWindows || null);
    }
    if (b.language !== undefined) {
      if (!['en', 'ta'].includes(b.language)) throw new HttpError(400, 'language must be en or ta');
      add('language', b.language);
    }
    if (b.boardingReminders !== undefined) {
      if (typeof b.boardingReminders !== 'boolean') throw new HttpError(400, 'boardingReminders must be true or false');
      add('boarding_reminders', b.boardingReminders);
    }
    if (b.locationConsent !== undefined) {
      add('location_consent', Boolean(b.locationConsent));
      add('consent_at', new Date());
      await audit(db, { actorId: req.auth.userId, action: b.locationConsent ? 'LOCATION_CONSENT_GIVEN' : 'LOCATION_CONSENT_WITHDRAWN', entity: 'user', entityId: req.auth.userId });
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
    res.json({ user: await loadProfile(db, req.auth.userId) });
  });

  /** Problem reporting and SOS stay free for everyone signed in (doc 8.4). */
  app.post('/api/problems', anyUser, async (req, res) => {
    res.status(201).json(await reportIncident(req.auth, req.body, 'student'));
  });

  // ---- Live location, ETA and alerts (subscribers and staff) --------------

  /** Latest position of every bus on an active trip, with its freshness state. */
  const liveList = (req, res) => {
    const code = req.query.route;
    res.json(tracking.liveSnapshot().filter((b) => !code || b.routeCode === code));
  };
  app.get('/api/live', liveViewer, entitled, liveList);
  app.get('/api/buses/active', liveViewer, entitled, liveList);
  app.get('/api/buses/:busId/location', liveViewer, entitled, (req, res) => {
    const snap = tracking.liveSnapshot().find((b) => b.busId === Number(req.params.busId));
    if (!snap) throw new HttpError(404, 'That bus is not on a trip');
    res.json(snap);
  });

  /** Estimated arrival at one stop for every live bus on the route (doc 7). */
  app.get('/api/eta', liveViewer, entitled, async (req, res) => {
    const routeId = await routeIdByCode(String(req.query.route ?? ''));
    if (!routeId) throw new HttpError(404, 'Route not found');
    const seq = Number(req.query.stop);
    if (!Number.isInteger(seq)) throw new HttpError(400, 'stop must be a stop sequence number');
    res.json(tracking.etaFor(routeId, seq));
  });

  /** Alerts for the routes a student travels on, plus network-wide notices. */
  app.get('/api/notifications', liveViewer, entitled, async (req, res) => {
    let routeId = null;
    if (req.auth.role === 'student') {
      routeId = await cache.get(`homeRoute:${req.auth.userId}`, ['users'], 30000, async () => (
        (await db.query('SELECT home_route_id FROM users WHERE id = $1', [req.auth.userId])).rows[0]?.home_route_id ?? null
      ));
    }
    if (req.auth.role === 'driver') {
      routeId = await cache.get(`busRoute:${req.auth.busId}`, ['buses'], REFERENCE_TTL, async () => (
        (await db.query('SELECT route_id FROM buses WHERE id = $1', [req.auth.busId])).rows[0]?.route_id ?? null
      ));
    }
    // Everyone on a route sees the same list: one query per route, not per student.
    const admin = req.auth.role === 'admin';
    res.json(await cache.get(`alerts:${admin ? 'all' : routeId ?? 'none'}`, ['notifications', 'routes'], 15000, async () => (await db.query(
      `SELECT n.id, n.kind, n.title, n.message, n.created_at, r.code AS route_code
         FROM notifications n LEFT JOIN routes r ON r.id = n.route_id
        WHERE n.created_at > now() - interval '14 days'
          AND ($1 OR n.route_id IS NULL OR n.route_id = $2)
        ORDER BY n.created_at DESC LIMIT 50`,
      [admin, routeId ?? null],
    )).rows));
  });

  /** Stored fixes of one trip, oldest first (trip replay). History is for administrators (doc 14.7). */
  const tripPath = async (req, res) => {
    const { rows } = await db.query(
      `SELECT lat, lng, speed_kmh, heading, recorded_at FROM location_pings
        WHERE trip_id = $1 ORDER BY recorded_at`,
      [intParam(req.params.id, 'id')],
    );
    res.json(rows);
  };
  app.get('/api/trips/:id/path', adminOnly, tripPath);
  app.get('/api/trips/:id/history', adminOnly, tripPath);

  // ---- Driver app (JWT, role = driver) -----------------------------------

  app.get('/api/driver/trip', driverOnly, async (req, res) => {
    res.json({ trip: await tracking.activeTrip(req.auth.busId) });
  });

  const startTrip = async (req, res) => {
    const result = await tracking.startTrip(req.auth);
    res.status(result.resumed ? 200 : 201).json(result);
  };
  app.post('/api/driver/trips', driverOnly, startTrip);
  app.post('/api/trips/start', driverOnly, startTrip);

  app.post('/api/driver/trips/:id/end', driverOnly, async (req, res) => {
    res.json({ trip: await tracking.endTrip(req.auth, Number(req.params.id)) });
  });
  app.post('/api/trips/end', driverOnly, async (req, res) => {
    res.json({ trip: await tracking.endTrip(req.auth, Number(req.body?.tripId)) });
  });

  const ingest = async (req, res) => {
    const result = await tracking.ingest(req.auth, req.body);
    // 202 when at least one fix was taken, 422 when every fix was rejected,
    // 200 when the bus's GPS tracker is reporting and this phone stands by.
    res.status(result.standby ? 200 : result.accepted > 0 ? 202 : 422).json(result);
  };
  app.post('/api/driver/locations', driverOnly, ingest);
  app.post('/api/buses/:busId/location', driverOnly, async (req, res) => {
    // The driver is authorised for this bus only (doc 6.7).
    if (Number(req.params.busId) !== req.auth.busId) throw new HttpError(403, 'You are not assigned to this bus');
    await ingest(req, res);
  });

  app.post('/api/driver/incidents', driverOnly, async (req, res) => {
    res.status(201).json(await reportIncident(req.auth, req.body, 'driver'));
  });
  app.post('/api/driver/occupancy', driverOnly, async (req, res) => {
    res.json(await tracking.setOccupancy(req.auth, req.body?.occupancy));
  });
  /**
   * The bus GPS tracker is the driver app's main location source: is one fitted,
   * is it reporting, and where is the bus. The phone's GPS is only a backup.
   */
  app.get('/api/driver/bus-gps', driverOnly, async (req, res) => {
    const busId = req.auth.busId;
    if (!busId) throw new HttpError(400, 'This driver has no bus assigned');
    const { rows } = await db.query(
      `SELECT t.*, b.fleet_code, r.code AS route_code, r.name AS route_name
         FROM bus_trackers t JOIN buses b ON b.id = t.bus_id LEFT JOIN routes r ON r.id = b.route_id
        WHERE t.bus_id = $1`,
      [busId],
    );
    const tracker = rows[0] ? trackers.view(rows[0]) : null;
    const live = tracking.liveSnapshot().find((b) => b.busId === busId) ?? null;
    res.json({
      tracker: tracker && {
        uniqueId: tracker.uniqueId,
        label: tracker.label,
        active: tracker.active,
        online: tracker.online,
        lastSeenAt: tracker.lastSeenAt,
        lastFix: tracker.lastFix,
      },
      reporting: tracking.trackerActive(busId),
      position: live,
    });
  });

  /** The students who travel on this bus (its route), with their stop, pass and today's boarding. */
  app.get('/api/driver/students', driverOnly, async (req, res) => {
    const busId = req.auth.busId;
    if (!busId) throw new HttpError(400, 'This driver has no bus assigned');
    const bus = (await db.query('SELECT route_id FROM buses WHERE id = $1', [busId])).rows[0];
    if (!bus?.route_id) return res.json({ students: [] });
    const trip = await tracking.activeTrip(busId);
    const today = billing.today();
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.register_no, u.department, u.phone, u.email,
              u.home_stop_seq, s.name AS stop_name, s.scheduled_time AS stop_time,
              EXISTS (SELECT 1 FROM subscriptions sub
                       WHERE sub.user_id = u.id AND sub.status = 'ACTIVE'
                         AND sub.valid_from <= $2 AND sub.valid_to >= $2) AS pass_active,
              a.status AS attendance_status, a.method AS attendance_method, a.boarded_at, a.alighted_at
         FROM users u
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
         LEFT JOIN LATERAL (SELECT status, method, boarded_at, alighted_at FROM attendance
                             WHERE trip_id = $3 AND user_id = u.id ORDER BY boarded_at DESC NULLS LAST LIMIT 1) a ON TRUE
        WHERE u.role = 'student' AND u.status = 'active' AND u.home_route_id = $1
        ORDER BY u.home_stop_seq NULLS LAST, u.full_name`,
      [bus.route_id, today, trip?.id ?? null],
    );
    res.json({
      tripId: trip?.id ?? null,
      students: rows.map((r) => ({
        id: r.id,
        username: r.username,
        fullName: r.full_name,
        registerNo: r.register_no,
        department: r.department,
        phone: r.phone,
        email: r.email,
        stopSeq: r.home_stop_seq,
        stopName: r.stop_name,
        stopTime: r.stop_time,
        passActive: r.pass_active,
        attendance: r.attendance_status ? { status: r.attendance_status, method: r.attendance_method, boardedAt: r.boarded_at, alightedAt: r.alighted_at } : null,
      })),
    });
  });

  app.get('/api/driver/boarding-code', driverOnly, async (req, res) => {
    res.json(await attendance.driverBoardingCode(req.auth));
  });

  /** The driver's boarded list, or the admin's register for one trip. */
  app.get('/api/trips/:tripId/attendance', role('driver', 'admin'), async (req, res) => {
    res.json(await attendance.tripAttendance(req.auth, intParam(req.params.tripId, 'tripId')));
  });
  app.post('/api/attendance/manual', role('driver', 'admin'), async (req, res) => {
    res.status(201).json(await attendance.manual(req.auth, req.body ?? {}, req.ip));
  });

  // ---- GPS trackers fitted in the buses (server/gps) --------------------------

  // OsmAnd protocol (Traccar Client, trackers with an HTTP mode). The key can
  // be part of the URL for senders that only let you type a server address.
  app.all(['/api/gps/osmand', '/api/gps/osmand/:key'], trackers.limiter(), express.urlencoded({ extended: false, limit: '20kb' }), trackers.osmand);
  // Positions forwarded by a Traccar server or a vendor platform.
  app.post('/api/gps/webhook', rateLimit({ windowMs: 60000, max: 6000, message: 'Webhook rate limit' }), trackers.webhook);

  // ---- Subscription and payment (doc 8.7) ------------------------------------

  app.get('/api/subscriptions/me', student, async (req, res) => {
    res.json({
      entitlement: await billing.entitlement(req.auth.userId),
      plans: await billing.plans(),
      gateway: gateway.mode,
      graceDays: config.subscription.graceDays,
      refundWindowDays: config.subscription.refundWindowDays,
    });
  });

  app.post('/api/subscriptions/order', student, rateLimit({ windowMs: 60000, max: config.rateLimits.orders, key: (req) => `order:${req.auth.userId}` }), async (req, res) => {
    res.status(201).json(await billing.createOrder(req.auth.userId, req.body?.planCode, req.get('idempotency-key')));
  });

  app.get('/api/payments/me', student, async (req, res) => res.json(await billing.myPayments(req.auth.userId)));

  app.get('/api/payments/:paymentId/receipt', role('student', 'finance'), async (req, res) => {
    const data = await billing.receiptData(intParam(req.params.paymentId, 'paymentId'), req.auth);
    res.set('content-type', 'application/pdf');
    res.set('content-disposition', `attachment; filename="${data.receiptNo}.pdf"`);
    res.send(receiptPdf(data));
  });

  /** The only request from outside the university's control: verified before it is believed. */
  const webhookLimit = rateLimit({ windowMs: 60000, max: config.rateLimits.webhook, message: 'Webhook rate limit' });
  app.post('/api/webhooks/payment', webhookLimit, async (req, res) => {
    const ip = (req.ip ?? '').replace(/^::ffff:/, '');
    const allowed = config.payment.webhookAllowedIps;
    if (allowed.length && !allowed.includes(ip)) {
      await audit(db, { action: 'SECURITY_WEBHOOK_SOURCE_REFUSED', entity: 'webhook', ip });
      throw new HttpError(403, 'Source address not allowed');
    }
    res.json(await billing.handleWebhook(req.rawBody, req.get('x-razorpay-signature'), ip));
  });

  // Payment endpoints for the finance officer, including the doc 8.7 refund path.
  app.post('/api/admin/subscriptions/:id/refund', financeOnly, async (req, res) => {
    res.json(await billing.refundBySubscription(intParam(req.params.id, 'id'), req.auth, req.body?.reason, req.ip));
  });
  app.get('/api/reports/collections', financeOnly, async (req, res) => {
    res.json(await billing.collections(req.query.month ?? localMonth(new Date(), config.timeZone)));
  });

  // The built-in test gateway's hosted checkout (test mode only).
  if (gateway.mode === 'mock') {
    app.get('/api/mock-gateway/orders/:orderId', async (req, res) => {
      const order = await gateway.getOrder(req.params.orderId);
      if (!order) throw new HttpError(404, 'Unknown order');
      res.json({ id: order.id, amount: order.amount_paise, currency: 'INR', status: order.status, merchant: config.payment.merchantName });
    });
    app.post('/api/mock-gateway/orders/:orderId/pay', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      const { method = 'upi', outcome = 'success', webhook = 'deliver' } = req.body ?? {};
      if (!['upi', 'card', 'netbanking'].includes(method)) throw new HttpError(400, 'method must be upi, card or netbanking');
      if (!['success', 'failure'].includes(outcome)) throw new HttpError(400, 'outcome must be success or failure');
      if (!['deliver', 'drop', 'twice'].includes(webhook)) throw new HttpError(400, 'webhook must be deliver, drop or twice');
      try {
        res.json(await gateway.pay(req.params.orderId, { method, outcome, webhook }));
      } catch (err) {
        throw new HttpError(409, err.message);
      }
    });
  }

  // ---- Devices and attendance (doc 9.13) --------------------------------------

  app.post('/api/devices/bind', student, rateLimit({ windowMs: 60000, max: 10, key: (req) => `bind:${req.auth.userId}` }), async (req, res) => {
    res.json(await attendance.bindDevice(req.auth, req.body ?? {}, req.ip));
  });

  app.get('/api/attendance/plan', student, async (req, res) => res.json(await attendance.samplingPlan(req.auth.userId)));

  const fixLimit = rateLimit({ windowMs: 60000, max: config.rateLimits.deviceFixes, key: (req) => `fix:${req.auth.userId}`, message: 'Location sent too often' });
  app.post('/api/attendance/device-location', student, entitled, fixLimit, async (req, res) => {
    res.json(await attendance.handleDeviceFix(req.auth, req.body ?? {}));
  });

  app.post('/api/attendance/qr', student, async (req, res) => {
    res.status(201).json(await attendance.qrCheckIn(req.auth, req.body ?? {}));
  });

  // Answering is allowed even if the subscription lapsed mid-trip (doc 11.2).
  app.post('/api/attendance/:id/confirm', student, async (req, res) => {
    res.json(await attendance.confirm(req.auth, intParam(req.params.id, 'id'), req.body?.answer));
  });

  app.get('/api/attendance/pending', student, async (req, res) => res.json(await attendance.pending(req.auth.userId)));

  app.get('/api/attendance/me', student, entitled, async (req, res) => {
    res.json(await attendance.myRecord(req.auth.userId, req.query.month ?? localMonth(new Date(), config.timeZone)));
  });

  // "Did you board?" from the bus GPS (server/boarding.js). No subscription
  // check: like the attendance prompt, it can always be answered.
  app.get('/api/boarding-checks/pending', student, async (req, res) => res.json(await boarding.pending(req.auth.userId)));
  app.post('/api/boarding-checks/:id/answer', student, async (req, res) => {
    res.json(await boarding.answer(req.auth, intParam(req.params.id, 'id'), req.body?.answer));
  });

  app.post('/api/attendance/:id/dispute', student, async (req, res) => {
    res.status(201).json(await attendance.dispute(req.auth, intParam(req.params.id, 'id'), req.body ?? {}));
  });

  // ---- Reports (transport admin: movement and attendance) ------------------------

  app.get('/api/reports/attendance', adminOnly, async (req, res) => {
    sendTable(req, res, await reports.attendanceRegister(req.query), `attendance-${req.query.group ?? 'register'}`);
  });
  app.get('/api/reports/demand', adminOnly, async (req, res) => sendTable(req, res, await reports.demand(req.query), 'stop-demand'));
  app.get('/api/reports/occupancy', adminOnly, async (req, res) => sendTable(req, res, await reports.occupancy(req.query), 'occupancy'));
  app.get('/api/reports/leakage', adminOnly, async (req, res) => sendTable(req, res, await reports.leakage(req.query), 'subscriber-vs-traveller'));
  app.get('/api/reports/exceptions', adminOnly, async (req, res) => res.json(await reports.exceptions(req.query)));
  app.get('/api/reports/eta-accuracy', adminOnly, async (req, res) => res.json(await reports.etaAccuracy(req.query)));
  app.post('/api/reports/attendance-accuracy', adminOnly, async (req, res) => res.json(await reports.attendanceAccuracy(req.body?.csv)));

  /** Announcements: network-wide, or to one route (doc 4.1). */
  const postNotification = async (req, res) => {
    const b = req.body ?? {};
    const title = String(b.title ?? '').trim().slice(0, 150);
    const message = String(b.message ?? '').trim().slice(0, 2000);
    if (!title || !message) throw new HttpError(400, 'title and message are required');
    const kind = b.kind ?? 'ANNOUNCEMENT';
    if (!['ANNOUNCEMENT', 'ROUTE_CHANGE', 'DELAY', 'BREAKDOWN', 'EMERGENCY'].includes(kind)) throw new HttpError(400, 'Unknown kind');
    let routeId = null;
    if (b.routeCode) {
      routeId = (await db.query('SELECT id FROM routes WHERE code = $1', [String(b.routeCode)])).rows[0]?.id;
      if (!routeId) throw new HttpError(400, 'Unknown route');
    }
    res.status(201).json(await broadcastNotification({ kind, title, message, routeId, createdBy: req.auth.userId }));
  };
  app.post('/api/notifications', adminOnly, postNotification);
  app.post('/api/admin/notifications', adminOnly, postNotification);

  app.use('/api/admin/trackers', adminOnly, trackers.router());
  app.use('/api/admin', adminOnly, adminRouter({ db, config, tracking, attendance, reports, jobs, io }));
  app.use('/api/finance', financeOnly, financeRouter({ db, config, billing, gateway, jobs }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API endpoint')));

  // ---- React build (production) ------------------------------------------

  if (fs.existsSync(config.clientDist)) {
    // Vite fingerprints everything in assets/ (index-Dil6IWEn.js): safe to
    // cache for a year, so a returning phone loads the app from its cache.
    // index.html itself is always revalidated so a new build shows up.
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(config.clientDist, { setHeaders: (res, file) => { if (file.endsWith('.html')) res.set('Cache-Control', 'no-cache'); } }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  // ---- Errors --------------------------------------------------------------

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body is not valid JSON' });
    const status = err.status ?? 500;
    // A deliberate HttpError (e.g. 503 "busy, try again") keeps its message;
    // anything unexpected is logged and hidden behind a generic one.
    const deliberate = err instanceof HttpError;
    if (!deliberate && status >= 500) console.error(err);
    if (deliberate && err.extra?.retryAfterS) res.set('Retry-After', String(err.extra.retryAfterS));
    const expose = deliberate || status < 500;
    res.status(status).json({ error: expose ? err.message : 'Internal server error', ...(expose ? err.extra : {}) });
  });

  // ---- Realtime ------------------------------------------------------------

  // A token in the handshake identifies the user; without one the socket only
  // receives network-wide notices (the free view).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    socket.data.auth = token ? verifyToken(config, token) : null;
    next();
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (auth) socket.join(`user:${auth.userId}`);
    if (auth?.role === 'admin') socket.join('admins');

    // A client watches every bus ('all') or one route ('route:118').
    socket.on('subscribe', async ({ route } = {}) => {
      for (const room of socket.rooms) if (room.startsWith('route:') || room === 'all') socket.leave(room);
      if (!auth || auth.role === 'finance') {
        return socket.emit('live:denied', { code: auth ? 'ROLE_NOT_ALLOWED' : 'LOGIN_REQUIRED' });
      }
      if (auth.role === 'student') {
        const ent = await billing.access(auth.userId);
        if (!ent.active) return socket.emit('live:denied', { code: 'SUBSCRIPTION_REQUIRED' });
      }
      socket.join(route ? `route:${route}` : 'all');
      socket.emit('snapshot', tracking.liveSnapshot().filter((b) => !route || b.routeCode === route));
    });
  });

  tracking.startFreshnessTicker();
  if (config.backgroundJobs) {
    jobs.start();
    trackers.start(); // ends trips the trackers started once the bus is done
  }
  // TCP listeners for GT06 / Teltonika trackers, if GPS_*_PORT is set.
  const trackerListeners = await trackers.listenConfigured();

  const stop = () => {
    tracking.stop();
    jobs.stop();
    trackers.stop();
  };

  return { app, httpServer, io, tracking, billing, attendance, boarding, reports, jobs, gateway, trackers, trackerListeners, stop };
}
