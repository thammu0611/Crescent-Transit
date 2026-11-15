// Parents, the digital pass, automatic alerts, and the student and driver services.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { CHECKLIST_ITEMS } from '../shared/service.js';
import { haversineMeters } from '../shared/geo.js';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
let admin;
before(async () => {
  t = await startTestServer({ subscription: { studentRequired: false }, freshness: { liveSeconds: 600, delayedSeconds: 900 } });
  admin = await t.login('admin');
  t.config.automation.stopAlertEveryS = 0;
});
after(() => t.stop());

async function drive(code, direction = 'UP') {
  const route = (await t.call(`/api/routes/${code}`)).body;
  const token = await t.login(`drv${code.toLowerCase()}`);
  const trip = (await t.call('/api/driver/trips', { token, method: 'POST', body: { direction } })).body.trip;
  let secs = 590;
  return {
    route,
    token,
    trip,
    stop: (seq) => route.stops.find((s) => s.seq === seq),
    async fix(p, speedKmh = 25) {
      secs -= 120;
      const r = await t.call('/api/driver/locations', { token, body: { lat: p.lat, lng: p.lng, speedKmh, heading: 180, accuracyM: 8, recordedAt: secondsAgo(secs) } });
      assert.equal(r.status, 202, JSON.stringify(r.body));
    },
    end: () => t.call(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' }),
  };
}

async function student(code, stopSeq) {
  const s = await t.newStudent(code);
  if (stopSeq) await t.call('/api/me', { token: s.token, method: 'PATCH', body: { homeStopSeq: stopSeq } });
  const { rows } = await t.db.query('SELECT id FROM users WHERE username = $1', [s.username]);
  return { ...s, id: rows[0].id };
}

let serial = 0;
const parentBody = (code) => {
  serial += 1;
  return { username: `parent${serial}x`, fullName: `Parent ${serial}`, email: `parent${serial}@example.com`, password: 'Parent@2026', code };
};

test('a parent signs up with the code from the student, once, and sees only that child', async () => {
  const kid = await student('118', 3);
  const other = await student('118', 3);
  const { body: made } = await t.call('/api/guardians/code', { token: kid.token, method: 'POST' });
  assert.match(made.code, /^[A-Z2-9]{8}$/);

  const bad = await t.call('/api/auth/register-parent', { body: parentBody('WRONGCODE') });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'BAD_LINK_CODE');

  const signup = await t.call('/api/auth/register-parent', { body: parentBody(made.code.toLowerCase()) });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal(signup.body.user.role, 'parent');
  const token = signup.body.token;

  const again = await t.call('/api/auth/register-parent', { body: parentBody(made.code) });
  assert.equal(again.status, 400, 'a code works once');

  const [child] = (await t.call('/api/parent/children', { token })).body;
  assert.equal(child.id, kid.id);
  assert.equal(child.routeCode, '118');
  assert.equal(child.inbound.state, 'NOT_YET');
  assert.equal(JSON.stringify(child).includes(other.username), false);
  assert.equal('lat' in child, false, 'never a location for the student');

  const bus = await drive('118');
  await bus.fix(bus.stop(1));
  await t.call('/api/attendance/manual', { token: bus.token, body: { tripId: bus.trip.id, username: kid.username } });
  const [live] = (await t.call('/api/parent/children', { token })).body;
  assert.equal(live.inbound.state, 'ON_BOARD');
  assert.equal(live.bus.fleetCode, 'BSACIST-118');

  assert.equal((await t.guardians.sendNotices()).sent, 1, 'boarded');
  assert.equal((await t.guardians.sendNotices()).sent, 0, 'once');
  await bus.end();
  const [done] = (await t.call('/api/parent/children', { token })).body;
  assert.equal(done.inbound.state, 'REACHED');
  assert.equal((await t.guardians.sendNotices()).sent, 1, 'reached');

  assert.equal((await t.call('/api/live', { token })).status, 403, 'a parent has no fleet view');
  assert.equal((await t.call('/api/admin/buses', { token })).status, 403);

  const [p] = (await t.call('/api/guardians', { token: kid.token })).body;
  assert.equal((await t.call(`/api/guardians/${p.id}`, { token: kid.token, method: 'DELETE' })).status, 200);
  assert.deepEqual((await t.call('/api/parent/children', { token })).body, [], 'the student can remove a parent');
});

test('the bus pass: the driver scans it, the student is recorded, and an old or forged code fails', async () => {
  const s = await student('119', 3);
  await t.call('/api/pass/photo', { token: s.token, method: 'PUT', body: { photo: 'data:image/jpeg;base64,AAAA' } });
  assert.equal((await t.call('/api/pass/photo', { token: s.token, method: 'PUT', body: { photo: 'not a picture' } })).status, 400);
  const { body: pass } = await t.call('/api/pass', { token: s.token });
  assert.equal(pass.status, 'FREE');
  assert.equal(pass.valid, true);
  assert.equal(pass.routeCode, '119');
  assert.equal(pass.photo, 'data:image/jpeg;base64,AAAA');

  const bus = await drive('119');
  const scan = await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: pass.code } });
  assert.equal(scan.status, 200, JSON.stringify(scan.body));
  assert.equal(scan.body.valid, true);
  assert.equal(scan.body.sameRoute, true);
  assert.equal(scan.body.recorded, true);
  const twice = await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: pass.code } });
  assert.equal(twice.body.alreadyRecorded, true);
  assert.equal((await t.call('/api/attendance/me', { token: s.token })).body.records.length, 1);

  const old = `CTPASS:${jwt.sign({ typ: 'bus-pass', sub: String(s.id) }, t.config.jwtSecret, { expiresIn: -5 })}`;
  assert.equal((await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: old } })).body.code, 'PASS_CODE_EXPIRED');
  const forged = `CTPASS:${jwt.sign({ typ: 'bus-pass', sub: String(s.id) }, 'guess', { expiresIn: 60 })}`;
  assert.equal((await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: forged } })).status, 400);
  assert.equal((await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: 'UBTS-BOARD:1' } })).status, 400);
  await bus.end();
});

test('a pass with no subscription is shown as expired and records nobody, when one is required', async () => {
  const s = await student('117', 3);
  const bus = await drive('117');
  const { body: pass } = await t.call('/api/pass', { token: s.token });
  t.config.subscription.studentRequired = true;
  t.billing.cache?.clear?.();
  const scan = await t.call('/api/driver/pass-scan', { token: bus.token, body: { code: pass.code } });
  t.config.subscription.studentRequired = false;
  assert.equal(scan.body.valid, false);
  assert.equal(scan.body.status, 'EXPIRED');
  assert.equal(scan.body.recorded, false);
  await bus.end();
});

test('the bus nearing a stop alerts the students waiting there once, not those who switched it off', async () => {
  const route = (await t.call('/api/routes/127')).body;
  const seq = route.stops[3].seq;
  const on = await student('127', seq);
  const off = await student('127', seq);
  await t.call('/api/me', { token: off.token, method: 'PATCH', body: { arrivalAlerts: false } });
  const bus = await drive('127');
  await bus.fix(route.stops[0]);
  const count = async (s) => (await t.db.query('SELECT count(*)::int AS n FROM stop_alerts WHERE user_id = $1', [s.id])).rows[0].n;
  assert.equal(await count(on), 0, 'still too far away');
  await bus.fix(route.stops[1]);
  await bus.fix(route.stops[2]);
  const snap = t.tracking.latest.get(bus.trip.bus_id);
  await t.automation.alertStops(snap);
  await t.automation.alertStops(snap);
  assert.equal(await count(on), 1);
  assert.equal(await count(off), 0);
  await bus.end();
});

test('a trip that stays at the end of its run ends by itself, and one still on the way does not', async () => {
  const bus = await drive('101');
  const stops = bus.route.stops;
  const last = stops.at(-1);
  const f = 3000 / haversineMeters(last, stops.at(-2)); // 3 km out, on the way in
  await bus.fix({ lat: last.lat + (stops.at(-2).lat - last.lat) * f, lng: last.lng + (stops.at(-2).lng - last.lng) * f });
  await bus.fix(stops.at(-1));
  await t.automation.tick(Date.now() + 60000);
  assert.ok((await t.call('/api/driver/trip', { token: bus.token })).body.trip, 'just arrived: not yet');
  await t.automation.tick(Date.now() + 10 * 60000);
  assert.equal((await t.call('/api/driver/trip', { token: bus.token })).body.trip, null);

  const away = await drive('102');
  await away.fix(away.route.stops[2]);
  await t.automation.tick(Date.now() + 60 * 60000);
  assert.ok((await t.call('/api/driver/trip', { token: away.token })).body.trip);
  await away.end();
});

test('speeding raises one incident for a trip; a single bad reading does not', async () => {
  const bus = await drive('104');
  const a = bus.route.stops[0];
  const b = bus.route.stops[1];
  const near = (f) => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
  assert.ok(haversineMeters(a, b) > 0);
  const incidents = async () => (await t.db.query(`SELECT count(*)::int AS n FROM incidents WHERE kind = 'SPEEDING' AND trip_id = $1`, [bus.trip.id])).rows[0].n;
  await bus.fix(near(0.1), 80);
  await bus.fix(near(0.2), 30);
  assert.equal(await incidents(), 0);
  await bus.fix(near(0.3), 80);
  await bus.fix(near(0.4), 85);
  await bus.fix(near(0.5), 90);
  assert.equal(await incidents(), 1);
  await bus.end();
});

test('feedback: only the trips you rode, once; a complaint gets a reply and shows on the dashboard', async () => {
  const s = await student('105', 3);
  const stranger = await student('105', 3);
  const bus = await drive('105');
  await t.call('/api/attendance/manual', { token: bus.token, body: { tripId: bus.trip.id, username: s.username } });
  await bus.end();
  const body = { tripId: bus.trip.id, rating: 2, tags: ['LATE', 'CROWDED'], comment: 'Twenty minutes late', complaint: true };
  assert.equal((await t.call('/api/feedback', { token: stranger.token, body })).status, 403);
  assert.equal((await t.call('/api/feedback', { token: s.token, body: { ...body, rating: 9 } })).status, 400);
  assert.equal((await t.call('/api/feedback', { token: s.token, body: { ...body, tags: ['NOPE'] } })).status, 400);
  const made = await t.call('/api/feedback', { token: s.token, body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await t.call('/api/feedback', { token: s.token, body })).status, 409);

  const quality = (await t.call('/api/admin/service-quality', { token: admin })).body;
  assert.equal(quality.open_complaints, 1);
  assert.equal(quality.rating, 2);
  assert.ok(quality.topTags.some((x) => x.tag === 'LATE'));

  const id = (await t.call('/api/admin/feedback?status=OPEN', { token: admin })).body[0].id;
  assert.equal((await t.call(`/api/admin/feedback/${id}/respond`, { token: admin, body: { response: 'Spoken to the driver' } })).status, 200);
  const [mine] = (await t.call('/api/feedback/me', { token: s.token })).body;
  assert.equal(mine.status, 'RESOLVED');
  assert.equal(mine.response, 'Spoken to the driver');
});

test('route change: one request at a time, a full route needs an override, approval moves the student', async () => {
  const s = await student('106', 3);
  const to = (await t.call('/api/routes/107')).body;
  const seq = to.stops[2].seq;
  assert.equal((await t.call('/api/route-requests', { token: s.token, body: { routeCode: '107', stopSeq: to.stops.at(-1).seq } })).status, 400, 'not the campus');
  const made = await t.call('/api/route-requests', { token: s.token, body: { routeCode: '107', stopSeq: seq, reason: 'Moved house' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await t.call('/api/route-requests', { token: s.token, body: { routeCode: '107', stopSeq: seq } })).status, 409);

  const reject = await t.call(`/api/admin/route-requests/${made.body.id}/decide`, { token: admin, body: { decision: 'REJECT' } });
  assert.equal(reject.status, 400, 'a refusal needs a reason');
  await t.db.query(`UPDATE buses SET capacity = 0 + 1 WHERE route_id = (SELECT id FROM routes WHERE code = '107')`);
  const filler = await student('107', 2);
  assert.ok(filler.id);
  const full = await t.call(`/api/admin/route-requests/${made.body.id}/decide`, { token: admin, body: { decision: 'APPROVE' } });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, 'ROUTE_FULL');
  const ok = await t.call(`/api/admin/route-requests/${made.body.id}/decide`, { token: admin, body: { decision: 'APPROVE', override: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const me = (await t.call('/api/me', { token: s.token })).body.user;
  assert.equal(me.homeRouteCode, '107');
  assert.equal(me.homeStopSeq, seq);
});

test('lost and found: a driver posts a find, only the reporter or staff close it, reporters stay private', async () => {
  const s = await student('108', 3);
  const other = await student('108', 3);
  const lost = await t.call('/api/lost-items', { token: s.token, body: { kind: 'LOST', title: 'Blue water bottle' } });
  assert.equal(lost.status, 201, JSON.stringify(lost.body));
  const driver = await t.login('drv108');
  const found = await t.call('/api/lost-items', { token: driver, body: { kind: 'LOST', title: 'Black umbrella' } });
  assert.equal(found.body.kind, 'FOUND', 'a driver always reports a find');
  const list = (await t.call('/api/lost-items?route=108', { token: other.token })).body;
  assert.equal(list.length, 2);
  assert.equal('reporter' in list[0], false);
  assert.ok((await t.call('/api/lost-items?route=108', { token: admin })).body[0].reporter);
  assert.equal((await t.call(`/api/lost-items/${lost.body.id}/status`, { token: other.token, body: { status: 'RETURNED' } })).status, 403);
  assert.equal((await t.call(`/api/lost-items/${lost.body.id}/status`, { token: s.token, body: { status: 'RETURNED' } })).status, 200);
  assert.equal((await t.call('/api/lost-items?route=108', { token: other.token })).body.length, 1);
});

test('the pre-trip check: every item must be answered, and a failure reaches the transport office', async () => {
  const token = await t.login('drv109');
  const all = Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, true]));
  assert.equal((await t.call('/api/driver/checklist', { token, body: { results: { TYRES: true } } })).status, 400);
  assert.equal((await t.call('/api/driver/checklist', { token })).body.done, null);
  assert.equal((await t.call('/api/driver/checklist', { token, body: { results: all } })).status, 201);
  assert.ok((await t.call('/api/driver/checklist', { token })).body.done);
  const failed = await t.call('/api/driver/checklist', { token, body: { results: { ...all, BRAKES: false }, note: 'Soft pedal' } });
  assert.equal(failed.body.failed, 1, 'a second answer replaces the first');
  const { rows } = await t.db.query(`SELECT message FROM incidents WHERE kind = 'VEHICLE_CHECK' ORDER BY id DESC LIMIT 1`);
  assert.match(rows[0].message, /Brakes/);
  const list = (await t.call('/api/admin/checklists', { token: admin })).body;
  assert.ok(list.rows.some((r) => r.fleet_code === 'BSACIST-109' && r.failed === 1));
});

const istMinutesNow = () => {
  const d = new Date(Date.now() + 5.5 * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const clock = (min) => {
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}.${String(min % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

test('a bus well behind its timetable tells the route and its parents once', async () => {
  const route = (await t.call('/api/routes/112')).body;
  const kid = await student('112', route.stops[1].seq);
  const { body: made } = await t.call('/api/guardians/code', { token: kid.token, method: 'POST' });
  const { body: parent } = await t.call('/api/auth/register-parent', { body: parentBody(made.code) });
  const stop = t.tracking.stopsByRoute.get(t.tracking.stopsByRoute.keys().next().value) && route.stops[0];
  const routeId = (await t.db.query(`SELECT id FROM routes WHERE code = '112'`)).rows[0].id;
  const live = t.tracking.stopsByRoute.get(routeId);
  const saved = live[0].scheduled_time;
  live[0].scheduled_time = clock(Math.max(0, istMinutesNow() - 25));
  const bus = await drive('112');
  await bus.fix(stop);
  live[0].scheduled_time = saved;
  const messages = (await t.db.query(`SELECT message FROM notifications WHERE trip_id = $1`, [bus.trip.id])).rows;
  assert.equal(messages.length, 1, 'one message for the trip');
  assert.match(messages[0].message, /Bus 112 is running ~\d+ min late/);
  const [alert] = (await t.call('/api/parent/alerts', { token: parent.token })).body;
  assert.match(alert.body, /running ~\d+ min late/);
  await t.automation.checkLate(t.tracking.latest.get(bus.trip.bus_id));
  assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM late_alerts WHERE trip_id = $1`, [bus.trip.id])).rows[0].n, 1);
  await bus.end();
});

test('a holiday stops boarding questions, attendance sampling and bus alerts', async () => {
  const route = (await t.call('/api/routes/113')).body;
  const s = await student('113', route.stops[1].seq);
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  assert.equal((await t.call('/api/admin/calendar', { token: admin, body: { day: 'soon', title: 'x' } })).status, 400);
  const made = await t.call('/api/admin/calendar', { token: admin, body: { day: today, kind: 'HOLIDAY', title: 'Pongal' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.no_service, true);
  assert.equal((await t.call('/api/calendar')).body.today.title, 'Pongal');
  assert.equal((await t.call('/api/attendance/plan', { token: s.token })).body.shouldSample, false);

  const bus = await drive('113');
  const home = route.stops[1];
  await bus.fix(home);
  await bus.fix({ lat: home.lat + 0.004, lng: home.lng });
  assert.deepEqual((await t.call('/api/boarding-checks/pending', { token: s.token })).body, [], 'nobody is asked');
  assert.equal((await t.alternatives.sweep()).alerted, 0);
  await bus.end();

  assert.equal((await t.call(`/api/admin/calendar/${today}`, { token: admin, method: 'DELETE' })).status, 200);
  const exam = await t.call('/api/admin/calendar', { token: admin, body: { day: today, kind: 'EXAM', title: 'Exams', morningShift: 60 } });
  assert.equal(exam.body.no_service, false);
  assert.equal(await t.calendar.shift('UP'), 60);
  assert.equal(await t.calendar.shift('DOWN'), 0);
  await t.call(`/api/admin/calendar/${today}`, { token: admin, method: 'DELETE' });
});

test('an SOS or breakdown reaches parents: the route for a bus, one family for a student', async () => {
  const route = '114';
  const kid = await student(route, 3);
  const other = await student(route, 3);
  const code = async (s) => (await t.call('/api/guardians/code', { token: s.token, method: 'POST' })).body.code;
  const parent = (await t.call('/api/auth/register-parent', { body: parentBody(await code(kid)) })).body;
  const otherParent = (await t.call('/api/auth/register-parent', { body: parentBody(await code(other)) })).body;
  const alerts = async (p) => (await t.call('/api/parent/alerts', { token: p.token })).body;

  const driver = await t.login('drv114');
  assert.equal((await t.call('/api/driver/incidents', { token: driver, body: { kind: 'BREAKDOWN', message: 'Flat tyre at the bridge' } })).status, 201);
  assert.match((await alerts(parent))[0].title, /Breakdown: Bus 114/);
  assert.equal((await alerts(otherParent))[0].body, 'Flat tyre at the bridge');

  assert.equal((await t.call('/api/problems', { token: kid.token, body: { kind: 'SOS' } })).status, 201);
  assert.match((await alerts(parent))[0].title, /sent an SOS/);
  assert.equal((await alerts(otherParent)).length, 1, "another family's SOS stays private");
});

test('documents remind at 30 and 7 days, service by distance, and fuel gives a cost per km', async () => {
  const busId = (await t.db.query(`SELECT id FROM buses WHERE fleet_code = 'BSACIST-115'`)).rows[0].id;
  const inDays = (n) => new Date(Date.now() + 5.5 * 3600000 + n * 86400000).toISOString().slice(0, 10);
  assert.equal((await t.call(`/api/admin/buses/${busId}/documents/VISA`, { token: admin, method: 'PUT', body: { expiresOn: inDays(5) } })).status, 400);
  assert.equal((await t.call(`/api/admin/buses/${busId}/documents/INSURANCE`, { token: admin, method: 'PUT', body: { number: 'P-1', expiresOn: inDays(25) } })).status, 200);
  await t.call(`/api/admin/buses/${busId}/service`, { token: admin, method: 'PUT', body: { odometerKm: 9800, lastServiceKm: 0, serviceIntervalKm: 10000 } });
  const first = await t.fleetCare.sendReminders();
  assert.equal(first.sent, 2, 'the document and the service');
  assert.equal((await t.fleetCare.sendReminders()).sent, 0, 'once');
  await t.call(`/api/admin/buses/${busId}/documents/INSURANCE`, { token: admin, method: 'PUT', body: { number: 'P-1', expiresOn: inDays(6) } });
  assert.equal((await t.fleetCare.sendReminders()).sent, 1, 'again at 7 days');
  const card = (await t.call('/api/admin/fleet-care', { token: admin })).body.find((b) => b.id === busId);
  assert.equal(card.documents.find((d) => d.kind === 'INSURANCE').state, 'SOON');
  assert.equal(card.documents.find((d) => d.kind === 'PUC').state, 'MISSING');
  assert.equal(card.serviceState, 'SOON');
  assert.equal(card.kmLeft, 200);

  const driver = await t.login('drv115');
  assert.equal((await t.call('/api/fuel', { token: driver, body: { odometerKm: 100, litres: 40, costRupees: 3600 } })).status, 400, 'the odometer cannot go backwards');
  assert.equal((await t.call('/api/fuel', { token: driver, body: { odometerKm: 10000, litres: 40, costRupees: 3600 } })).status, 201);
  assert.equal((await t.call('/api/fuel', { token: driver, body: { odometerKm: 10400, litres: 50, costRupees: 4500 } })).status, 201);
  const { report } = (await t.call('/api/admin/fuel', { token: admin })).body;
  const row = report.buses.find((b) => b.fleetCode === 'BSACIST-115');
  assert.equal(row.km, 400);
  assert.equal(row.costPerKmPaise, 1125, 'the second fill paid for the 400 km');
  assert.equal(row.kmPerLitre, 8);
});

test('an expired paper and overdue service are insisted on every day', async () => {
  const busId = (await t.db.query(`SELECT id FROM buses WHERE fleet_code = 'BSACIST-117'`)).rows[0].id;
  const inDays = (n) => new Date(Date.now() + 5.5 * 3600000 + n * 86400000).toISOString().slice(0, 10);
  await t.call(`/api/admin/buses/${busId}/documents/PERMIT`, { token: admin, method: 'PUT', body: { number: 'EIB/1', expiresOn: inDays(-3) } });
  await t.call(`/api/admin/buses/${busId}/service`, { token: admin, method: 'PUT', body: { odometerKm: 12500, lastServiceKm: 0, serviceIntervalKm: 10000 } });
  const before = (await t.db.query(`SELECT count(*)::int AS n FROM incidents WHERE bus_id = $1`, [busId])).rows[0].n;
  await t.fleetCare.sendReminders();
  const sent = (await t.db.query(`SELECT message FROM incidents WHERE bus_id = $1 ORDER BY id DESC LIMIT 2`, [busId])).rows.map((r) => r.message).join(' | ');
  assert.match(sent, /Permit EXPIRED 3 days ago/);
  assert.match(sent, /service is OVERDUE by 2500 km/);
  await t.fleetCare.sendReminders();
  const after = (await t.db.query(`SELECT count(*)::int AS n FROM incidents WHERE bus_id = $1`, [busId])).rows[0].n;
  assert.equal(after - before, 2, 'once a day, not every minute');
  // Tomorrow's keys are new, so the reminders come back until it is fixed.
  const keys = (await t.db.query(`SELECT key FROM care_reminders WHERE key LIKE $1`, [`%:${busId}:%`])).rows.map((r) => r.key);
  assert.ok(keys.some((k) => k.includes(':expired:')) && keys.some((k) => k.includes(':due:')), 'keys carry the day');
});

test('the odometer moves by itself with each GPS trip, and a real reading resets it', async () => {
  const bus = (await t.db.query(`SELECT b.id, b.route_id, u.id AS driver_id FROM buses b JOIN users u ON u.bus_id = b.id AND u.role = 'driver' WHERE b.fleet_code = 'BSACIST-118'`)).rows[0];
  await t.call(`/api/admin/buses/${bus.id}/service`, { token: admin, method: 'PUT', body: { odometerKm: 50000 } });
  const trip = (await t.db.query(`INSERT INTO trips (bus_id, route_id, driver_id, status, ended_at) VALUES ($1, $2, $3, 'completed', now()) RETURNING id`, [bus.id, bus.route_id, bus.driver_id])).rows[0].id;
  // About 11 km north in 0.01-degree hops (~1.1 km each), one poor fix, and one 20 km jump (signal lost).
  const pts = Array.from({ length: 11 }, (_, i) => [12.9 + i * 0.01, 80.2, 10]);
  pts.splice(5, 0, [13.5, 80.9, 900]);
  pts.push([13.2, 80.2, 10]);
  for (const [i, [lat, lng, acc]] of pts.entries()) {
    await t.db.query(`INSERT INTO location_pings (trip_id, bus_id, lat, lng, accuracy_m, recorded_at) VALUES ($1, $2, $3, $4, $5, now() - make_interval(secs => $6))`, [trip, bus.id, lat, lng, acc, (pts.length - i) * 60]);
  }
  const km = await t.fleetCare.addTripDistance(trip, bus.id);
  assert.equal(km, 11, 'the poor fix and the jump are left out');
  let card = (await t.call('/api/admin/fleet-care', { token: admin })).body.find((b) => b.id === bus.id);
  assert.equal(card.odometerKm, 50011);
  assert.equal(card.odometerGpsKm, 11);
  // A fuel entry a little under the GPS estimate is the true reading, not "going backwards".
  const driver = await t.login('drv118');
  assert.equal((await t.call('/api/fuel', { token: driver, body: { odometerKm: 50009, litres: 30, costRupees: 2700 } })).status, 201);
  card = (await t.call('/api/admin/fleet-care', { token: admin })).body.find((b) => b.id === bus.id);
  assert.equal(card.odometerKm, 50009);
  assert.equal(card.odometerGpsKm, 0);
});

/** A one-page PDF with these lines of text (enough for a text layer to read). */
function tinyPdf(lines) {
  const stream = `BT /F1 12 Tf 50 750 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

test('the phone app can send a bus document for the server to read', async () => {
  const data = tinyPdf(['Motor Insurance - Package Policy', 'Policy No: 71110031260100009999', 'Registration No: TN 22 AB 4521', 'Period of Insurance: From 01/06/2026 To 31/05/2027']);
  const r = await t.call('/api/admin/documents/read', { token: admin, body: { data, mimeType: 'application/pdf', name: 'policy.pdf' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, 'INSURANCE');
  assert.equal(r.body.number, '71110031260100009999');
  assert.equal(r.body.expiresOn, '2027-05-31');
  assert.equal((await t.call('/api/admin/documents/read', { token: admin, body: { data: Buffer.from('hello').toString('base64'), mimeType: 'text/plain', name: 'a.txt' } })).status, 400);
  const driver = await t.login('drv119');
  assert.equal((await t.call('/api/admin/documents/read', { token: driver, body: { data } })).status, 403, 'office staff only');
});

test('a driver scorecard adds up ratings, speeding and failed checks', async () => {
  const s = await student('116', 3);
  const bus = await drive('116');
  await t.call('/api/attendance/manual', { token: bus.token, body: { tripId: bus.trip.id, username: s.username } });
  const a = bus.route.stops[0];
  await bus.fix(a, 90);
  await bus.fix({ lat: a.lat + 0.001, lng: a.lng }, 90);
  await bus.end();
  await t.call('/api/feedback', { token: s.token, body: { tripId: bus.trip.id, rating: 4 } });
  const results = Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, k !== 'FUEL']));
  await t.call('/api/driver/checklist', { token: bus.token, body: { results } });
  const cards = (await t.call('/api/admin/scorecards', { token: admin })).body;
  const card = cards.find((c) => c.fleetCode === 'BSACIST-116');
  assert.equal(card.trips, 1);
  assert.equal(card.speeding, 1);
  assert.equal(card.rating, 4);
  assert.equal(card.failedChecks, 1);
  assert.ok(card.score > 0 && card.score <= 100);
  assert.equal(cards.at(-1).score, null, 'a driver with no trips has no score yet');
});

test('stops nobody uses are flagged, with a nearby stop to merge into', async () => {
  const list = (await t.call('/api/admin/stop-suggestions', { token: admin })).body;
  assert.ok(list.length > 0);
  assert.ok(list.every((x) => x.students === 0 && x.stopName !== 'BSACIST'));
  const merge = list.find((x) => x.mergeInto);
  if (merge) assert.match(merge.suggestion, /Merge into/);
});

test('anyone can have a profile picture, and a student sees it on their pass', async () => {
  const s = await student('111', 3);
  const picture = 'data:image/jpeg;base64,BBBB';
  assert.equal((await t.call('/api/me/photo', { token: s.token })).body.photo, null);
  assert.equal((await t.call('/api/me/photo', { token: s.token, method: 'PUT', body: { photo: picture } })).status, 200);
  assert.equal((await t.call('/api/me/photo', { token: s.token })).body.photo, picture);
  assert.equal((await t.call('/api/pass', { token: s.token })).body.photo, picture);
  assert.equal((await t.call('/api/me/photo', { token: s.token, method: 'PUT', body: { photo: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await t.call('/api/me/photo', { token: admin, method: 'PUT', body: { photo: picture } })).status, 200);
  await t.call('/api/me/photo', { token: admin, method: 'PUT', body: { photo: null } });
  await t.call('/api/me/photo', { token: s.token, method: 'PUT', body: { photo: null } });
  assert.equal((await t.call('/api/pass', { token: s.token })).body.photo, null);
});

test('anyone can set the language, including a parent', async () => {
  const kid = await student('110', 3);
  const { body: made } = await t.call('/api/guardians/code', { token: kid.token, method: 'POST' });
  const { body: parent } = await t.call('/api/auth/register-parent', { body: parentBody(made.code) });
  const r = await t.call('/api/me/language', { token: parent.token, method: 'PUT', body: { language: 'ta' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.language, 'ta');
  assert.equal((await t.call('/api/me/language', { token: parent.token, method: 'PUT', body: { language: 'fr' } })).status, 400);
});
