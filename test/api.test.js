// End-to-end test of Module 1 against a real (in-memory) PostgreSQL:
// driver login -> start trip -> POST fix -> stored -> pushed over Socket.IO.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { seedIfEmpty, seedModules } from '../server/seed.js';
import { REANCHOR_AFTER } from '../server/tracking.js';

const config = loadConfig({ jwtSecret: 'test-secret', demoPassword: 'test-password', clientDist: '/nonexistent', backgroundJobs: false, seedDemoStudents: false });
let db, server, base, stop;

before(async () => {
  db = await openDatabase({ databaseUrl: null, dataDir: null });
  await seedIfEmpty(db, config);
  await seedModules(db, config);
  ({ httpServer: server, stop } = await createServer(db, config));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  stop();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

async function call(path, { token, body, method } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const login = async (username, password = 'test-password') =>
  (await call('/api/auth/login', { body: { username, password } })).body.token;

const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

test('seeds all 28 BSACIST routes with their boarding points', async () => {
  const { body } = await call('/api/routes');
  assert.equal(body.length, 28);
  assert.equal(body.reduce((n, r) => n + r.stop_count, 0), 395);
  const route = (await call('/api/routes/118')).body;
  assert.equal(route.name, 'Velachery');
  assert.equal(route.stops[0].seq, 1);
});

test('login rejects a wrong password without saying which field was wrong', async () => {
  const { status, body } = await call('/api/auth/login', { body: { username: 'drv118', password: 'nope' } });
  assert.equal(status, 401);
  assert.equal(body.error, 'Invalid username or password');
});

test('location endpoints require a driver token', async () => {
  assert.equal((await call('/api/driver/locations', { body: {} })).status, 401);
  const admin = await login('admin');
  assert.equal((await call('/api/driver/locations', { token: admin, body: {} })).status, 403);
});

test('a fix is refused until the driver starts a trip', async () => {
  const token = await login('drv101');
  const r = await call('/api/driver/locations', { token, body: { lat: 13.1, lng: 80.29, recordedAt: secondsAgo(1) } });
  assert.equal(r.status, 409);
});

test('accepted fix is stored and broadcast; rejected fix is logged, not broadcast', async () => {
  const token = await login('drv118');
  const admin = await login('admin');
  const socket = connect(base, { transports: ['websocket'], auth: { token: admin } });
  const received = [];
  await new Promise((resolve) => socket.on('connect', resolve));
  socket.on('bus:location', (b) => received.push(b));
  socket.emit('subscribe', { route: '118' });
  await new Promise((resolve) => socket.once('snapshot', resolve));

  const started = await call('/api/driver/trips', { token, method: 'POST' });
  assert.equal(started.status, 201);
  const again = await call('/api/driver/trips', { token, method: 'POST' });
  assert.equal(again.body.resumed, true, 'starting twice resumes the same trip');
  assert.equal(again.body.trip.id, started.body.trip.id);

  const ok = await call('/api/driver/locations', {
    token,
    body: { lat: 12.975, lng: 80.2, speedKmh: 28, heading: 180, accuracyM: 6, recordedAt: secondsAgo(1) },
  });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.accepted, 1);

  const bad = await call('/api/driver/locations', { token, body: { lat: 0, lng: 0, recordedAt: secondsAgo(0) } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.results[0].reason, 'NULL_ISLAND');

  await new Promise((resolve) => setTimeout(resolve, 200));
  socket.close();
  assert.equal(received.length, 1, 'only the valid fix is pushed to clients');
  assert.equal(received[0].routeCode, '118');
  assert.equal(received[0].freshness, 'live');
  assert.ok(received[0].nearestStop.name);

  const live = (await call('/api/live?route=118', { token: admin })).body;
  assert.equal(live.length, 1);
  assert.equal(live[0].lat, 12.975);

  const stats = (await call('/api/stats')).body;
  assert.equal(stats.acceptedFixes, 1);
  assert.equal(stats.rejectedByReason.NULL_ISLAND, 1);

  const path = (await call(`/api/trips/${started.body.trip.id}/path`, { token: admin })).body;
  assert.equal(path.length, 1);
});

test('a buffered batch is checked oldest first, each fix gets its own verdict', async () => {
  const token = await login('drv119');
  await call('/api/driver/trips', { token, method: 'POST' });
  const fixes = [
    { lat: 12.9612, lng: 80.2466, recordedAt: secondsAgo(10) }, // newest, sent first
    { lat: 12.9600, lng: 80.2460, recordedAt: secondsAgo(30) }, // oldest
    { lat: 12.9606, lng: 80.2463, accuracyM: 700, recordedAt: secondsAgo(20) }, // bad accuracy
  ];
  const r = await call('/api/driver/locations', { token, body: { fixes } });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body.results.map((x) => x.accepted), [true, true, false]);
  const live = (await call('/api/live?route=119', { token: await login('admin') })).body[0];
  assert.equal(live.lat, 12.9612, 'the map shows the newest accepted fix');
});

test(`re-anchors after ${REANCHOR_AFTER} consistent fixes that all disagree with the last accepted one`, async () => {
  const token = await login('drv117');
  await call('/api/driver/trips', { token, method: 'POST' });
  await call('/api/driver/locations', { token, body: { lat: 12.95, lng: 80.2, recordedAt: secondsAgo(40) } });
  // The bus is really ~9 km away (e.g. the first fix was a GPS glitch).
  const results = [];
  for (let i = 0; i < REANCHOR_AFTER; i++) {
    const r = await call('/api/driver/locations', {
      token,
      body: { lat: 12.87 + i * 0.0003, lng: 80.2, recordedAt: secondsAgo(30 - i * 5) },
    });
    results.push(r.body.results[0]);
  }
  assert.deepEqual(results.slice(0, -1).map((r) => r.reason), Array(REANCHOR_AFTER - 1).fill('IMPOSSIBLE_JUMP'));
  assert.equal(results.at(-1).accepted, true);
  assert.equal(results.at(-1).reanchored, true);
});

test('ending a trip removes the bus from the live map', async () => {
  const token = await login('drv118');
  const { trip } = (await call('/api/driver/trip', { token })).body;
  const ended = await call(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
  assert.equal(ended.status, 200);
  assert.equal((await call('/api/live?route=118', { token: await login('admin') })).body.length, 0);
  assert.equal((await call(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' })).status, 404);
});

test('the driver sees the bus GPS tracker status and the students on the bus', async () => {
  const token = await login('drv118');
  const gps = await call('/api/driver/bus-gps', { token });
  assert.equal(gps.status, 200);
  assert.equal(gps.body.tracker, null); // no tracker registered for this bus in the test seed
  assert.equal(gps.body.reporting, false);

  const reg = await call('/api/auth/register', {
    body: { username: 'rider118', email: 'rider118@example.com', fullName: 'Rider One', password: 'password-118', routeCode: '118', stopSeq: 2, registerNo: 'REG118', department: 'CSE' },
  });
  assert.equal(reg.status, 201);
  const { body } = await call('/api/driver/students', { token });
  const me = body.students.find((s) => s.username === 'rider118');
  assert.ok(me, 'the student on route 118 is listed');
  assert.equal(me.fullName, 'Rider One');
  assert.equal(me.registerNo, 'REG118');
  assert.equal(me.department, 'CSE');
  assert.equal(me.stopSeq, 2);
  assert.ok(me.stopName);
  assert.equal(me.passActive, false);
  assert.equal((await call('/api/driver/students', { token: await login('admin') })).status, 403);
});
