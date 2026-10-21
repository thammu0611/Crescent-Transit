// GPS-based automatic attendance (doc section 9), end to end: a driver's bus
// and students' phones send fixes through the real API; the engine matches,
// prompts, records, closes and reports.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { PathWalker } from '../shared/geo.js';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());

/** Moves one bus along its real route and puts phones beside it. */
async function busOn(routeCode) {
  const route = (await t.call(`/api/routes/${routeCode}`)).body;
  const walker = new PathWalker(route.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
  const token = await t.login(`drv${routeCode.toLowerCase()}`);
  const started = await t.call('/api/driver/trips', { token, method: 'POST' });
  const trip = started.body.trip;
  const at = (d) => walker.at(d);
  return {
    token,
    trip,
    route,
    at,
    async fix(d, secs) {
      const p = at(d);
      const r = await t.call('/api/driver/locations', {
        token,
        body: { lat: p.lat, lng: p.lng, speedKmh: 30, heading: Math.round(p.heading), accuracyM: 8, recordedAt: secondsAgo(secs) },
      });
      assert.equal(r.status, 202, JSON.stringify(r.body));
    },
    async phone(student, d, secs, { offsetM = 10, extra = {} } = {}) {
      const p = at(d);
      const r = await t.call('/api/attendance/device-location', {
        token: student.token,
        body: {
          deviceId: student.deviceId,
          lat: p.lat + offsetM / 111320,
          lng: p.lng,
          speedKmh: 28,
          heading: Math.round(p.heading),
          accuracyM: 12,
          recordedAt: secondsAgo(secs),
          ...extra,
        },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    },
  };
}

/** Two co-located fixes 45 s apart: the boarding that triggers the prompt. */
async function board(bus, students, d0 = 2000, opts = {}) {
  await bus.fix(d0, 60);
  for (const s of students) assert.equal((await bus.phone(s, d0, 59, opts)).count, 1);
  await bus.fix(d0 + 375, 15);
  const out = [];
  for (const s of students) out.push(await bus.phone(s, d0 + 375, 14, opts));
  return out;
}

test('ride end to end: match twice -> one-tap prompt -> YES -> on board -> alights -> completed', async () => {
  const s = await t.rider('118');
  const socket = connect(t.url, { transports: ['websocket'], auth: { token: s.token } });
  const prompts = [];
  socket.on('attendance:prompt', (p) => prompts.push(p));
  await new Promise((resolve) => socket.on('connect', resolve));

  const bus = await busOn('118');
  const [r] = await board(bus, [s]);
  assert.equal(r.prompted, true, JSON.stringify(r));
  assert.equal(r.prompt.fleetCode, 'BSACIST-118');
  assert.ok(r.prompt.stopName, 'boarding stop is known');

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(prompts.length, 1, 'the prompt is pushed to the phone');
  const pending = (await t.call('/api/attendance/pending', { token: s.token })).body;
  assert.equal(pending.length, 1, 'and waits in the app if notifications are off');

  const yes = await t.call(`/api/attendance/${r.prompt.attendanceId}/confirm`, { token: s.token, body: { answer: 'YES' } });
  assert.equal(yes.body.status, 'CONFIRMED');
  assert.equal((await t.call(`/api/attendance/${r.prompt.attendanceId}/confirm`, { token: s.token, body: { answer: 'NO' } })).status, 409, 'one answer only');

  await bus.fix(2458, 5);
  assert.equal((await bus.phone(s, 2458, 4)).status, 'ON_BOARD');

  // The phone is now 300 m from the bus, twice in a row: alighted.
  await bus.fix(2500, 3);
  assert.equal((await bus.phone(s, 2500, 2, { offsetM: 300 })).alighted, undefined);
  const closed = await bus.phone(s, 2500, 1, { offsetM: 300 });
  assert.equal(closed.alighted, true);
  assert.equal(closed.status, 'COMPLETED');

  const list = (await t.call(`/api/trips/${bus.trip.id}/attendance`, { token: bus.token })).body;
  assert.equal(list.records.length, 1);
  assert.equal(list.records[0].status, 'COMPLETED');
  assert.ok(list.records[0].alighting_stop);

  const mine = (await t.call('/api/attendance/me', { token: s.token })).body;
  assert.equal(mine.tripsPresent, 1);
  assert.equal(mine.records[0].present, true);
  assert.ok(Number(mine.records[0].confidence) > 0.5);

  // No trace of the phone's coordinates is stored anywhere (doc 9.2).
  const cols = await t.db.query(
    `SELECT table_name FROM information_schema.columns WHERE table_name LIKE 'attendance%' AND column_name IN ('lat', 'lng', 'latitude', 'longitude')`,
  );
  assert.equal(cols.rows.length, 0);
  socket.close();
});

test('answering NO writes REJECTED; the prompt is never repeated for that trip', async () => {
  const s = await t.rider('119');
  const bus = await busOn('119');
  const [r] = await board(bus, [s]);
  const no = await t.call(`/api/attendance/${r.prompt.attendanceId}/confirm`, { token: s.token, body: { answer: 'NO' } });
  assert.equal(no.body.status, 'REJECTED');
  await bus.fix(2458, 5);
  const again = await bus.phone(s, 2458, 4);
  assert.notEqual(again.prompted, true);
  const mine = (await t.call('/api/attendance/me', { token: s.token })).body;
  assert.equal(mine.tripsPresent, 0);
});

test('the engine refuses phones without consent, the wrong phone, or no subscription', async () => {
  const s = await t.rider('118');
  const wrong = await t.call('/api/attendance/device-location', { token: s.token, body: { deviceId: 'another-phone-123', lat: 12.9, lng: 80.2, recordedAt: secondsAgo(1) } });
  assert.equal(wrong.body.code, 'DEVICE_NOT_BOUND');
  await t.call('/api/me', { token: s.token, method: 'PATCH', body: { locationConsent: false } });
  const noConsent = await t.call('/api/attendance/device-location', { token: s.token, body: { deviceId: s.deviceId, lat: 12.9, lng: 80.2, recordedAt: secondsAgo(1) } });
  assert.equal(noConsent.body.code, 'CONSENT_REQUIRED');
  const free = await t.newStudent('118');
  assert.equal((await t.call('/api/attendance/device-location', { token: free.token, body: {} })).status, 402);
});

test('outside the travel window the phone is told not to sample', async () => {
  const s = await t.rider('118');
  // A one-minute window twelve hours from now.
  const h = (new Date().getUTCHours() + 5 + 12) % 24;
  await t.call('/api/me', { token: s.token, method: 'PATCH', body: { travelWindows: `${String(h).padStart(2, '0')}:00-${String(h).padStart(2, '0')}:01` } });
  const r = await t.call('/api/attendance/device-location', { token: s.token, body: { deviceId: s.deviceId, lat: 12.9, lng: 80.2, recordedAt: secondsAgo(1) } });
  assert.equal(r.body.reason, 'OUTSIDE_TRAVEL_WINDOW');
  const plan = (await t.call('/api/attendance/plan', { token: s.token })).body;
  assert.equal(plan.shouldSample, false);
});

test('no answer: PROVISIONAL after strong co-location, dropped otherwise; flagged records never auto-confirm', async () => {
  const [strong, weak, mocked] = [await t.rider('117'), await t.rider('117'), await t.rider('117')];
  const bus = await busOn('117');
  // The third phone reports a mock location.
  const mock = { extra: { mockLocation: true } };
  await bus.fix(2000, 60);
  for (const s of [strong, weak]) await bus.phone(s, 2000, 59);
  await bus.phone(mocked, 2000, 59, mock);
  await bus.fix(2375, 15);
  for (const s of [strong, weak]) assert.equal((await bus.phone(s, 2375, 14)).prompted, true);
  assert.equal((await bus.phone(mocked, 2375, 14, mock)).prompted, true);

  // Time passes: 4 minutes without an answer.
  await t.db.query(`UPDATE attendance SET prompted_at = now() - interval '4 minutes' WHERE trip_id = $1`, [bus.trip.id]);
  await t.db.query(
    `UPDATE attendance a SET last_match_at = first_match_at + interval '100 seconds'
       FROM users u WHERE u.id = a.user_id AND u.username = ANY($1)`,
    [[strong.username, mocked.username]],
  );
  const tick = await t.jobs.run('tick');
  assert.deepEqual({ p: tick.provisional, d: tick.dropped }, { p: 2, d: 1 });

  const rows = (await t.db.query(
    `SELECT u.username, a.status, a.flagged FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.trip_id = $1`,
    [bus.trip.id],
  )).rows;
  const by = Object.fromEntries(rows.map((r) => [r.username, r]));
  assert.equal(by[strong.username].status, 'PROVISIONAL');
  assert.equal(by[mocked.username].flagged, true);
  assert.equal(by[weak.username], undefined, 'weak co-location is dropped');

  // The student can still answer from the app within 30 minutes.
  const pending = (await t.call('/api/attendance/pending', { token: strong.token })).body;
  assert.equal(pending.length, 1);

  // 72 hours later: the clean one is auto-confirmed, the flagged one is not.
  await t.db.query(`UPDATE attendance SET prompted_at = now() - interval '73 hours' WHERE trip_id = $1`, [bus.trip.id]);
  const nightly = await t.jobs.run('nightly');
  assert.equal(nightly.attendance.autoConfirmed, 1);
  const after = Object.fromEntries((await t.db.query(
    `SELECT u.username, a.status, a.auto_confirmed FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.trip_id = $1`,
    [bus.trip.id],
  )).rows.map((r) => [r.username, r]));
  assert.equal(after[strong.username].auto_confirmed, true);
  assert.equal(after[mocked.username].status, 'PROVISIONAL');

  // The admin reviews the flagged one, with the evidence, and voids it.
  const admin = await t.login('admin');
  const queue = (await t.call('/api/admin/attendance/review', { token: admin })).body;
  const item = queue.find((q) => q.username === mocked.username);
  assert.ok(item.evidence.some((e) => e.event_type === 'MATCH' && e.distance_m !== null));
  assert.equal((await t.call(`/api/admin/attendance/${item.attendance_id}/resolve`, { token: admin, body: { decision: 'VOID' } })).status, 400, 'reason required');
  const voided = await t.call(`/api/admin/attendance/${item.attendance_id}/resolve`, { token: admin, body: { decision: 'VOID', reason: 'Mock location' } });
  assert.equal(voided.body.status, 'VOID');
  const incidents = (await t.call('/api/admin/incidents', { token: admin })).body;
  assert.ok(incidents.some((i) => i.kind === 'MOCK_LOCATION'));
});

test('fallbacks: driver list, QR code, capacity check, trip end, disputes, leakage', async () => {
  const admin = await t.login('admin');
  const bus = await busOn('127');
  await bus.fix(1500, 20);
  const noPhone = await t.newStudent('127'); // no subscription, no smartphone
  const qr = await t.rider('127');

  // Driver of another bus cannot mark students on this trip.
  const other = await t.login('drv118');
  assert.equal((await t.call('/api/attendance/manual', { token: other, body: { tripId: bus.trip.id, username: noPhone.username } })).status, 403);

  // The in-bus code rotates every minute; a wrong code is refused.
  const code = (await t.call('/api/driver/boarding-code', { token: bus.token })).body;
  const scannedAt = new Date().toISOString(); // scanned now, uploaded later
  assert.match(code.code, /^\d{6}$/);
  const wrongCode = code.code === '000000' ? '111111' : '000000';
  assert.equal((await t.call('/api/attendance/qr', { token: qr.token, body: { tripId: bus.trip.id, code: wrongCode } })).status, 400);
  // Scanned while offline and replayed when the network returns.
  const scan = await t.call('/api/attendance/qr', { token: qr.token, body: { payload: code.qrPayload, scannedAt } });
  assert.equal(scan.status, 201, JSON.stringify(scan.body));
  assert.equal(scan.body.status, 'ON_BOARD');

  // One seat left over: the second student on board breaches capacity.
  const busId = (await t.db.query('SELECT bus_id FROM trips WHERE id = $1', [bus.trip.id])).rows[0].bus_id;
  assert.equal((await t.call(`/api/admin/buses/${busId}`, { token: admin, method: 'PATCH', body: { capacity: 1 } })).status, 200);
  const manual = await t.call('/api/attendance/manual', { token: bus.token, body: { tripId: bus.trip.id, username: noPhone.username } });
  assert.equal(manual.body.status, 'ON_BOARD');
  const list = (await t.call(`/api/trips/${bus.trip.id}/attendance`, { token: bus.token })).body;
  assert.equal(list.onBoard, 2);
  assert.deepEqual(list.records.map((r) => r.method).sort(), ['MANUAL', 'QR']);
  const incidents = (await t.call('/api/admin/incidents', { token: admin })).body;
  assert.ok(incidents.some((i) => i.kind === 'CAPACITY_BREACH' && i.trip_id === bus.trip.id));

  // Ending the trip closes every open record.
  await t.call(`/api/driver/trips/${bus.trip.id}/end`, { token: bus.token, method: 'POST' });
  const closed = (await t.call(`/api/trips/${bus.trip.id}/attendance`, { token: admin })).body.records;
  assert.ok(closed.every((r) => r.status === 'COMPLETED' && r.alighted_at));

  // The student disputes; the admin decides with a reason.
  const rec = (await t.call('/api/attendance/me', { token: qr.token })).body.records[0];
  const d = await t.call(`/api/attendance/${rec.attendance_id}/dispute`, { token: qr.token, body: { reason: 'I got off before the bus left', claimedPresent: false } });
  assert.equal(d.body.status, 'DISPUTED');
  const resolved = await t.call(`/api/admin/attendance/${rec.attendance_id}/resolve`, { token: admin, body: { decision: 'ABSENT', reason: 'Driver confirms' } });
  assert.equal(resolved.body.status, 'ADJUSTED');
  assert.equal((await t.call('/api/attendance/me', { token: qr.token })).body.records[0].present, false);

  // Disputes close after seven days.
  const stale = (await t.db.query('SELECT attendance_id FROM attendance WHERE trip_id = $1 AND method = $2', [bus.trip.id, 'MANUAL'])).rows[0];
  await t.db.query(`UPDATE attendance SET boarded_at = now() - interval '8 days' WHERE attendance_id = $1`, [stale.attendance_id]);
  assert.equal((await t.call(`/api/attendance/${stale.attendance_id}/dispute`, { token: noPhone.token, body: { reason: 'Too late now' } })).status, 409);
  await t.db.query(`UPDATE attendance SET boarded_at = now() WHERE attendance_id = $1`, [stale.attendance_id]);

  // The unpaid traveller shows up in the subscriber-vs-traveller report.
  const leak = (await t.call('/api/reports/leakage', { token: admin })).body;
  assert.ok(leak.some((l) => l.username === noPhone.username));
  assert.ok(!leak.some((l) => l.username === qr.username));
});

test('the bus tracker dies mid-trip: open records close at the last position and the trip is flagged', async () => {
  const s = await t.rider('101');
  const bus = await busOn('101');
  const [r] = await board(bus, [s]);
  await t.call(`/api/attendance/${r.prompt.attendanceId}/confirm`, { token: s.token, body: { answer: 'YES' } });

  // Eleven minutes of silence from the tracker.
  const snap = [...t.tracking.latest.values()].find((b) => b.tripId === bus.trip.id);
  snap.recordedAt = new Date(Date.now() - 11 * 60000).toISOString();
  const tick = await t.jobs.run('tick');
  assert.equal(tick.trackerClosed, 1);
  const rec = (await t.db.query('SELECT status, alighted_at FROM attendance WHERE attendance_id = $1', [r.prompt.attendanceId])).rows[0];
  assert.equal(rec.status, 'COMPLETED');
  assert.ok(rec.alighted_at);
  const trip = (await t.db.query('SELECT flagged, flag_reason FROM trips WHERE id = $1', [bus.trip.id])).rows[0];
  assert.deepEqual(trip, { flagged: true, flag_reason: 'TRACKER_OFFLINE' });
  await t.call(`/api/driver/trips/${bus.trip.id}/end`, { token: bus.token, method: 'POST' });
});

test('moving the account to another phone needs a one-time code', async () => {
  const s = await t.rider('118');
  const moved = await t.call('/api/devices/bind', { token: s.token, body: { deviceId: 'brand-new-phone-1', platform: 'ANDROID' } });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.code, 'OTP_REQUIRED');
  assert.equal((await t.call('/api/devices/bind', { token: s.token, body: { deviceId: 'brand-new-phone-1', otp: '000000' } })).status, 400);
  const ok = await t.call('/api/devices/bind', { token: s.token, body: { deviceId: 'brand-new-phone-1', otp: moved.body.devOtp } });
  assert.equal(ok.body.moved, true);
});

test('registers, exports and precision/recall against a manual register', async () => {
  const admin = await t.login('admin');
  const csv = await t.call('/api/reports/attendance?format=csv', { token: admin });
  assert.match(csv.body.toString(), /^date,trip_id,route,bus,username/);
  const byStudent = (await t.call('/api/reports/attendance?group=student', { token: admin })).body;
  assert.ok(byStudent.length >= 3);

  // The GPS register of the route-118 trip against a hand count that also saw
  // one student the phones missed.
  const trip = (await t.db.query(`SELECT a.trip_id, u.username FROM attendance a JOIN users u ON u.id = a.user_id JOIN trips t ON t.id = a.trip_id JOIN routes r ON r.id = t.route_id WHERE r.code = '118' AND a.status = 'COMPLETED'`)).rows[0];
  const manual = `trip_id,username\n${trip.trip_id},${trip.username}\n${trip.trip_id},somebody_else\n`;
  const acc = (await t.call('/api/reports/attendance-accuracy', { token: admin, body: { csv: manual } })).body;
  assert.equal(acc.precisionPct, 100);
  assert.equal(acc.recallPct, 50);
  assert.equal(acc.truePositives, 1);

  const exceptions = (await t.call('/api/reports/exceptions', { token: admin })).body;
  assert.ok(exceptions.manualOverrides.length >= 1);
  assert.ok(exceptions.flaggedTrips.some((f) => f.flag_reason === 'TRACKER_OFFLINE'));
  const demand = (await t.call('/api/reports/demand', { token: admin })).body;
  assert.ok(demand.length >= 1);
  const kpis = (await t.call('/api/admin/kpis', { token: admin })).body;
  assert.ok(kpis.presentToday >= 3);
});
