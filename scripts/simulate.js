// Drives buses along their real BSACIST routes through the public driver API,
// exactly as the driver phone app would: login -> start trip -> POST fixes.
//
//   npm run simulate                                  4 buses, fix every 5 s
//   npm run simulate -- --routes 118,119 --interval 3
//   npm run simulate -- --faults                      also send invalid fixes
//   npm run simulate -- --drop 127:40                 bus 127 goes silent after 40 s
//                                                     (shows DELAYED, then OFFLINE)
//   npm run simulate -- --riders                      seeded students ride the buses:
//                                                     their phones send fixes, the
//                                                     attendance engine prompts them
//                                                     and they answer (the server's
//                                                     TRAVEL_WINDOWS must cover now)
import { io } from 'socket.io-client';
import { PathWalker } from '../shared/geo.js';

const args = parseArgs(process.argv.slice(2));
const SERVER = args.server ?? `http://localhost:${process.env.PORT ?? 4000}`;
const ROUTES = (args.routes ?? '118,119,117,127').split(',').map((s) => s.trim()).filter(Boolean);
const INTERVAL_S = Number(args.interval ?? 5);
const SPEED_KMH = Number(args.speed ?? 32);
const FAULTS = Boolean(args.faults);
const DROPS = Object.fromEntries(
  String(args.drop ?? '')
    .split(',')
    .filter(Boolean)
    .map((d) => d.split(':'))
    .map(([code, s]) => [code, Number(s ?? 30)]),
);
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';
const RIDERS = Boolean(args.riders);
// Seeded demo students: six per route, in this order (server/seed.js).
const SEEDED_ROUTES = ['118', '119', '117', '127'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

async function api(path, { token, body, method } = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new Error(`${path} -> ${res.status} ${data.error ?? ''}`);
  return data;
}

const jitter = (scale) => (Math.random() - 0.5) * 2 * scale;

// Faults the server must reject; each is labelled with the expected reason.
const FAULT_KINDS = [
  (p, t) => ({ label: 'NULL_ISLAND', fix: { lat: 0, lng: 0, recordedAt: t } }),
  (p, t) => ({ label: 'IMPOSSIBLE_JUMP', fix: { lat: p.lat + 0.09, lng: p.lng + 0.09, recordedAt: t } }),
  (p, t) => ({ label: 'LOW_ACCURACY', fix: { lat: p.lat, lng: p.lng, accuracyM: 850, recordedAt: t } }),
  (p, t) => ({ label: 'INVALID_SPEED', fix: { lat: p.lat, lng: p.lng, speedKmh: 240, recordedAt: t } }),
];

class SimulatedBus {
  constructor(code) {
    this.code = code;
    this.tick = 0;
    this.dwell = 0;
    this.silent = false;
  }

  async start() {
    const login = await api('/api/auth/login', { body: { username: `drv${this.code.toLowerCase()}`, password: PASSWORD } });
    this.token = login.token;
    this.label = `${login.user.fleetCode} (${login.user.routeName})`;
    const route = await api(`/api/routes/${encodeURIComponent(this.code)}`);
    this.stops = route.stops;
    this.walker = new PathWalker(route.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
    // Spread buses along their routes so the map is interesting straight away.
    this.distance = this.walker.length * Math.random() * 0.5;
    // A trip left running by an earlier session ends at a different place;
    // close it so this run starts a clean trip.
    let { trip, resumed } = await api('/api/driver/trips', { token: this.token, method: 'POST' });
    if (resumed) {
      await api(`/api/driver/trips/${trip.id}/end`, { token: this.token, method: 'POST' });
      ({ trip } = await api('/api/driver/trips', { token: this.token, method: 'POST' }));
    }
    this.tripId = trip.id;
    this.startedAt = Date.now();
    log(this, `started trip ${trip.id}, ${(this.walker.length / 1000).toFixed(1)} km route`);
    this.riders = [];
    const k = SEEDED_ROUTES.indexOf(this.code);
    if (RIDERS && k >= 0) {
      for (let i = 1; i <= 6; i++) this.riders.push(new Rider(`stu${String(k * 6 + i).padStart(3, '0')}`, this));
      await Promise.all(this.riders.map((r) => r.start().catch((e) => log(this, `  rider ${r.username}: ${e.message}`))));
    }
  }

  async step() {
    if (DROPS[this.code] !== undefined && Date.now() - this.startedAt > DROPS[this.code] * 1000) {
      if (!this.silent) log(this, 'stopped sending (simulated network loss)');
      this.silent = true;
      return;
    }
    this.tick++;

    // Pause briefly at stops, otherwise drive at roughly SPEED_KMH.
    let speed = 0;
    if (this.dwell > 0) {
      this.dwell--;
    } else {
      speed = Math.max(8, SPEED_KMH + jitter(10));
      const before = this.walker.at(this.distance).segmentIndex;
      this.distance += (speed / 3.6) * INTERVAL_S;
      if (this.walker.at(this.distance).segmentIndex !== before) this.dwell = Math.random() < 0.6 ? 1 : 0;
    }
    const p = this.walker.at(this.distance);
    const now = new Date().toISOString();

    const fixes = [
      {
        lat: p.lat + jitter(0.00004),
        lng: p.lng + jitter(0.00004),
        speedKmh: Math.round(speed * 10) / 10,
        heading: Math.round(p.heading),
        accuracyM: Math.round(4 + Math.random() * 12),
        recordedAt: now,
      },
    ];
    let fault = null;
    if (FAULTS && this.tick % 6 === 0) {
      fault = FAULT_KINDS[Math.floor(Math.random() * FAULT_KINDS.length)](p, now);
      fixes.unshift(fault.fix); // sent first, so the good fix is still the newest
    }

    const result = await api('/api/driver/locations', { token: this.token, body: { fixes } });
    const rejected = result.results.filter((r) => !r.accepted).map((r) => r.reason);
    for (const rider of this.riders) rider.step(p, speed).catch((e) => log(this, `  rider ${rider.username}: ${e.message}`));
    log(this, `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}  ${String(Math.round(speed)).padStart(3)} km/h` +
      (rejected.length ? `  rejected: ${rejected.join(', ')}${fault ? ` (injected ${fault.label})` : ''}` : ''));

    if (p.done) {
      await api(`/api/driver/trips/${this.tripId}/end`, { token: this.token, method: 'POST' });
      log(this, 'reached campus - trip completed, starting again from the first stop');
      this.distance = 0;
      const { trip } = await api('/api/driver/trips', { token: this.token, method: 'POST' });
      this.tripId = trip.id;
      for (const rider of this.riders) if (rider.state !== 'skip') Object.assign(rider, { state: 'waiting', fixes: 0 });
    }
  }

  async end() {
    for (const rider of this.riders ?? []) rider.stop();
    if (this.tripId) await api(`/api/driver/trips/${this.tripId}/end`, { token: this.token, method: 'POST' }).catch(() => {});
  }
}

/**
 * A student phone riding a simulated bus: waits at the home stop, rides beside
 * the bus (a few metres off, same speed and direction), answers the boarding
 * prompt, and one in three gets off early to show alighting detection.
 */
class Rider {
  constructor(username, bus) {
    this.username = username;
    this.bus = bus;
    this.state = 'waiting';
    this.lastSent = 0;
    this.fixes = 0;
    this.alightAfter = Math.random() < 0.34 ? 10 + Math.floor(Math.random() * 6) : Infinity;
  }

  async start() {
    const { token, user } = await api('/api/auth/login', { body: { username: this.username, password: PASSWORD } });
    this.token = token;
    this.deviceId = `sim-${this.username}`;
    const bind = await fetch(`${SERVER}/api/devices/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: this.deviceId, platform: 'ANDROID' }),
    }).then((r) => r.json());
    if (bind.code === 'OTP_REQUIRED' && bind.devOtp) {
      await api('/api/devices/bind', { token, body: { deviceId: this.deviceId, platform: 'ANDROID', otp: bind.devOtp } });
    }
    const plan = await api('/api/attendance/plan', { token });
    if (!plan.shouldSample) {
      this.state = 'skip';
      const why = !plan.subscribed ? 'no subscription'
        : !plan.consent ? 'no location consent'
        : !plan.inTravelWindow ? 'outside the travel window (start the server with TRAVEL_WINDOWS=00:00-24:00)'
        : 'device not bound';
      log(this.bus, `  rider ${this.username} not riding: ${why}`);
      return;
    }
    const stopIndex = this.bus.stops.findIndex((s) => s.seq === user.homeStopSeq);
    this.boardAt = stopIndex > 0 ? this.bus.walker.cumulative[stopIndex] : 0;
    this.socket = io(SERVER, { transports: ['websocket'], auth: { token } });
    this.socket.on('attendance:prompt', (p) => {
      // Most students tap Yes within seconds; some ignore the prompt.
      if (Math.random() < 0.15) return log(this.bus, `  rider ${this.username} ignored the prompt for ${p.fleetCode}`);
      setTimeout(() => {
        api(`/api/attendance/${p.attendanceId}/confirm`, { token, body: { answer: 'YES' } })
          .then((r) => log(this.bus, `  rider ${this.username} answered Yes -> ${r.status}`))
          .catch((e) => log(this.bus, `  rider ${this.username}: ${e.message}`));
      }, 2000 + Math.random() * 6000);
    });
    // "Did you board?" from the bus GPS once the bus leaves their stop (server/boarding.js).
    this.socket.on('boarding:check', (c) => {
      if (c.reminder) log(this.bus, `  rider ${this.username} reminded (${c.reminders}) about ${c.fleetCode}`);
      setTimeout(() => {
        api(`/api/boarding-checks/${c.checkId}/answer`, { token, body: { answer: 'YES' } })
          .then((r) => log(this.bus, `  rider ${this.username} answered "Did you board?" -> ${r.status}`))
          .catch((e) => log(this.bus, `  rider ${this.username}: ${e.message}`));
      }, 2000 + Math.random() * 6000);
    });
  }

  async step(position, speed) {
    if (this.state === 'skip' || this.state === 'done' || Date.now() - this.lastSent < 20000) return;
    if (this.state === 'waiting' && this.bus.distance >= this.boardAt) {
      this.state = 'riding';
      log(this.bus, `  rider ${this.username} boarded`);
    }
    if (this.state === 'waiting') return;
    this.lastSent = Date.now();
    this.fixes += 1;
    const away = this.fixes > this.alightAfter;
    const r = await api('/api/attendance/device-location', {
      token: this.token,
      body: {
        deviceId: this.deviceId,
        lat: position.lat + (away ? 0.003 : jitter(0.00006)), // ~330 m off once they get down
        lng: position.lng + jitter(0.00006),
        speedKmh: away ? 4 : Math.max(0, speed + jitter(3)),
        heading: Math.round(position.heading + jitter(8) + 360) % 360,
        accuracyM: 10,
        recordedAt: new Date().toISOString(),
      },
    });
    if (r.prompted) log(this.bus, `  rider ${this.username}: engine asked "Are you on ${r.prompt.fleetCode}?"`);
    if (r.alighted) {
      log(this.bus, `  rider ${this.username} got off -> ${r.status}`);
      this.state = 'done';
    }
  }

  stop() {
    this.socket?.close();
  }
}

function log(bus, msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`${t}  ${(bus.label ?? bus.code).padEnd(34)} ${msg}`);
}

const buses = ROUTES.map((code) => new SimulatedBus(code));
try {
  await Promise.all(buses.map((b) => b.start()));
} catch (err) {
  console.error(`Could not start the simulation against ${SERVER}: ${err.message}`);
  console.error('Is the server running?  npm start');
  process.exit(1);
}
console.log(`Simulating ${buses.length} buses, one fix every ${INTERVAL_S} s. Ctrl+C ends the trips.\n`);

const timer = setInterval(() => {
  for (const bus of buses) bus.step().catch((err) => log(bus, `error: ${err.message}`));
}, INTERVAL_S * 1000);

process.on('SIGINT', async () => {
  clearInterval(timer);
  await Promise.all(buses.map((b) => b.end()));
  console.log('\nTrips ended.');
  process.exit(0);
});
