// Administrator module (doc 4.1, Phase 4) and role separation (doc section 4).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
let admin;
before(async () => {
  t = await startTestServer();
  admin = await t.login('admin');
});
after(() => t.stop());

test('roles are enforced on the server, not by hiding buttons', async () => {
  const driver = await t.login('drv118');
  const finance = await t.login('finance');
  const s = await t.newStudent();
  for (const token of [driver, finance, s.token]) {
    assert.equal((await t.call('/api/admin/buses', { token })).status, 403);
  }
  assert.equal((await t.call('/api/admin/buses')).status, 401);
  assert.equal((await t.call('/api/finance/payments', { token: admin })).status, 403);
  assert.equal((await t.call('/api/trips/1/path', { token: s.token })).status, 403, 'history is for administrators');
});

test('route builder: create a route, add stops, insert, reorder and delete', async () => {
  const route = await t.call('/api/admin/routes', { token: admin, body: { code: 'T1', name: 'Test Route', departureTime: '7.00 AM' } });
  assert.equal(route.status, 201);
  const id = route.body.id;
  const add = (name, lat, lng, extra = {}) => t.call(`/api/admin/routes/${id}/stops`, { token: admin, body: { name, lat, lng, ...extra } });
  const a = (await add('Alpha', 12.95, 80.2)).body;
  const c = (await add('Charlie', 12.93, 80.18)).body;
  const b = (await add('Bravo', 12.94, 80.19, { position: 2 })).body;
  let stops = (await t.call('/api/routes/T1')).body.stops;
  assert.deepEqual(stops.map((s) => s.name), ['Alpha', 'Bravo', 'Charlie']);

  assert.equal((await t.call(`/api/admin/routes/${id}/stops/order`, { token: admin, method: 'PUT', body: { stopIds: [c.id, b.id, a.id] } })).status, 200);
  stops = (await t.call('/api/routes/T1')).body.stops;
  assert.deepEqual(stops.map((s) => `${s.seq}${s.name[0]}`), ['1C', '2B', '3A']);
  assert.equal((await t.call(`/api/admin/routes/${id}/stops/order`, { token: admin, method: 'PUT', body: { stopIds: [c.id, b.id] } })).status, 400);

  await t.call(`/api/admin/stops/${b.id}`, { token: admin, method: 'PATCH', body: { name: 'Bravo Signal', lat: 12.941 } });
  await t.call(`/api/admin/stops/${c.id}`, { token: admin, method: 'DELETE' });
  stops = (await t.call('/api/routes/T1')).body.stops;
  assert.deepEqual(stops.map((s) => `${s.seq}:${s.name}:${s.geo_source}`), ['1:Bravo Signal:admin', '2:Alpha:admin']);
  assert.equal((await t.call('/api/admin/routes', { token: admin, body: { code: 'T1', name: 'Duplicate' } })).status, 409);
});

test('bus and driver management, assignment, and a scheduled trip the driver then starts', async () => {
  const bus = await t.call('/api/admin/buses', { token: admin, body: { fleetCode: 'BSACIST-T1', registrationNumber: 'TN 01 AB 1234', capacity: 40, routeCode: 'T1' } });
  assert.equal(bus.status, 201);
  const drv = await t.call('/api/admin/drivers', { token: admin, body: { username: 'drvt1', fullName: 'Test Driver', password: 'driverpass1', fleetCode: 'BSACIST-T1' } });
  assert.equal(drv.status, 201);
  const clash = await t.call('/api/admin/drivers', { token: admin, body: { username: 'drvt2', fullName: 'Second', password: 'driverpass2', fleetCode: 'BSACIST-T1' } });
  assert.equal(clash.status, 409, 'one driver per bus');

  const scheduled = await t.call('/api/admin/trips', { token: admin, body: { fleetCode: 'BSACIST-T1', scheduledFor: new Date(Date.now() + 30 * 60000).toISOString() } });
  assert.equal(scheduled.status, 201);
  const token = await t.login('drvt1', 'driverpass1');
  const started = await t.call('/api/driver/trips', { token, method: 'POST' });
  assert.equal(started.body.trip.id, scheduled.body.id, 'the scheduled trip is the one that runs');

  // Maintenance blocks the next start; history blocks deletion.
  await t.call(`/api/driver/trips/${started.body.trip.id}/end`, { token, method: 'POST' });
  await t.call(`/api/admin/buses/${bus.body.id}`, { token: admin, method: 'PATCH', body: { status: 'maintenance' } });
  assert.equal((await t.call('/api/driver/trips', { token, method: 'POST' })).status, 409);
  assert.equal((await t.call(`/api/admin/buses/${bus.body.id}`, { token: admin, method: 'DELETE' })).status, 409);
  const trips = (await t.call('/api/admin/trips?route=T1', { token: admin })).body;
  assert.equal(trips[0].status, 'completed');
});

test('admin can start, end and cancel trips on behalf of a driver', async () => {
  const s = await t.call('/api/admin/trips', { token: admin, body: { fleetCode: 'BSACIST-120', scheduledFor: new Date().toISOString() } });
  assert.equal((await t.call(`/api/admin/trips/${s.body.id}/start`, { token: admin, method: 'POST' })).body.status, 'active');
  assert.equal((await t.call(`/api/admin/trips/${s.body.id}/cancel`, { token: admin, method: 'POST', body: { reason: 'Test' } })).body.status, 'cancelled');
  assert.equal((await t.call(`/api/admin/trips/${s.body.id}/cancel`, { token: admin, method: 'POST' })).status, 409);
});

test('announcements reach subscribers of the route; the notice board is free', async () => {
  const sub = await t.newStudent('121');
  await t.subscribe(sub.token);
  const free = await t.newStudent('121');
  await t.call('/api/notifications', { token: admin, body: { title: 'Route 121 diverted', message: 'Road works at Porur', kind: 'ROUTE_CHANGE', routeCode: '121' } });
  await t.call('/api/notifications', { token: admin, body: { title: 'Holiday', message: 'No buses on Monday' } });

  const alerts = (await t.call('/api/notifications', { token: sub.token })).body.map((n) => n.title);
  assert.ok(alerts.includes('Route 121 diverted') && alerts.includes('Holiday'));
  assert.equal((await t.call('/api/notifications', { token: free.token })).status, 402, 'alerts are a paid feature');
  const board = (await t.call('/api/notices')).body.map((n) => n.title);
  assert.ok(board.includes('Holiday') && !board.includes('Route 121 diverted'));
});

test('a driver breakdown becomes an incident and an alert on the route', async () => {
  const token = await t.login('drv122');
  await t.call('/api/driver/trips', { token, method: 'POST' });
  const r = await t.call('/api/driver/incidents', { token, body: { kind: 'BREAKDOWN', message: 'Flat tyre near Guindy' } });
  assert.equal(r.status, 201);
  const incidents = (await t.call('/api/admin/incidents?status=OPEN', { token: admin })).body;
  const inc = incidents.find((i) => i.id === r.body.id);
  assert.equal(inc.route_code, '122');
  const alerts = (await t.call('/api/notifications', { token })).body;
  assert.equal(alerts[0].kind, 'BREAKDOWN');
  const resolved = await t.call(`/api/admin/incidents/${inc.id}/resolve`, { token: admin, body: { resolution: 'Relief bus sent' } });
  assert.equal(resolved.body.status, 'RESOLVED');
});

test('occupancy chip and the doc 6.3 endpoint names', async () => {
  const token = await t.login('drv123');
  const bus = (await t.call('/api/trips/start', { token, method: 'POST' })).body.trip;
  const busId = bus.bus_id;
  const route = (await t.call('/api/routes/123')).body;
  const fix = { lat: route.stops[0].lat, lng: route.stops[0].lng, speedKmh: 12, heading: 90, recordedAt: secondsAgo(1) };
  assert.equal((await t.call(`/api/buses/${busId}/location`, { token, body: fix })).status, 202);
  assert.equal((await t.call(`/api/buses/${busId + 1}/location`, { token, body: fix })).status, 403, 'only your own bus');
  await t.call('/api/driver/occupancy', { token, body: { occupancy: 'STANDING' } });
  const live = (await t.call(`/api/buses/${busId}/location`, { token: admin })).body;
  assert.equal(live.occupancy, 'STANDING');
  const eta = (await t.call(`/api/eta?route=123&stop=${route.stops.at(-1).seq}`, { token: admin })).body;
  assert.ok(eta[0].eta.minutes > 0);
  assert.equal((await t.call('/api/trips/end', { token, body: { tripId: bus.id } })).status, 200);
});

test('admin drill-downs: drivers with trip counts, students per bus, and a student history day by day', async () => {
  const s = await t.newStudent('118', { registerNo: 'H118' });
  const driver = await t.login('drv118');
  const trip = (await t.call('/api/driver/trips', { token: driver, method: 'POST' })).body.trip;
  assert.equal((await t.call('/api/attendance/manual', { token: driver, body: { tripId: trip.id, username: s.username } })).status, 201);

  const drivers = (await t.call('/api/admin/drivers', { token: admin })).body;
  const d = drivers.find((x) => x.username === 'drv118');
  assert.ok(d.trips_total >= 1);
  assert.equal(d.on_trip, true);
  const trips = (await t.call(`/api/admin/trips?driver=${d.id}`, { token: admin })).body;
  assert.ok(trips.length >= 1 && trips.every((x) => x.driver_id === d.id));

  const buses = (await t.call('/api/admin/buses', { token: admin })).body;
  assert.ok(buses.find((b) => b.route_code === '118').students >= 1);
  const onRoute = (await t.call('/api/admin/students?route=118', { token: admin })).body;
  const me = onRoute.find((x) => x.username === s.username);
  assert.ok(me && onRoute.every((x) => x.route_code === '118'));

  const h = (await t.call(`/api/admin/students/${me.id}/attendance`, { token: admin })).body;
  assert.equal(h.student.register_no, 'H118');
  assert.equal(h.days[0].status, 'PRESENT');
  assert.equal(h.days[0].records[0].trip_id, trip.id);
  assert.equal(h.summary.present, 1);
  assert.equal((await t.call('/api/admin/students/999999/attendance', { token: admin })).status, 404);

  const o = (await t.call('/api/admin/overview?days=7', { token: admin })).body;
  assert.equal(o.series.length, 7);
  assert.ok(o.series.at(-1).present >= 1);
  assert.ok(o.totals.buses >= 28);
  assert.ok(o.activity.some((a) => a.kind === 'trip_started'));
});
