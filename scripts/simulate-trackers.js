// Plays GPS trackers fitted in the buses, speaking the real protocols, so the
// tracker integration can be seen working without any hardware:
//
//   npm run simulate:trackers                                GT06 trackers on 118 and 119
//   npm run simulate:trackers -- --protocol teltonika --routes 117,127
//   npm run simulate:trackers -- --protocol osmand --routes 118,119,117
//   npm run simulate:trackers -- --server https://your-app --host gps.your-app.com
//
// The server must listen for the protocol: GPS_GT06_PORT=5023 for gt06,
// GPS_TELTONIKA_PORT=5027 for teltonika; osmand uses the normal HTTP port.
// As the administrator, it registers a tracker labelled "Simulator" on each
// route's bus that has none (a bus with a real tracker is left alone). Trips
// start by themselves once a bus has moved for 15 s inside the trip hours
// (TRAVEL_WINDOWS / GPS_TRIP_WINDOWS: use 00:00-24:00 to test at any time).
import crypto from 'node:crypto';
import net from 'node:net';
import { PathWalker } from '../shared/geo.js';
import * as gt06 from '../server/gps/gt06.js';
import * as teltonika from '../server/gps/teltonika.js';

const args = parseArgs(process.argv.slice(2));
const SERVER = String(args.server ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');
const PROTOCOL = args.protocol ?? 'gt06';
const ROUTES = String(args.routes ?? '118,119').split(',').map((s) => s.trim()).filter(Boolean);
const INTERVAL_S = Number(args.interval ?? 10);
const SPEED_KMH = Number(args.speed ?? 30);
const HOST = args.host ?? new URL(SERVER).hostname;
const PORT = Number(args.port ?? (PROTOCOL === 'teltonika' ? process.env.GPS_TELTONIKA_PORT ?? 5027 : process.env.GPS_GT06_PORT ?? 5023));
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';
const KNOTS_PER_KMH = 1 / 1.852;

if (!['gt06', 'teltonika', 'osmand'].includes(PROTOCOL)) {
  console.error('--protocol must be gt06, teltonika or osmand');
  process.exit(1);
}

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
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${data.error ?? ''}`);
  return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (scale) => (Math.random() - 0.5) * 2 * scale;
/** A stable 15-digit IMEI-like id per route, so reruns reuse the same tracker. */
const imeiFor = (code) => `86${BigInt(`0x${crypto.createHash('sha1').update(`sim-${code}`).digest('hex').slice(0, 15)}`).toString().padStart(13, '0').slice(-13)}`;
const log = (label, text) => console.log(`${new Date().toLocaleTimeString()}  ${label.padEnd(30)} ${text}`);

class SimTracker {
  constructor(code, tracker, key) {
    this.code = code;
    this.tracker = tracker;
    this.key = key;
    this.label = `${tracker.fleetCode} (${PROTOCOL} ${tracker.uniqueId})`;
    this.serial = 1;
    this.socket = null;
    this.ready = false;
  }

  async start() {
    const route = await api(`/api/routes/${encodeURIComponent(this.code)}`);
    this.walker = new PathWalker(route.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
    this.distance = this.walker.length * Math.random() * 0.4;
    if (PROTOCOL !== 'osmand') this.connect();
    log(this.label, `driving ${(this.walker.length / 1000).toFixed(1)} km of route ${this.code}`);
  }

  // ---- TCP trackers keep one connection open, and reconnect like real ones ----
  connect() {
    const socket = net.connect(PORT, HOST);
    this.socket = socket;
    this.ready = false;
    let buffer = Buffer.alloc(0);
    socket.on('connect', () => {
      socket.write(PROTOCOL === 'gt06' ? gt06.encodeLogin(this.tracker.uniqueId, this.serial++) : teltonika.encodeImei(this.tracker.uniqueId));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (PROTOCOL === 'gt06') {
        const { frames, rest } = gt06.splitFrames(buffer);
        buffer = rest;
        for (const f of frames) {
          if (f.type === gt06.MSG.LOGIN && !this.ready) {
            this.ready = true;
            log(this.label, `logged in on ${HOST}:${PORT}`);
          }
        }
      } else if (!this.ready) {
        if (buffer[0] === 0x01) {
          this.ready = true;
          log(this.label, `IMEI accepted on ${HOST}:${PORT}`);
        } else log(this.label, 'IMEI refused: is the tracker registered and switched on?');
        buffer = buffer.subarray(1);
      } else {
        buffer = Buffer.alloc(0); // record-count acknowledgements
      }
    });
    socket.on('error', (err) => log(this.label, `connection: ${err.message}`));
    socket.on('close', () => {
      this.ready = false;
      setTimeout(() => this.connect(), 5000);
    });
  }

  async step() {
    const speed = Math.max(0, SPEED_KMH + jitter(8));
    this.distance = (this.distance + (speed / 3.6) * INTERVAL_S) % this.walker.length;
    const p = this.walker.at(this.distance);
    const position = { lat: p.lat + jitter(0.00003), lng: p.lng + jitter(0.00003), speedKmh: Math.round(speed), heading: Math.round(p.heading), time: new Date() };

    if (PROTOCOL === 'osmand') {
      const q = new URLSearchParams({
        id: this.tracker.uniqueId,
        lat: position.lat.toFixed(6),
        lon: position.lng.toFixed(6),
        speed: (position.speedKmh * KNOTS_PER_KMH).toFixed(1),
        bearing: String(position.heading),
        accuracy: '8',
        timestamp: String(Math.floor(position.time.getTime() / 1000)),
      });
      try {
        const r = await api(`/api/gps/osmand/${this.key}?${q}`);
        log(this.label, `${r.outcome}${r.detail ? `: ${r.detail}` : ''}`);
      } catch (err) {
        log(this.label, err.message);
      }
      return;
    }
    if (!this.ready) return;
    if (PROTOCOL === 'gt06') {
      this.socket.write(gt06.encodeLocation(position, this.serial++));
      if (this.serial % 18 === 0) this.socket.write(gt06.encodeHeartbeat({ ignition: true }, this.serial++));
    } else {
      this.socket.write(teltonika.encodePacket([position]));
    }
  }
}

// ---- Run --------------------------------------------------------------------------

const { token } = await api('/api/auth/login', { body: { username: 'admin', password: PASSWORD } });
const { trackers, setup } = await api('/api/admin/trackers', { token });
if (PROTOCOL === 'gt06' && !setup.gt06Port) console.warn(`Warning: the server is not listening for GT06; start it with GPS_GT06_PORT=${PORT}.`);
if (PROTOCOL === 'teltonika' && !setup.teltonikaPort) console.warn(`Warning: the server is not listening for Teltonika; start it with GPS_TELTONIKA_PORT=${PORT}.`);

const sims = [];
for (const code of ROUTES) {
  const fleetCode = `BSACIST-${code}`;
  const existing = trackers.find((t) => t.fleetCode === fleetCode);
  let tracker = existing;
  let key = null;
  if (existing && existing.label !== 'Simulator') {
    console.warn(`${fleetCode} has a real tracker (${existing.uniqueId}); left alone.`);
    continue;
  }
  if (existing) {
    if (PROTOCOL === 'osmand') ({ key } = await api(`/api/admin/trackers/${existing.id}/key`, { token, method: 'POST' }));
  } else {
    ({ tracker, key } = await api('/api/admin/trackers', { token, body: { uniqueId: imeiFor(code), protocol: PROTOCOL, fleetCode, label: 'Simulator' } }));
    console.log(`Registered simulated tracker ${tracker.uniqueId} on ${fleetCode}.`);
  }
  sims.push(new SimTracker(code, tracker, key));
}
if (!sims.length) process.exit(0);
await Promise.all(sims.map((s) => s.start()));

// What the server makes of each tracker, from the admin screen's point of view.
setInterval(async () => {
  if (PROTOCOL === 'osmand') return; // each HTTP answer is logged already
  try {
    const { trackers: now } = await api('/api/admin/trackers', { token });
    for (const s of sims) {
      const v = now.find((t) => t.id === s.tracker.id);
      if (v) log(s.label, `${v.outcome ?? 'no data yet'}${v.detail ? `: ${v.detail}` : ''} (accepted ${v.accepted}, rejected ${v.rejected})`);
    }
  } catch (err) {
    console.warn(err.message);
  }
}, 30000).unref();

for (;;) {
  await Promise.all(sims.map((s) => s.step()));
  await sleep(INTERVAL_S * 1000);
}
