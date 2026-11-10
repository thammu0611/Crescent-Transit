// Free student access and the "Did you board?" question from the bus GPS
// (server/boarding.js), end to end: a driver's bus sends fixes through the real
// API; students who saved a stop are asked once the bus leaves it, and reminded
// every 10 minutes until they answer.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { haversineMeters } from '../shared/geo.js';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
before(async () => {
  t = await startTestServer({ subscription: { studentRequired: false } });
});
after(() => t.stop());

const MIN = 60000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A point `meters` from stop a towards stop b. */
function towards(a, b, meters) {
  const f = meters / haversineMeters(a, b);
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/** One bus on its route; positions are sent oldest first, a minute apart. */
async function busOn(routeCode, direction) {
  const route = (await t.call(`/api/routes/${routeCode}`)).body;
  const token = await t.login(`drv${routeCode.toLowerCase()}`);
  const trip = (await t.call('/api/driver/trips', { token, method: 'POST', body: direction ? { direction } : undefined })).body.trip;
  let secs = 540;
  return {
    route,
    trip,
    token,
    stop: (seq) => route.stops.find((s) => s.seq === seq),
    async fix(p, at) {
      secs = at ?? secs - 60;
      const r = await t.call('/api/driver/locations', {
        token,
        body: { lat: p.lat, lng: p.lng, speedKmh: 30, heading: 180, accuracyM: 8, recordedAt: secondsAgo(secs) },
      });
      assert.equal(r.status, 202, JSON.stringify(r.body));
    },
    async end() {
      await t.call(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
    },
  };
}

async function student(routeCode, stopSeq, extra = {}) {
  const s = await t.newStudent(routeCode);
  const r = await t.call('/api/me', { token: s.token, method: 'PATCH', body: { homeStopSeq: stopSeq, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return s;
}

const pending = async (s) => (await t.call('/api/boarding-checks/pending', { token: s.token })).body;

async function listen(s) {
  const socket = connect(t.url, { transports: ['websocket'], auth: { token: s.token } });
  const events = { checks: [], closed: [] };
  socket.on('boarding:check', (p) => events.checks.push(p));
  socket.on('boarding:closed', (p) => events.closed.push(p));
  await new Promise((resolve) => socket.on('connect', resolve));
  return { socket, events };
}

test('no subscription needed: a student who never paid gets live data, alerts and the socket feed', async () => {
  const s = await t.newStudent('118');
  const me = (await t.call('/api/me', { token: s.token })).body;
  assert.deepEqual(me.entitlement, { active: true, inGrace: false, required: false });
  assert.equal(me.user.boardingReminders, true, 'boarding reminders are on by default');
  assert.equal((await t.call('/api/live', { token: s.token })).status, 200);
  assert.equal((await t.call('/api/eta?route=118&stop=3', { token: s.token })).status, 200);
  assert.equal((await t.call('/api/notifications', { token: s.token })).status, 200);
  assert.equal((await t.call('/api/attendance/me', { token: s.token })).status, 200);
  assert.equal((await t.call('/api/attendance/plan', { token: s.token })).body.subscribed, true);

  const socket = connect(t.url, { transports: ['websocket'], auth: { token: s.token } });
  const answer = await new Promise((resolve) => {
    socket.on('snapshot', () => resolve('snapshot'));
    socket.on('live:denied', ({ code }) => resolve(code));
    socket.on('connect', () => socket.emit('subscribe', { route: '118' }));
  });
  socket.close();
  assert.equal(answer, 'snapshot');
});

test('boarding reminders can be switched off in settings; a bad value is refused', async () => {
  const s = await t.newStudent('118');
  const off = await t.call('/api/me', { token: s.token, method: 'PATCH', body: { boardingReminders: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.user.boardingReminders, false);
  assert.equal((await t.call('/api/me', { token: s.token, method: 'PATCH', body: { boardingReminders: 'yes' } })).status, 400);
});

test('the bus leaving a stop asks its students; reminders every 10 minutes until "Yes" records attendance', async () => {
  const a = await student('127', 3);
  const quiet = await student('127', 3, { boardingReminders: false });
  const later = await student('127', 5);
  const { socket, events } = await listen(a);

  const bus = await busOn('127');
  await bus.fix(bus.stop(1));
  await bus.fix(bus.stop(2));
  await bus.fix(bus.stop(3));
  assert.deepEqual(await pending(a), [], 'the bus is still at the stop: not asked yet');

  // 250 m past stop 3: the bus has left it.
  await bus.fix(towards(bus.stop(3), bus.stop(4), 250));
  const [q] = await pending(a);
  assert.ok(q, 'asked once the bus left the stop');
  assert.equal(q.fleetCode, 'BSACIST-127');
  assert.equal(q.stopName, bus.stop(3).name);
  assert.equal(q.reminders, 0);
  assert.equal(q.remindEveryMinutes, 10);
  assert.equal(q.tripRunning, true);
  await wait(100);
  assert.equal(events.checks.length, 1, 'the open app gets the question over the socket');
  assert.equal(events.checks[0].reminder, false);
  assert.deepEqual(await pending(quiet), [], 'reminders switched off: not asked');
  assert.deepEqual(await pending(later), [], 'the bus has not reached stop 5 yet');

  // Not yet 10 minutes: no reminder. Then one every 10 minutes.
  const now = Date.now();
  assert.equal((await t.boarding.tick(now + 5 * MIN)).reminded, 0);
  assert.equal((await t.boarding.tick(now + 10.5 * MIN)).reminded, 1);
  assert.equal((await t.boarding.tick(now + 12 * MIN)).reminded, 0, 'counted from the last reminder');
  assert.equal((await t.boarding.tick(now + 21 * MIN)).reminded, 1);
  await wait(100);
  assert.equal(events.checks.length, 3);
  assert.equal(events.checks[2].reminder, true);
  assert.equal(events.checks[2].reminders, 2);

  const yes = await t.call(`/api/boarding-checks/${q.checkId}/answer`, { token: a.token, body: { answer: 'YES' } });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.status, 'BOARDED');
  assert.ok(yes.body.attendanceId);
  assert.equal((await t.boarding.tick(now + 40 * MIN)).reminded, 0, 'answered: no more reminders');
  assert.deepEqual(await pending(a), []);
  const again = await t.call(`/api/boarding-checks/${q.checkId}/answer`, { token: a.token, body: { answer: 'NO' } });
  assert.equal(again.status, 409);

  const record = (await t.call('/api/attendance/me', { token: a.token })).body.records;
  assert.equal(record.length, 1);
  assert.equal(record[0].method, 'STOP');
  assert.equal(record[0].status, 'CONFIRMED');
  assert.equal(record[0].present, true);
  assert.equal(record[0].boarding_stop, bus.stop(3).name);

  // Someone else cannot answer a student's question.
  await bus.fix(bus.stop(4));
  await bus.fix(bus.stop(5));
  await bus.fix(towards(bus.stop(5), bus.stop(6), 200));
  const [q5] = await pending(later);
  assert.ok(q5, 'stop 5 left: its student is asked');
  assert.equal((await t.call(`/api/boarding-checks/${q5.checkId}/answer`, { token: a.token, body: { answer: 'YES' } })).status, 404);
  assert.equal((await t.call(`/api/boarding-checks/${q5.checkId}/answer`, { token: later.token, body: { answer: 'MAYBE' } })).status, 400);
  const no = await t.call(`/api/boarding-checks/${q5.checkId}/answer`, { token: later.token, body: { answer: 'NO' } });
  assert.equal(no.body.status, 'NOT_BOARDED');
  assert.equal(no.body.attendanceId, null);
  assert.equal((await t.call('/api/attendance/me', { token: later.token })).body.records.length, 0, '"No" records nothing');

  socket.close();
  await bus.end();
});

test('recorded another way (the driver marks the student): the question closes by itself', async () => {
  const s = await student('101', 2);
  const { socket, events } = await listen(s);
  const bus = await busOn('101');
  await bus.fix(bus.stop(1));
  await bus.fix(bus.stop(2));
  await bus.fix(bus.stop(3));
  const [q] = await pending(s);
  assert.ok(q, 'reaching the next stop also means the bus left stop 2');

  const marked = await t.call('/api/attendance/manual', { token: bus.token, body: { tripId: bus.trip.id, username: s.username } });
  assert.equal(marked.status, 201, JSON.stringify(marked.body));
  assert.deepEqual(await pending(s), []);
  await wait(100);
  assert.deepEqual(events.closed.map((e) => e.status), ['RECORDED']);
  assert.equal((await t.boarding.tick(Date.now() + 15 * MIN)).reminded, 0);

  socket.close();
  await bus.end();
});

test('an unanswered question expires (after 12 hours, or at the nightly run)', async () => {
  const s = await student('117', 2);
  const bus = await busOn('117');
  await bus.fix(bus.stop(1));
  await bus.fix(bus.stop(2));
  await bus.fix(bus.stop(3));
  assert.equal((await pending(s)).length, 1);
  await bus.end();
  const [q] = await pending(s);
  assert.equal(q.tripRunning, false, 'still answerable after the trip ended');
  assert.equal((await t.boarding.tick(Date.now() + 13 * 60 * MIN)).expired, 1);
  assert.deepEqual(await pending(s), []);
});

test('an UP run that sets off from the campus asks nobody until it reaches a stop', async () => {
  const s = await student('118', 3);
  const bus = await busOn('118', 'UP');
  const last = bus.route.stops.at(-1);
  const before = bus.route.stops.at(-2);
  await bus.fix(last);
  await bus.fix(towards(last, before, 400));
  await bus.fix(towards(last, before, 900));
  assert.deepEqual(await pending(s), []);
  await bus.end();
});

test('the DOWN run: asked once on leaving the campus, and the record closes at their own stop', async () => {
  const route = (await t.call('/api/routes/127')).body;
  const [campus, near, next] = route.stops.slice(-3).reverse();
  const a = await student('127', near.seq);
  const far = await student('127', next.seq);
  const bus = await busOn('127', 'DOWN');
  assert.equal(bus.trip.direction, 'DOWN');

  await bus.fix(campus);
  assert.deepEqual(await pending(a), [], 'the bus is still at the campus');
  await bus.fix(towards(campus, near, 250));
  const [q] = await pending(a);
  assert.equal(q.direction, 'DOWN');
  assert.equal(q.stopName, campus.name, 'everyone boards at the college');
  assert.equal((await pending(far)).length, 1, 'every student of the route, wherever they get off');

  const live = { ...t.tracking.latest.get(q.busId), freshness: 'live' };
  const eta = t.tracking.estimate(live.routeId, live, near.seq);
  assert.ok(eta && !eta.passed, 'the stops ahead run backwards on this trip');
  assert.equal(t.tracking.estimate(live.routeId, live, campus.seq).passed, true, 'the campus is behind the bus');

  const yes = await t.call(`/api/boarding-checks/${q.checkId}/answer`, { token: a.token, body: { answer: 'YES' } });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  await bus.fix(near);
  await bus.fix(towards(near, next, 250));
  const [record] = (await t.call('/api/attendance/me', { token: a.token })).body.records;
  assert.equal(record.direction, 'DOWN');
  assert.equal(record.boarding_stop, campus.name);
  assert.equal(record.alighting_stop, near.name, 'got off at their own stop as the bus passed it');
  assert.ok(record.alighted_at);
  assert.equal(record.present, true);
  await bus.end();
  const later = await t.call(`/api/boarding-checks/${(await pending(far))[0].checkId}/answer`, { token: far.token, body: { answer: 'YES' } });
  assert.equal(later.status, 200);
  const [farRecord] = (await t.call('/api/attendance/me', { token: far.token })).body.records;
  assert.equal(farRecord.alighting_stop, next.name, 'answered after the trip ended: still their own stop');
});

test('a student has one record for each run, and the day shows each run on its own', async () => {
  const route = (await t.call('/api/routes/101')).body;
  const seq = route.stops[1].seq;
  const both = await student('101', seq);
  const oneWay = await student('101', seq);
  const admin = await t.login('admin');
  const driver = await t.login('drv101');
  const run = async (direction, ...riders) => {
    const r = await t.call('/api/driver/trips', { token: driver, method: 'POST', body: { direction } });
    assert.equal(r.body.trip.direction, direction);
    for (const u of riders) {
      assert.equal((await t.call('/api/attendance/manual', { token: driver, body: { tripId: r.body.trip.id, username: u.username } })).status, 201);
    }
    assert.equal((await t.call(`/api/driver/trips/${r.body.trip.id}/end`, { token: driver, method: 'POST' })).status, 200);
  };
  await run('UP', both, oneWay);
  await run('DOWN', both);

  const mine = (await t.call('/api/attendance/me', { token: both.token })).body;
  assert.equal(mine.upPresent, 1);
  assert.equal(mine.downPresent, 1);
  assert.equal(mine.records.length, 2);

  const history = async (u) => {
    const list = (await t.call('/api/admin/students?route=101', { token: admin })).body;
    return (await t.call(`/api/admin/students/${list.find((x) => x.username === u.username).id}/attendance`, { token: admin })).body;
  };
  const full = await history(both);
  assert.equal(full.days[0].status, 'PRESENT');
  assert.equal(full.days[0].up.status, 'PRESENT');
  assert.equal(full.days[0].down.status, 'PRESENT');
  assert.equal(full.summary.attendancePct, 100);

  const half = await history(oneWay);
  assert.equal(half.days[0].status, 'PARTIAL');
  assert.equal(half.days[0].up.status, 'PRESENT');
  assert.equal(half.days[0].down.status, 'ABSENT');
  assert.deepEqual(half.summary.down, { present: 0, absent: 1, pending: 0 });
  assert.equal(half.summary.attendancePct, 50, 'the percentage counts runs, not days');

  const today = full.days[0].date;
  const up = (await t.call(`/api/reports/attendance?from=${today}&to=${today}&route=101&direction=UP`, { token: admin })).body;
  assert.ok(up.length >= 2 && up.every((r) => r.direction === 'UP'));
});

test('a trip takes its direction from the driver, or the time of day; a bad value is refused', async () => {
  const token = await t.login('drv118');
  assert.equal((await t.call('/api/driver/trips', { token, method: 'POST', body: { direction: 'SIDEWAYS' } })).status, 400);
  assert.equal((await t.call('/api/driver/trip', { token })).body.suggestedDirection, 'UP');
  t.config.eveningRunFrom = '00:00';
  assert.equal(t.tracking.defaultDirection(), 'DOWN');
  t.config.eveningRunFrom = '24:00';
});

test("a phone that also matched the bus: answering either question settles both", async () => {
  const riders = [await t.rider('127'), await t.rider('127')];
  for (const r of riders) await t.call('/api/me', { token: r.token, method: 'PATCH', body: { homeStopSeq: 2 } });
  const phone = (r, p, secs) => t.call('/api/attendance/device-location', {
    token: r.token,
    body: { deviceId: r.deviceId, lat: p.lat, lng: p.lng, speedKmh: 28, heading: 180, accuracyM: 12, recordedAt: secondsAgo(secs) },
  });

  const bus = await busOn('127');
  await bus.fix(bus.stop(1), 300);
  await bus.fix(bus.stop(2), 240);
  await bus.fix(towards(bus.stop(2), bus.stop(3), 200), 180);
  const checks = await Promise.all(riders.map(async (r) => (await pending(r))[0]));
  assert.ok(checks.every(Boolean), 'both asked from the bus GPS');

  // Their phones move with the bus: the co-location engine asks too.
  const p1 = towards(bus.stop(2), bus.stop(3), 350);
  const p2 = towards(bus.stop(2), bus.stop(3), 550);
  await bus.fix(p1, 100);
  for (const r of riders) await phone(r, p1, 99);
  await bus.fix(p2, 40);
  const prompts = [];
  for (const r of riders) prompts.push((await phone(r, p2, 39)).body);
  assert.ok(prompts.every((p) => p.prompted), JSON.stringify(prompts));

  // Rider 0 answers the phone's prompt: the boarding question closes.
  const confirmed = await t.call(`/api/attendance/${prompts[0].prompt.attendanceId}/confirm`, { token: riders[0].token, body: { answer: 'YES' } });
  assert.equal(confirmed.body.status, 'CONFIRMED');
  assert.deepEqual(await pending(riders[0]), []);

  // Rider 1 answers the boarding question: the phone's prompt is answered with it.
  const yes = await t.call(`/api/boarding-checks/${checks[1].checkId}/answer`, { token: riders[1].token, body: { answer: 'YES' } });
  assert.equal(yes.body.attendanceId, prompts[1].prompt.attendanceId);
  assert.deepEqual((await t.call('/api/attendance/pending', { token: riders[1].token })).body, []);
  const [rec] = (await t.call('/api/attendance/me', { token: riders[1].token })).body.records;
  assert.equal(rec.method, 'GPS');
  assert.equal(rec.status, 'CONFIRMED');
  await bus.end();
});
