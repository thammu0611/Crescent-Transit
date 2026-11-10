// "Another bus can take you" (server/alternatives.js): the student's bus has
// passed, gone quiet or not started, and a bus of another route is near their stop.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { clockMinutes } from '../server/alternatives.js';
import { haversineMeters } from '../shared/geo.js';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
let pair; // two routes with stops close together: { mine, other, a, b, seq }
before(async () => {
  // Stops can be kilometres apart: fixes go in minutes apart and still count as live.
  t = await startTestServer({ subscription: { studentRequired: false }, freshness: { liveSeconds: 600, delayedSeconds: 900 } });
  const codes = (await t.call('/api/routes')).body.map((r) => r.code);
  const routes = await Promise.all(codes.map(async (c) => (await t.call(`/api/routes/${c}`)).body));
  for (const mine of routes) {
    for (const other of routes) {
      if (mine.code === other.code || pair) continue;
      for (const a of mine.stops.slice(1, -1)) {
        const b = other.stops.slice(1, -1).sort((x, y) => haversineMeters(a, x) - haversineMeters(a, y))[0];
        if (b && !pair && haversineMeters(a, b) < 800) pair = { mine, other, a, b };
      }
    }
  }
  assert.ok(pair, 'the dataset has two routes with stops close together');
});
after(() => t.stop());

function towards(a, b, meters) {
  const f = meters / haversineMeters(a, b);
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

async function drive(code, direction) {
  const token = await t.login(`drv${code.toLowerCase()}`);
  const trip = (await t.call('/api/driver/trips', { token, method: 'POST', body: { direction } })).body.trip;
  assert.equal(trip.direction, direction);
  let secs = 590;
  return {
    async fix(p) {
      secs -= 120;
      const r = await t.call('/api/driver/locations', { token, body: { lat: p.lat, lng: p.lng, speedKmh: 25, heading: 180, accuracyM: 8, recordedAt: secondsAgo(secs) } });
      assert.equal(r.status, 202, JSON.stringify(r.body));
    },
    end: () => t.call(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' }),
  };
}

async function student() {
  const s = await t.newStudent(pair.mine.code);
  await t.call('/api/me', { token: s.token, method: 'PATCH', body: { homeStopSeq: pair.a.seq } });
  const { rows } = await t.db.query('SELECT id FROM users WHERE username = $1', [s.username]);
  return { ...s, id: rows[0].id };
}

const stopBefore = (route, stop) => route.stops[route.stops.findIndex((s) => s.seq === stop.seq) - 1];
const stopAfter = (route, stop) => route.stops[route.stops.findIndex((s) => s.seq === stop.seq) + 1];
const alerts = async (s) => (await t.db.query('SELECT reason FROM bus_alternative_alerts WHERE user_id = $1', [s.id])).rows;
const hourToday = (hhmm) => Date.parse(`${new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)}T${hhmm}:00+05:30`);

test('timetable times are read', () => {
  assert.equal(clockMinutes('6.15 AM'), 375);
  assert.equal(clockMinutes('12.30 PM'), 750);
  assert.equal(clockMinutes('4.30 PM'), 990);
  assert.equal(clockMinutes(null), null);
});

test('my bus passed: another bus near my stop is offered, once, and not to someone on board', async () => {
  const declined = await student();
  const boarded = await student();
  const away = await student();
  await t.call('/api/me', { token: away.token, method: 'PATCH', body: { boardingReminders: false } });
  const mine = await drive(pair.mine.code, 'UP');
  const other = await drive(pair.other.code, 'UP');
  await other.fix(stopBefore(pair.other, pair.b));

  await mine.fix(pair.a);
  assert.equal((await t.call('/api/alternatives', { token: declined.token })).body, null, 'my bus is still here');
  await mine.fix(towards(pair.a, stopAfter(pair.mine, pair.a), 300));

  const [q] = (await t.call('/api/boarding-checks/pending', { token: declined.token })).body;
  assert.equal((await t.alternatives.sweep()).alerted, 0, 'the "Did you board?" answer comes first');
  await t.call(`/api/boarding-checks/${q.checkId}/answer`, { token: declined.token, body: { answer: 'NO' } });
  assert.equal((await alerts(declined))[0]?.reason, 'PASSED', '"No" brings the alert straight away');
  const alert = (await t.call('/api/alternatives', { token: declined.token })).body;
  assert.equal(alert.reason, 'PASSED');
  assert.equal(alert.options[0].routeCode, pair.other.code);
  assert.equal(alert.options[0].boardStop, pair.b.name);
  assert.ok(alert.options[0].walkM < 800 && alert.options[0].eta.high >= 0);

  const [b] = (await t.call('/api/boarding-checks/pending', { token: boarded.token })).body;
  await t.call(`/api/boarding-checks/${b.checkId}/answer`, { token: boarded.token, body: { answer: 'YES' } });
  assert.deepEqual(await alerts(boarded), [], 'on the bus: nothing to say');

  t.config.busAlternatives.askWaitMinutes = 0;
  await t.alternatives.sweep();
  await t.alternatives.sweep();
  assert.equal((await alerts(declined)).length, 1, 'one alert for the run');
  assert.deepEqual(await alerts(away), [], 'reminders switched off');
  t.config.busAlternatives.askWaitMinutes = 3;
  await mine.end();
  await other.end();
  await t.db.query('DELETE FROM bus_alternative_alerts');
  await t.db.query(`UPDATE trips SET status = 'cancelled' WHERE status = 'completed'`);
});

test('my bus has not started by its time: the nearby bus is offered; before its time, nothing', async () => {
  const s = await student();
  const other = await drive(pair.other.code, 'UP');
  await other.fix(stopBefore(pair.other, pair.b));
  const due = clockMinutes(pair.a.scheduled_time);
  const at = (min) => hourToday(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
  assert.equal(await t.alternatives.forStudent(s.id, at(due - 30)), null);
  assert.equal(await t.alternatives.forStudent(s.id, at(due + 5)), null, 'a few minutes late is not yet missing');
  const alert = await t.alternatives.forStudent(s.id, at(due + 30));
  assert.equal(alert.reason, 'NO_BUS');
  assert.equal(alert.options[0].routeCode, pair.other.code);
  await other.end();
});

test('my bus has gone quiet: the nearby bus is offered', async () => {
  const s = await student();
  const mine = await drive(pair.mine.code, 'UP');
  const other = await drive(pair.other.code, 'UP');
  await mine.fix(stopBefore(pair.mine, pair.a));
  await other.fix(stopBefore(pair.other, pair.b));
  const quiet = [...t.tracking.latest.values()].find((b) => b.routeCode === pair.mine.code);
  assert.equal(await t.alternatives.forStudent(s.id), null, 'my bus is on its way');
  quiet.recordedAt = new Date(Date.now() - 3600000).toISOString();
  assert.equal((await t.alternatives.forStudent(s.id)).reason, 'UNAVAILABLE');
  await mine.end();
  await other.end();
});

test('a full bus, or one that has passed that stop too, is not offered', async () => {
  const s = await student();
  const other = await drive(pair.other.code, 'UP');
  const late = hourToday('23:00');
  await other.fix(stopBefore(pair.other, pair.b));
  const token = await t.login(`drv${pair.other.code.toLowerCase()}`);
  await t.call('/api/driver/occupancy', { token, body: { occupancy: 'FULL' } });
  assert.equal(await t.alternatives.forStudent(s.id, late), null);
  await t.call('/api/driver/occupancy', { token, body: { occupancy: 'SEATS_FREE' } });
  await other.fix(pair.b);
  await other.fix(towards(pair.b, stopAfter(pair.other, pair.b), 600));
  await other.fix(stopAfter(pair.other, pair.b));
  assert.equal(await t.alternatives.forStudent(s.id, late), null);
  await other.end();
});

test('the DOWN run: my bus has left the college, another still there is offered', async () => {
  const s = await student();
  const campus = pair.mine.stops.at(-1);
  const mine = await drive(pair.mine.code, 'DOWN');
  const other = await drive(pair.other.code, 'DOWN');
  await other.fix(pair.other.stops.at(-1));
  await mine.fix(campus);
  await mine.fix(towards(campus, pair.mine.stops.at(-2), 400));
  t.config.eveningRunFrom = '00:00';
  t.config.busAlternatives.askWaitMinutes = 0;
  const alert = await t.alternatives.forStudent(s.id);
  t.config.eveningRunFrom = '24:00';
  t.config.busAlternatives.askWaitMinutes = 3;
  assert.equal(alert.direction, 'DOWN');
  assert.equal(alert.reason, 'PASSED');
  assert.equal(alert.options[0].boardStop, pair.other.stops.at(-1).name);
  assert.equal(alert.options[0].getOffStop, pair.b.name);
  await mine.end();
  await other.end();
});
