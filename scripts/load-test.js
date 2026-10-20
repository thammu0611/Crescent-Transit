// Load test: many students using the app at once, against the real server.
//
//   npm run load-test                         1000 students, 60 s ramp, 120 s steady
//   npm run load-test -- --students 2000 --ramp 150 --duration 120
//   npm run load-test -- --server https://...   use a running server; its database must
//                                             already hold the load00001... students (run
//                                             once with DATABASE_URL set to that database)
//
// Without --server it builds a throwaway database (in a temp folder, or the
// DATABASE_URL you set), seeds the timetable plus N subscribed students with
// location consent and a bound phone, then starts `node server/index.js` on it,
// exactly as production starts. Every route's bus drives its route and every
// student behaves like the phone app at the morning peak:
//
//   sign in -> open the app (profile, routes, route, alerts, sampling plan)
//   -> live socket on their route -> a location fix every 20 s (30% of them
//   are riding a bus, so the attendance engine matches and prompts them, and
//   they answer YES) -> pull-to-refresh alerts and ETA now and then.
//
// It prints latency percentiles per endpoint, a per-10-second timeline (to tell
// the sign-in rush from steady load), errors, and how long a bus position takes
// to reach the students' phones, and writes the numbers to
// load-test-result.json for before/after comparison. See docs/PERFORMANCE.md.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { PathWalker } from '../shared/geo.js';

const args = parseArgs(process.argv.slice(2));
const STUDENTS = Number(args.students ?? 1000);
const RAMP_S = Number(args.ramp ?? 60);
const DURATION_S = Number(args.duration ?? 120);
const PORT = Number(args.port ?? 4100);
const PASSWORD = 'Load@2026';
const FIX_INTERVAL_S = 20; // the phone's sampling interval (config.attendance.sampleIntervalS)
const BUS_INTERVAL_S = 5; // the driver app's default
const RIDING_SHARE = 0.3;
const OUT = args.out ?? 'load-test-result.json';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (scale) => (Math.random() - 0.5) * 2 * scale;
const username = (i) => `load${String(i).padStart(5, '0')}`;

// ---- Metrics ------------------------------------------------------------------

const samples = new Map(); // label -> [ms]
const timeline = []; // [at ms, latency ms] of every HTTP request, for the per-10 s table
const errors = new Map(); // label -> { status: count }
const bump = (label, key) => {
  const e = errors.get(label) ?? {};
  e[key] = (e[key] ?? 0) + 1;
  errors.set(label, e);
};
const record = (label, ms) => {
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
};
let measuring = false; // only the steady phase counts for the steady-state table
const steady = new Map();

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function summarise(map) {
  const out = {};
  for (const [label, list] of [...map].sort()) {
    const s = [...list].sort((a, b) => a - b);
    out[label] = {
      count: s.length,
      p50: Math.round(pct(s, 50)),
      p95: Math.round(pct(s, 95)),
      p99: Math.round(pct(s, 99)),
      max: Math.round(s.at(-1)),
    };
  }
  return out;
}

// ---- HTTP ---------------------------------------------------------------------

let BASE = args.server ?? `http://localhost:${PORT}`;

async function api(label, pathname, { token, body, method, okStatuses = [] } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (!stopping) bump(label, err.name === 'TimeoutError' ? 'timeout' : `network ${err.cause?.code ?? err.message}`);
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    // The 30 s timeout can also cut off the body of a late answer: that is a timeout, not an empty success.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      if (!stopping) bump(label, 'timeout');
      return null;
    }
    data = {};
  }
  const ms = performance.now() - t0;
  record(label, ms);
  if (!label.startsWith('bus:')) timeline.push([Date.now(), ms, label]);
  if (measuring) {
    if (!steady.has(label)) steady.set(label, []);
    steady.get(label).push(ms);
  }
  if (!res.ok && !okStatuses.includes(res.status)) {
    if (!stopping) bump(label, String(res.status));
    return null;
  }
  return data;
}

// ---- Throwaway server -------------------------------------------------------------

async function seed(dataDir) {
  const { loadConfig } = await import('../server/config.js');
  const { openDatabase } = await import('../server/db.js');
  const { seedIfEmpty, seedModules } = await import('../server/seed.js');
  const { default: bcrypt } = await import('bcryptjs');
  const config = loadConfig({ seedDemoStudents: false, demoPassword: PASSWORD });
  const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL || null, dataDir });
  await seedIfEmpty(db, config);
  await seedModules(db, config);
  const existing = (await db.query(`SELECT count(*)::int AS n FROM users WHERE username LIKE 'load%'`)).rows[0].n;
  if (existing < STUDENTS) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { rows: routes } = await db.query(
      `SELECT r.id, (SELECT count(*)::int FROM stops s WHERE s.route_id = r.id) AS stops FROM routes r WHERE r.active ORDER BY r.id`,
    );
    const plan = (await db.query(`SELECT plan_id FROM subscription_plans WHERE plan_code = 'MONTHLY_60'`)).rows[0].plan_id;
    // Spread students over every route and along each route's stops.
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, email, home_route_id, home_stop_seq, location_consent, consent_at)
       SELECT 'load' || lpad(g::text, 5, '0'), $1, 'Load Student ' || g, 'student', 'load' || g || '@load.test',
              ($2::int[])[1 + g % $4], 1 + (g / $4) % (($3::int[])[1 + g % $4]), TRUE, now()
         FROM generate_series($5::int, $6::int) g
       ON CONFLICT (username) DO NOTHING`,
      [hash, routes.map((r) => r.id), routes.map((r) => Math.max(1, r.stops)), routes.length, existing + 1, STUDENTS],
    );
    await db.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, valid_from, valid_to)
       SELECT u.id, $1, 'ACTIVE', current_date - 3, current_date + 26 FROM users u
        WHERE u.username LIKE 'load%' AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)`,
      [plan],
    );
    await db.query(
      `INSERT INTO devices (user_id, device_uid, platform)
       SELECT id, 'load-device-' || username, 'ANDROID' FROM users WHERE username LIKE 'load%'
       ON CONFLICT (user_id) DO NOTHING`,
    );
  }
  await db.close();
}

async function startServer() {
  const dataDir = process.env.DATABASE_URL ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'ct-load-'));
  console.log(`Seeding ${STUDENTS} students${dataDir ? ` in ${dataDir}` : ' in DATABASE_URL'}...`);
  await seed(dataDir);
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ...(dataDir ? { PGLITE_DIR: dataDir } : {}),
      DEMO_PASSWORD: PASSWORD,
      SEED_DEMO_STUDENTS: '0',
      TRAVEL_WINDOWS: '00:00-24:00', // attendance runs whatever the time of day
      PUSH_NOTIFICATIONS: '0', // never call Expo's servers from a load test
      JWT_SECRET: 'load-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Outside the project: a synced folder (OneDrive) re-uploading the log during the run skews the numbers.
  const logPath = path.join(os.tmpdir(), 'crescent-load-test-server.log');
  const log = fs.createWriteStream(logPath);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`The server exited; see ${logPath}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  return {
    pid: child.pid,
    stop: async () => {
      child.kill('SIGINT');
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
      if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// ---- Buses ------------------------------------------------------------------------

const busByRoute = new Map(); // routeCode -> latest snapshot heard by anyone
let stopping = false;

async function startBus(code) {
  const login = await api('bus: login', '/api/auth/login', { body: { username: `drv${code.toLowerCase()}`, password: PASSWORD } });
  if (!login) return null;
  const route = await api('bus: route', `/api/routes/${encodeURIComponent(code)}`);
  if (!route || route.stops.length < 2) return null;
  const walker = new PathWalker(route.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
  let started = await api('bus: start trip', '/api/driver/trips', { token: login.token, method: 'POST' });
  if (started?.resumed) {
    await api('bus: end trip', `/api/driver/trips/${started.trip.id}/end`, { token: login.token, method: 'POST' });
    started = await api('bus: start trip', '/api/driver/trips', { token: login.token, method: 'POST' });
  }
  let distance = walker.length * Math.random() * 0.4;
  (async () => {
    await sleep(Math.random() * BUS_INTERVAL_S * 1000);
    while (!stopping) {
      const speed = 25 + jitter(8);
      distance = (distance + (speed / 3.6) * BUS_INTERVAL_S) % walker.length;
      const p = walker.at(distance);
      await api('bus: POST location', '/api/driver/locations', {
        token: login.token,
        okStatuses: [422],
        body: { fixes: [{ lat: p.lat, lng: p.lng, speedKmh: Math.round(speed), heading: Math.round(p.heading), accuracyM: 8, recordedAt: new Date().toISOString() }] },
      });
      await sleep(BUS_INTERVAL_S * 1000);
    }
  })();
  return code;
}

// ---- Students ---------------------------------------------------------------------

const counters = { busyRetries: 0, signedIn: 0, sockets: 0, socketErrors: 0, fixes: 0, prompts: 0, confirmed: 0, busMessages: 0 };
const sockets = [];

async function student(i) {
  const name = username(i);
  const riding = Math.random() < RIDING_SHARE;
  let login = null;
  // A server busy with a sign-in rush answers 503 BUSY: try again, like a person would.
  for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
    login = await api('POST /api/auth/login', '/api/auth/login', { body: { username: name, password: PASSWORD }, okStatuses: [503] });
    if (login?.code !== 'BUSY') break;
    counters.busyRetries += 1;
    login = null;
    await sleep(5000 + Math.random() * 2000);
  }
  if (!login) return;
  if (!login.user) { bump('student', `sign-in answer without user: ${JSON.stringify(login).slice(0, 120)}`); return; }
  counters.signedIn += 1;
  const { token, user } = login;
  const routeCode = user.homeRouteCode;

  // Opening the app: what StudentHome, the session and the sampler load.
  const [, , route] = await Promise.all([
    api('GET /api/me', '/api/me', { token }),
    api('GET /api/routes', '/api/routes'),
    api('GET /api/routes/:code', `/api/routes/${encodeURIComponent(routeCode)}`),
    api('GET /api/notifications', '/api/notifications', { token }),
    api('GET /api/attendance/plan', '/api/attendance/plan', { token }),
  ]);

  const socket = io(BASE, { transports: ['websocket'], auth: { token }, forceNew: true, reconnection: true });
  sockets.push(socket);
  socket.on('connect', () => {
    counters.sockets += 1;
    socket.emit('subscribe', { route: routeCode });
  });
  socket.on('connect_error', () => { if (!stopping) counters.socketErrors += 1; });
  socket.on('bus:location', (b) => {
    counters.busMessages += 1;
    const ms = Date.now() - Date.parse(b.recordedAt);
    record('socket: bus position fan-out', ms);
    if (measuring) {
      if (!steady.has('socket: bus position fan-out')) steady.set('socket: bus position fan-out', []);
      steady.get('socket: bus position fan-out').push(ms);
    }
    busByRoute.set(b.routeCode, b);
  });
  socket.on('attendance:prompt', async (p) => {
    counters.prompts += 1;
    await sleep(2000 + Math.random() * 3000);
    const r = await api('POST /api/attendance/:id/confirm', `/api/attendance/${p.attendanceId}/confirm`, { token, body: { answer: 'YES' }, okStatuses: [409] });
    if (r?.status) counters.confirmed += 1;
  });

  const home = route?.stops?.find((s) => s.seq === user.homeStopSeq);
  const deviceId = `load-device-${name}`;
  await sleep(Math.random() * FIX_INTERVAL_S * 1000);
  let tick = 0;
  while (!stopping) {
    tick += 1;
    const bus = busByRoute.get(routeCode);
    let fix;
    if (riding && bus) {
      fix = { lat: bus.lat + jitter(0.00008), lng: bus.lng + jitter(0.00008), speedKmh: bus.speedKmh, heading: bus.heading, accuracyM: 12 };
    } else if (home) {
      fix = { lat: home.lat + jitter(0.0002), lng: home.lng + jitter(0.0002), speedKmh: 0, accuracyM: 15 };
    }
    if (fix) {
      counters.fixes += 1;
      await api('POST /api/attendance/device-location', '/api/attendance/device-location', {
        token,
        body: { deviceId, ...fix, recordedAt: new Date().toISOString() },
      });
    }
    // Pull-to-refresh and the arrival card, now and then.
    if (tick % 3 === 0) await api('GET /api/notifications', '/api/notifications', { token });
    if (tick % 2 === 0 && user.homeStopSeq) await api('GET /api/eta', `/api/eta?route=${encodeURIComponent(routeCode)}&stop=${user.homeStopSeq}`, { token });
    await sleep(FIX_INTERVAL_S * 1000);
  }
}

/** Resident memory of the server process in MB (null if it cannot be read). */
function serverMemoryMb(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' });
      return Math.round(Number(out.trim()) / 1048576);
    }
    return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024);
  } catch {
    return null;
  }
}

// ---- Server health probe ------------------------------------------------------------

async function probe() {
  while (!stopping) {
    await api('probe: GET /api/health', '/api/health');
    await sleep(1000);
  }
}

// ---- Run ----------------------------------------------------------------------------

const server = args.server ? null : await startServer();
console.log(`Server: ${BASE}${server ? ` (pid ${server.pid})` : ''}`);

const routes = (await api('setup', '/api/routes')) ?? [];
const buses = (await Promise.all(routes.map((r) => startBus(r.code)))).filter(Boolean);
console.log(`${buses.length} buses driving; ramping ${STUDENTS} students over ${RAMP_S} s...`);
probe();

const started = Date.now();
const runs = [];
for (let i = 1; i <= STUDENTS; i++) {
  runs.push(student(i).catch((err) => bump('student', err.message)));
  await sleep((RAMP_S * 1000) / STUDENTS);
}
const report = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`  ${s}s  signed in ${counters.signedIn}  sockets ${counters.sockets}  fixes ${counters.fixes}  prompts ${counters.prompts}  confirmed ${counters.confirmed}`);
}, 10000);

console.log(`Ramp done. Measuring ${DURATION_S} s of steady load...`);
measuring = true;
const steadyStarted = Date.now();
await sleep(DURATION_S * 1000);
measuring = false;
const memoryMb = server ? serverMemoryMb(server.pid) : null;
const steadySeconds = (Date.now() - steadyStarted) / 1000;
stopping = true;
clearInterval(report);
for (const s of sockets) s.close();

// Latency over time: shows whether slow requests are the sign-in rush or steady load.
const buckets = new Map();
for (const [at, ms, label] of timeline) {
  const b = Math.floor((at - started) / 10000) * 10;
  if (!buckets.has(b)) buckets.set(b, { all: [], logins: 0 });
  buckets.get(b).all.push(ms);
  if (label.includes('login')) buckets.get(b).logins += 1;
}
const overTime = Object.fromEntries([...buckets].sort((a, b) => a[0] - b[0]).map(([b, v]) => {
  const s = v.all.sort((x, y) => x - y);
  return [`${b}-${b + 10}s`, { requests: s.length, signIns: v.logins, p50: Math.round(pct(s, 50)), p95: Math.round(pct(s, 95)), p99: Math.round(pct(s, 99)) }];
}));

const steadyTable = summarise(steady);
const totalSteady = Object.values(steadyTable).filter((_, i) => !Object.keys(steadyTable)[i].startsWith('socket')).reduce((n, r) => n + r.count, 0);
const result = {
  at: new Date().toISOString(),
  students: STUDENTS,
  rampS: RAMP_S,
  durationS: DURATION_S,
  buses: buses.length,
  counters,
  serverMemoryMb: memoryMb,
  steadyRequestsPerSecond: Math.round(totalSteady / steadySeconds),
  steady: steadyTable,
  overTime,
  wholeRun: summarise(samples),
  errors: Object.fromEntries(errors),
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

console.log('');
console.log(`Steady state (${STUDENTS} students, ${buses.length} buses): ${result.steadyRequestsPerSecond} requests/s`);
console.table(steadyTable);
console.log('All student requests over time:');
console.table(overTime);
console.log('Whole run, including the sign-in rush:');
console.table(Object.fromEntries(Object.entries(result.wholeRun).filter(([k]) => /login|probe|me$|plan|fan-out/.test(k))));
console.log('Errors:', Object.keys(result.errors).length ? result.errors : 'none');
console.log(`Counters: ${JSON.stringify(counters)}`);
if (memoryMb) console.log(`Server memory at the end of the steady phase: ${memoryMb} MB`);
console.log(`Saved ${OUT}`);

await server?.stop();
await Promise.race([Promise.allSettled(runs), sleep(FIX_INTERVAL_S * 1000 + 5000)]);
process.exit(0);
