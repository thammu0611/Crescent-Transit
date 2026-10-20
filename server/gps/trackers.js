// GPS trackers fitted in the buses: registration, sign-in, live status,
// automatic trips, and the HTTP endpoints they post to. Positions go through
// the same pipeline as the driver app (validation, live map, ETA, attendance),
// marked source = 'tracker'. See docs/GPS_TRACKERS.md.
import crypto from 'node:crypto';
import express from 'express';
import { inWindows, parseWindows } from '../../shared/colocation.js';
import { haversineMeters } from '../../shared/geo.js';
import { HttpError } from '../auth.js';
import { cacheFor } from '../cache.js';
import { localMinutes } from '../clock.js';
import { audit, intParam, rateLimit } from '../util.js';
import { parseOsmand, parseWebhook } from './formats.js';
import { createTcpListener } from './tcp.js';

export const PROTOCOLS = ['auto', 'gt06', 'teltonika', 'osmand', 'webhook'];
const UNIQUE_ID_RE = /^[A-Za-z0-9._-]{3,40}$/;
const MAX_BATCH = 200; // TrackingService accepts at most this many fixes per call
const ONLINE_MS = 2 * 60000; // "online" in the admin list: heard from in the last 2 minutes
const LAST_SEEN_WRITE_MS = 10 * 60000;

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const newKey = () => crypto.randomBytes(18).toString('base64url');
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const defined = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v)));

export class TrackerService {
  constructor(db, config, tracking) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
    this.cache = cacheFor(db);
    this.runtime = new Map(); // tracker id -> live status for the admin screen
    this.unknown = new Map(); // unique id -> a tracker that is not registered yet
    this.sockets = new Map(); // tracker id -> Set of open TCP sockets
    this.moving = new Map(); // tracker id -> { since, last }: movement before a trip starts
    this.listeners = [];
    this.timer = null;
    this.startedAt = Date.now();

    this.osmand = this.osmand.bind(this);
    this.webhook = this.webhook.bind(this);
  }

  // ---- Registry -----------------------------------------------------------------

  /** Every registered tracker with its bus, cached; any write to the tables refreshes it. */
  registry() {
    return this.cache.get('trackers', ['bus_trackers', 'buses'], 60000, async () => {
      const { rows } = await this.db.query(
        `SELECT t.id, t.unique_id, t.protocol, t.bus_id, t.label, t.key_hash, t.active,
                b.fleet_code, b.route_id, b.status AS bus_status
           FROM bus_trackers t LEFT JOIN buses b ON b.id = t.bus_id`,
      );
      return { byUniqueId: new Map(rows.map((r) => [r.unique_id, r])), byId: new Map(rows.map((r) => [r.id, r])) };
    });
  }

  async byUniqueId(uniqueId) {
    return (await this.registry()).byUniqueId.get(String(uniqueId)) ?? null;
  }

  keyMatches(tracker, key) {
    return Boolean(key) && sameSecret(tracker.key_hash, hashKey(key));
  }

  // ---- Live status ----------------------------------------------------------------

  status(id) {
    let s = this.runtime.get(id);
    if (!s) {
      s = { protocol: null, remote: null, lastSeenAt: null, lastWrittenAt: 0, lastFix: null, info: {}, received: 0, accepted: 0, rejected: 0, outcome: null, detail: null };
      this.runtime.set(id, s);
    }
    return s;
  }

  /** Anything heard from a tracker: it is alive. Persists "last seen" now and then. */
  seen(tracker, { protocol, remote, info } = {}) {
    const s = this.status(tracker.id);
    s.lastSeenAt = Date.now();
    if (protocol) s.protocol = protocol;
    if (remote) s.remote = remote;
    if (info) Object.assign(s.info, defined(info));
    if (s.lastSeenAt - s.lastWrittenAt > LAST_SEEN_WRITE_MS) {
      s.lastWrittenAt = s.lastSeenAt;
      this.db.query('UPDATE bus_trackers SET last_seen_at = now() WHERE id = $1', [tracker.id]).catch((err) => console.error('[gps]', err.message));
    }
    return s;
  }

  /** A tracker that is not registered tried to send: listed for the administrator to add. */
  noteUnknown(uniqueId, protocol, remote) {
    if (!uniqueId) return;
    const id = String(uniqueId).slice(0, 40);
    const u = this.unknown.get(id) ?? { uniqueId: id, protocol, firstSeenAt: new Date().toISOString(), attempts: 0 };
    u.protocol = protocol;
    u.remote = remote ?? null;
    u.lastSeenAt = new Date().toISOString();
    u.attempts += 1;
    this.unknown.delete(id);
    this.unknown.set(id, u);
    if (this.unknown.size > 100) this.unknown.delete(this.unknown.keys().next().value);
  }

  connected(tracker, socket) {
    if (!this.sockets.has(tracker.id)) this.sockets.set(tracker.id, new Set());
    this.sockets.get(tracker.id).add(socket);
  }

  disconnected(tracker, socket) {
    this.sockets.get(tracker.id)?.delete(socket);
  }

  /** Close a tracker's TCP connections (deleted or switched off): it is refused on reconnect. */
  dropConnections(id) {
    for (const socket of this.sockets.get(id) ?? []) socket.destroy();
    this.sockets.delete(id);
  }

  // ---- Positions ---------------------------------------------------------------------

  /**
   * Positions from one tracker: [{ fix, info }]. Starts a trip when the bus
   * moves (if automatic trips are on), then hands the fixes to the pipeline.
   */
  async receive(trackerRef, items, { protocol, remote } = {}) {
    // Always the current row: the administrator may have moved the tracker to another bus.
    const tracker = (await this.registry()).byId.get(trackerRef.id);
    if (!tracker) return { outcome: 'UNREGISTERED', accepted: 0, rejected: 0 };
    const s = this.seen(tracker, { protocol, remote, info: items.at(-1)?.info });
    s.received += items.length;
    const done = (outcome, detail = null, extra = {}) => {
      s.outcome = outcome;
      s.detail = detail;
      return { outcome, detail, accepted: 0, rejected: 0, ...extra };
    };
    if (!tracker.active) return done('DISABLED', 'Switched off in the admin screen');
    if (!tracker.bus_id) return done('NO_BUS', 'Assign this tracker to a bus');

    const fixes = items
      .filter((i) => i.fix && i.fix.valid !== false && Number.isFinite(i.fix.lat) && Number.isFinite(i.fix.lng))
      .map(({ fix: { valid, ...fix } }) => defined(fix))
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    if (!fixes.length) return done('NO_GPS_FIX', 'Connected, but the tracker has no GPS fix yet (antenna covered, or indoors)');
    s.lastFix = fixes.at(-1);

    let trip = await this.tracking.activeTrip(tracker.bus_id);
    if (!trip) {
      const started = this.config.gps.autoTrips ? await this.maybeStartTrip(tracker, fixes) : { why: 'automatic trips are off (GPS_AUTO_TRIPS=0)' };
      if (!started.trip) return done('WAITING', `No trip running: ${started.why}`);
      trip = started.trip;
    }

    let accepted = 0;
    let rejected = 0;
    let last = null;
    try {
      for (let i = 0; i < fixes.length; i += MAX_BATCH) {
        const r = await this.tracking.ingest({ busId: tracker.bus_id }, { fixes: fixes.slice(i, i + MAX_BATCH) }, { source: 'tracker' });
        accepted += r.accepted;
        rejected += r.rejected;
        last = r.results.findLast((x) => !x.accepted) ?? last;
      }
    } catch (err) {
      if (err.status === 409) return done('WAITING', 'No trip running: it ended while positions were arriving');
      throw err;
    }
    s.accepted += accepted;
    s.rejected += rejected;
    if (accepted) return done('LIVE', null, { accepted, rejected, tripId: trip.id });
    return done('REJECTED', last ? `${last.reason}: ${last.detail}` : null, { accepted, rejected, tripId: trip.id });
  }

  tripWindows() {
    return parseWindows(this.config.gps.tripWindows ?? '') ?? parseWindows(this.config.attendance.travelWindows) ?? [[0, 1440]];
  }

  /**
   * Start a trip when the bus has been moving for a little while, inside the
   * trip hours, and not straight after its last trip. Returns { trip } or { why }.
   */
  async maybeStartTrip(tracker, fixes) {
    const g = this.config.gps;
    let m = this.moving.get(tracker.id) ?? { since: null, last: null };
    for (const fix of fixes) {
      const t = Date.parse(fix.recordedAt);
      let speed = fix.speedKmh;
      if (speed === undefined && m.last && t > m.last.t) speed = (haversineMeters(m.last, fix) / ((t - m.last.t) / 1000)) * 3.6;
      if (speed >= g.autoStartSpeedKmh) m.since ??= t;
      else m.since = null;
      m.last = { lat: fix.lat, lng: fix.lng, t };
    }
    this.moving.set(tracker.id, m);
    if (m.since === null) return { why: 'the bus is not moving' };
    if (m.last.t - m.since < g.autoStartAfterS * 1000) return { why: 'the bus has only just started moving' };

    const { rows } = await this.db.query(
      `SELECT b.route_id, b.status,
              (SELECT id FROM users WHERE bus_id = b.id AND role = 'driver' AND status = 'active' ORDER BY id LIMIT 1) AS driver_id,
              (SELECT max(ended_at) FROM trips WHERE bus_id = b.id) AS last_ended
         FROM buses b WHERE b.id = $1`,
      [tracker.bus_id],
    );
    const bus = rows[0];
    if (!bus?.route_id) return { why: 'the bus has no route' };
    if (bus.status !== 'active') return { why: `the bus is marked ${bus.status}` };
    if (!inWindows(localMinutes(new Date(), this.config.timeZone), this.tripWindows())) {
      return { why: `outside the trip hours (${g.tripWindows ?? this.config.attendance.travelWindows})` };
    }
    if (bus.last_ended && Date.now() - new Date(bus.last_ended).getTime() < g.autoStartCooldownMin * 60000) {
      return { why: `its last trip ended less than ${g.autoStartCooldownMin} min ago` };
    }
    const { trip, resumed } = await this.tracking.startTrip({ userId: bus.driver_id, busId: tracker.bus_id }, { startedBy: 'tracker' });
    this.moving.delete(tracker.id);
    if (!resumed) await audit(this.db, { action: 'TRIP_STARTED_BY_TRACKER', entity: 'trip', entityId: trip.id, detail: { tracker: tracker.unique_id, bus: tracker.fleet_code } });
    return { trip };
  }

  /**
   * End trips the tracker started once the bus is clearly done: parked near
   * the first or last stop, parked anywhere for long, silent, or parked after
   * the trip hours. Trips a driver or administrator started are theirs to end.
   */
  async checkTrips(now = Date.now()) {
    const g = this.config.gps;
    const { rows } = await this.db.query(`SELECT id, bus_id, route_id, started_at FROM trips WHERE status = 'active' AND started_by = 'tracker'`);
    const ended = [];
    for (const trip of rows) {
      const started = new Date(trip.started_at).getTime();
      const lastFix = this.tracking.lastTrackerFixAt.get(trip.bus_id) ?? Math.max(started, this.startedAt);
      const movedAt = this.tracking.motion.get(trip.bus_id)?.movedAt ?? started;
      const silentMin = (now - lastFix) / 60000;
      const parkedMin = (now - movedAt) / 60000;
      const snap = this.tracking.latest.get(trip.bus_id);
      const stops = this.tracking.stopsByRoute.get(trip.route_id) ?? [];
      const atTerminal = Boolean(snap && stops.length) && [stops[0], stops.at(-1)].some((s) => haversineMeters(s, snap) <= g.terminalRadiusM);
      const inHours = inWindows(localMinutes(new Date(now), this.config.timeZone), this.tripWindows());
      const reason = silentMin >= g.autoEndSilentMin ? `no position from the tracker for ${Math.round(silentMin)} min`
        : atTerminal && parkedMin >= g.autoEndParkedMin ? `parked at the end of the route for ${Math.round(parkedMin)} min`
          : parkedMin >= g.autoEndAnywhereMin ? `parked for ${Math.round(parkedMin)} min`
            : !inHours && parkedMin >= 5 ? 'parked after the trip hours'
              : null;
      if (!reason) continue;
      try {
        await this.tracking.endTrip({ busId: trip.bus_id }, trip.id);
      } catch (err) {
        if (err.status === 404) continue; // already ended by someone else
        throw err;
      }
      await audit(this.db, { action: 'TRIP_ENDED_BY_TRACKER', entity: 'trip', entityId: trip.id, reason });
      ended.push({ tripId: trip.id, busId: trip.bus_id, reason });
    }
    return ended;
  }

  // ---- HTTP senders --------------------------------------------------------------

  /** OsmAnd protocol: Traccar Client, OsmAnd, and trackers with an HTTP upload mode. */
  async osmand(req, res) {
    const items = parseOsmand(req.query, req.body);
    const uniqueId = items[0]?.uniqueId;
    if (!uniqueId) throw new HttpError(400, 'id is required (the tracker id registered in the admin screen)');
    const key = req.params.key ?? req.query.key ?? req.get('x-tracker-key');
    const tracker = await this.byUniqueId(uniqueId);
    if (!tracker || !this.keyMatches(tracker, key)) {
      if (!tracker) this.noteUnknown(uniqueId, 'osmand', req.ip);
      throw new HttpError(401, 'Unknown tracker or wrong key');
    }
    // 200 even when a fix is rejected: sending it again would not change the answer.
    res.json({ ok: true, ...(await this.receive(tracker, items, { protocol: 'osmand', remote: req.ip })) });
  }

  /** Positions forwarded by a Traccar server or a vendor platform, signed with GPS_WEBHOOK_SECRET. */
  async webhook(req, res) {
    const secret = this.config.gps.webhookSecret;
    if (!secret) throw new HttpError(403, 'The GPS webhook is off: set GPS_WEBHOOK_SECRET on the server');
    const auth = req.get('authorization') ?? '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-gps-secret') ?? req.query.secret;
    if (!sameSecret(given, secret)) throw new HttpError(401, 'Wrong or missing GPS webhook secret');
    const items = parseWebhook(req.body);
    const byTracker = new Map();
    for (const item of items) {
      if (!byTracker.has(item.uniqueId)) byTracker.set(item.uniqueId, []);
      byTracker.get(item.uniqueId).push(item);
    }
    const out = { received: items.length, accepted: 0, rejected: 0, unknown: [] };
    for (const [uniqueId, list] of byTracker) {
      const tracker = uniqueId ? await this.byUniqueId(uniqueId) : null;
      if (!tracker) {
        this.noteUnknown(uniqueId, 'webhook', req.ip);
        out.unknown.push(uniqueId || '(no id)');
        continue;
      }
      const r = await this.receive(tracker, list, { protocol: 'webhook', remote: req.ip });
      out.accepted += r.accepted;
      out.rejected += r.rejected;
    }
    res.json(out);
  }

  /** Per-tracker limit on the public endpoints: generous for a 1 s interval, not for a flood. */
  limiter() {
    return rateLimit({ windowMs: 60000, max: 240, key: (req) => `gps:${req.query.id ?? req.body?.device_id ?? req.ip}`, message: 'Too many positions; send at most one every few seconds' });
  }

  // ---- TCP listeners ---------------------------------------------------------------

  /** Start a raw TCP listener ('gt06' or 'teltonika'). Port 0 picks a free one (tests). */
  listen(protocol, port, host) {
    const server = createTcpListener(protocol, this);
    this.listeners.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host, backlog: 1024 }, () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  }

  /** The listeners configured with GPS_GT06_PORT / GPS_TELTONIKA_PORT. */
  async listenConfigured() {
    const out = [];
    for (const [protocol, port] of [['gt06', this.config.gps.gt06Port], ['teltonika', this.config.gps.teltonikaPort]]) {
      if (port) out.push({ protocol, port: (await this.listen(protocol, port)).address().port });
    }
    return out;
  }

  start(intervalMs = 60000) {
    this.timer = setInterval(() => this.checkTrips().catch((err) => console.error('[gps]', err)), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    for (const server of this.listeners) server.close();
    for (const id of [...this.sockets.keys()]) this.dropConnections(id);
    this.listeners = [];
  }

  // ---- Administration -------------------------------------------------------------

  /** What the admin screen shows for one tracker. */
  view(row) {
    const s = this.runtime.get(row.id);
    const lastSeenAt = s?.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : row.last_seen_at;
    return {
      id: row.id,
      uniqueId: row.unique_id,
      protocol: row.protocol,
      label: row.label,
      active: row.active,
      busId: row.bus_id,
      fleetCode: row.fleet_code ?? null,
      routeCode: row.route_code ?? null,
      routeName: row.route_name ?? null,
      createdAt: row.created_at,
      lastSeenAt: lastSeenAt ?? null,
      online: Boolean(s?.lastSeenAt && Date.now() - s.lastSeenAt < ONLINE_MS),
      connected: (this.sockets.get(row.id)?.size ?? 0) > 0,
      sendingAs: s?.protocol ?? null,
      lastFix: s?.lastFix ?? null,
      info: s?.info ?? {},
      received: s?.received ?? 0,
      accepted: s?.accepted ?? 0,
      rejected: s?.rejected ?? 0,
      outcome: s?.outcome ?? null,
      detail: s?.detail ?? null,
      // Which sender the live map is using for this bus right now.
      sourceOfLive: row.bus_id ? this.tracking.latest.get(row.bus_id)?.source ?? null : null,
    };
  }

  router() {
    const r = express.Router();
    const db = this.db;

    const busIdByCode = async (code) => {
      if (code === null || code === undefined || code === '') return null;
      const { rows } = await db.query('SELECT id FROM buses WHERE fleet_code = $1', [String(code)]);
      if (!rows[0]) throw new HttpError(400, `Unknown bus ${code}`);
      return rows[0].id;
    };
    const busTaken = async (busId, exceptId = 0) => {
      if (!busId) return;
      const { rows } = await db.query('SELECT unique_id FROM bus_trackers WHERE bus_id = $1 AND id <> $2', [busId, exceptId]);
      if (rows[0]) throw new HttpError(409, `That bus already has tracker ${rows[0].unique_id}; remove or move it first`);
    };
    const load = async (id) => {
      const { rows } = await db.query(
        `SELECT t.*, b.fleet_code, r.code AS route_code, r.name AS route_name
           FROM bus_trackers t LEFT JOIN buses b ON b.id = t.bus_id LEFT JOIN routes r ON r.id = b.route_id
          WHERE t.id = $1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, 'Tracker not found');
      return rows[0];
    };

    r.get('/', async (_req, res) => {
      const { rows } = await db.query(
        `SELECT t.*, b.fleet_code, r.code AS route_code, r.name AS route_name
           FROM bus_trackers t LEFT JOIN buses b ON b.id = t.bus_id LEFT JOIN routes r ON r.id = b.route_id
          ORDER BY b.fleet_code NULLS LAST, t.unique_id`,
      );
      const registered = new Set(rows.map((t) => t.unique_id));
      res.json({
        trackers: rows.map((row) => this.view(row)),
        unknown: [...this.unknown.values()].filter((u) => !registered.has(u.uniqueId)).reverse(),
        setup: {
          gt06Port: this.listeners.find((s) => s.protocol === 'gt06')?.address()?.port ?? null,
          teltonikaPort: this.listeners.find((s) => s.protocol === 'teltonika')?.address()?.port ?? null,
          osmandPath: '/api/gps/osmand',
          webhookPath: '/api/gps/webhook',
          webhookEnabled: Boolean(this.config.gps.webhookSecret),
          autoTrips: this.config.gps.autoTrips,
          tripWindows: this.config.gps.tripWindows ?? this.config.attendance.travelWindows,
        },
      });
    });

    r.post('/', async (req, res) => {
      const b = req.body ?? {};
      const uniqueId = String(b.uniqueId ?? '').trim();
      if (!UNIQUE_ID_RE.test(uniqueId)) throw new HttpError(400, 'Tracker id: 3-40 letters, digits, dot, dash or underscore (the IMEI for most trackers)');
      const protocol = b.protocol ?? 'auto';
      if (!PROTOCOLS.includes(protocol)) throw new HttpError(400, `protocol must be one of ${PROTOCOLS.join(', ')}`);
      const busId = await busIdByCode(b.fleetCode);
      await busTaken(busId);
      const key = newKey();
      let id;
      try {
        ({ rows: [{ id }] } = await db.query(
          `INSERT INTO bus_trackers (unique_id, protocol, bus_id, label, key_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [uniqueId, protocol, busId, b.label ? String(b.label).trim().slice(0, 80) : null, hashKey(key)],
        ));
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'That tracker id is already registered, or the bus already has a tracker');
        throw err;
      }
      this.unknown.delete(uniqueId);
      await audit(db, { actorId: req.auth.userId, action: 'TRACKER_ADDED', entity: 'tracker', entityId: id, detail: { uniqueId, protocol, fleetCode: b.fleetCode ?? null } });
      // The key is shown once: only its hash is kept.
      res.status(201).json({ tracker: this.view(await load(id)), key });
    });

    r.patch('/:id', async (req, res) => {
      const id = intParam(req.params.id, 'id');
      const current = await load(id);
      const b = req.body ?? {};
      const sets = [];
      const vals = [id];
      const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (b.fleetCode !== undefined) {
        const busId = await busIdByCode(b.fleetCode);
        await busTaken(busId, id);
        add('bus_id', busId);
      }
      if (b.label !== undefined) add('label', b.label ? String(b.label).trim().slice(0, 80) : null);
      if (b.protocol !== undefined) {
        if (!PROTOCOLS.includes(b.protocol)) throw new HttpError(400, `protocol must be one of ${PROTOCOLS.join(', ')}`);
        add('protocol', b.protocol);
      }
      if (b.active !== undefined) add('active', Boolean(b.active));
      if (!sets.length) throw new HttpError(400, 'Nothing to update');
      await db.query(`UPDATE bus_trackers SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (b.active === false || (b.fleetCode !== undefined && current.bus_id !== null)) this.moving.delete(id);
      if (b.active === false) this.dropConnections(id);
      await audit(db, { actorId: req.auth.userId, action: 'TRACKER_UPDATED', entity: 'tracker', entityId: id, detail: b });
      res.json({ tracker: this.view(await load(id)) });
    });

    r.post('/:id/key', async (req, res) => {
      const id = intParam(req.params.id, 'id');
      await load(id);
      const key = newKey();
      await db.query('UPDATE bus_trackers SET key_hash = $2 WHERE id = $1', [id, hashKey(key)]);
      await audit(db, { actorId: req.auth.userId, action: 'TRACKER_KEY_RESET', entity: 'tracker', entityId: id });
      res.json({ key });
    });

    r.delete('/:id', async (req, res) => {
      const id = intParam(req.params.id, 'id');
      const { rows } = await db.query('DELETE FROM bus_trackers WHERE id = $1 RETURNING unique_id', [id]);
      if (!rows[0]) throw new HttpError(404, 'Tracker not found');
      this.dropConnections(id);
      this.runtime.delete(id);
      this.moving.delete(id);
      await audit(db, { actorId: req.auth.userId, action: 'TRACKER_DELETED', entity: 'tracker', entityId: id, detail: { uniqueId: rows[0].unique_id } });
      res.json({ deleted: id });
    });

    return r;
  }
}
