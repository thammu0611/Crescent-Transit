// Running the system for real: retention, backups, monitoring, privacy rights,
// the yearly roster and the security settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { io as connect } from 'socket.io-client';
import { busLabel } from '../shared/institution.js';
import { passwordProblem } from '../shared/password.js';
import { BackupService, orderedTables, restoreBackup, signV4, verifyBackup, writeBackup } from '../server/backup.js';
import { openDatabase } from '../server/db.js';
import { purgeOld } from '../server/housekeeping.js';
import { PASSWORD, startTestServer } from './helpers.js';

let t;
let admin;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ops-'));

before(async () => {
  t = await startTestServer({
    backup: { enabled: true, dir: tmp, keep: 2, at: '00:00', key: null, s3: null },
    monitor: { alertEmail: null, webhookUrl: null, repeatMinutes: 30, silentMinutes: 5, missedStartMinutes: 15, serviceDays: [0, 1, 2, 3, 4, 5, 6], watchBuses: true },
  });
  admin = await t.login('admin');
});
after(async () => {
  await t.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function student() {
  const s = await t.newStudent();
  const { rows } = await t.db.query('SELECT id FROM users WHERE username = $1', [s.username]);
  return { ...s, id: rows[0].id };
}

const count = async (db, table, where = 'TRUE') => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n;

async function pastTrip() {
  const { rows } = await t.db.query(
    `INSERT INTO trips (bus_id, route_id, driver_id, status, started_at, ended_at, direction)
     SELECT b.id, b.route_id, u.id, 'completed', now() - interval '500 days', now() - interval '500 days', 'UP'
       FROM buses b JOIN users u ON u.bus_id = b.id ORDER BY b.id LIMIT 1
     RETURNING id, bus_id, route_id`,
  );
  return rows[0];
}

test('old location history is removed and recent history stays', async () => {
  const trip = await pastTrip();
  const insert = (age) => t.db.query(
    `INSERT INTO location_pings (trip_id, bus_id, lat, lng, recorded_at) VALUES ($1, $2, 12.9, 80.1, now() - make_interval(days => $3))`,
    [trip.id, trip.bus_id, age],
  );
  await insert(120);
  await insert(91);
  await insert(10);
  await t.db.query(`INSERT INTO rejected_pings (bus_id, reason, received_at) VALUES ($1, 'TEST', now() - interval '40 days')`, [trip.bus_id]);
  const r = await purgeOld(t.db, t.config);
  assert.equal(r.locations, 2);
  assert.equal(r.rejected, 1);
  assert.equal(await count(t.db, 'location_pings', `trip_id = ${trip.id}`), 1);
});

test('the nightly job applies the clean-up', async () => {
  const r = await t.jobs.run('nightly');
  assert.ok(r.retention, 'retention ran');
});

test('attendance older than a year survives only as monthly totals', async () => {
  const s = await student();
  const trip = await pastTrip();
  await t.db.query(
    `INSERT INTO attendance (user_id, trip_id, bus_id, status, locked, created_at) VALUES ($1, $2, $3, 'COMPLETED', TRUE, now() - interval '500 days')`,
    [s.id, trip.id, trip.bus_id],
  );
  await purgeOld(t.db, t.config);
  assert.equal(await count(t.db, 'attendance', `user_id = ${s.id}`), 0);
  const totals = await t.db.query('SELECT records, present FROM attendance_totals WHERE route_id = $1', [trip.route_id]);
  assert.equal(totals.rows[0].records, 1);
  assert.equal(totals.rows[0].present, 1);
});

test('a backup restores every row into an empty database', async () => {
  await student();
  const file = path.join(tmp, 'plain.ndjson.gz');
  const written = await writeBackup(t.db, file);
  assert.ok(written.rows > 100);
  const copy = await openDatabase({ databaseUrl: null, dataDir: null });
  try {
    await restoreBackup(copy, file);
    for (const table of await orderedTables(t.db)) {
      assert.equal(await count(copy, table), await count(t.db, table), table);
    }
    const original = (await t.db.query(`SELECT username, password_hash, created_at::text AS at FROM users ORDER BY id DESC LIMIT 1`)).rows[0];
    const restored = (await copy.query(`SELECT username, password_hash, created_at::text AS at FROM users ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.deepEqual(restored, original);
    // New rows carry on after the highest restored id.
    const { rows } = await copy.query(`INSERT INTO notifications (kind, title, message) VALUES ('ANNOUNCEMENT', 'x', 'y') RETURNING id`);
    assert.ok(rows[0].id > 0);
  } finally {
    await copy.close();
  }
});

test('an encrypted backup needs its key, and a damaged file is refused', async () => {
  const file = path.join(tmp, 'secret.ndjson.enc');
  await writeBackup(t.db, file, { key: 'a-long-backup-key' });
  assert.ok((await verifyBackup(file, { key: 'a-long-backup-key' })).rows > 100);
  await assert.rejects(verifyBackup(file), /encrypted/);
  await assert.rejects(verifyBackup(file, { key: 'the-wrong-key' }));
  const bytes = fs.readFileSync(file);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  const damaged = path.join(tmp, 'damaged.ndjson.enc');
  fs.writeFileSync(damaged, bytes);
  await assert.rejects(verifyBackup(damaged, { key: 'a-long-backup-key' }));
});

test('the backup job records its run and keeps only the newest files', async () => {
  const backups = new BackupService(t.db, t.config);
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(tmp, `crescent-2020010${i}-000000.ndjson.gz`), 'old');
  }
  assert.equal(await backups.due(), true);
  const r = await backups.run();
  assert.ok(fs.existsSync(r.file));
  assert.equal(await backups.due(), false);
  assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith('crescent-')).length, 2);
  const health = await t.call('/api/admin/system', { token: admin });
  assert.equal(health.status, 200);
  assert.ok(health.body.backup.finished_at);
  assert.ok(health.body.problems.some((p) => /Nobody is alerted/.test(p)));
});

test('offsite upload signing matches the AWS published example', () => {
  const { signature } = signV4({
    method: 'GET',
    path: '/test.txt',
    headers: {
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date': '20130524T000000Z',
    },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    amzDate: '20130524T000000Z',
  });
  assert.equal(signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('a bus that goes silent opens one alert, and closes when it reports again', async () => {
  const { rows: [bus] } = await t.db.query(`SELECT b.id, b.route_id, u.id AS driver FROM buses b JOIN users u ON u.bus_id = b.id ORDER BY b.id DESC LIMIT 1`);
  const { rows: [trip] } = await t.db.query(
    `INSERT INTO trips (bus_id, route_id, driver_id, status, started_at, direction) VALUES ($1, $2, $3, 'active', now() - interval '20 minutes', 'UP') RETURNING id`,
    [bus.id, bus.route_id, bus.driver],
  );
  const sent = [];
  const realDeliver = t.monitor.deliver;
  t.monitor.deliver = async (subject) => { sent.push(subject); };
  await t.monitor.silentBuses();
  await t.monitor.silentBuses();
  assert.equal(sent.filter((s) => /has sent no location/.test(s)).length, 1, 'sent once');
  let open = (await t.call('/api/admin/system', { token: admin })).body.alerts;
  assert.ok(open.some((a) => a.key === `silent:${trip.id}`));
  await t.db.query(
    `INSERT INTO bus_latest (bus_id, trip_id, lat, lng, recorded_at, received_at) VALUES ($1, $2, 12.9, 80.1, now(), now())
     ON CONFLICT (bus_id) DO UPDATE SET trip_id = EXCLUDED.trip_id, received_at = now()`,
    [bus.id, trip.id],
  );
  await t.monitor.silentBuses();
  open = (await t.call('/api/admin/system', { token: admin })).body.alerts;
  assert.ok(!open.some((a) => a.key === `silent:${trip.id}`));
  await t.db.query(`UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1`, [trip.id]);
  t.monitor.deliver = realDeliver;
});

test('buses that have not started are reported together, not on a day off', async () => {
  const monitor = t.monitor;
  const nine = new Date('2030-01-07T04:30:00Z'); // a Monday, 10:00 in India
  await t.db.query(`DELETE FROM system_alerts WHERE kind = 'missed-start'`);
  monitor.settings = { ...monitor.settings, missedStartMinutes: 15 };
  // 10:00: every route's start is within the last two hours or further back; some must be late.
  const late = await monitor.missedStarts(new Date('2030-01-07T01:30:00Z')); // 07:00
  assert.ok(late > 0, 'late buses found');
  assert.equal(await monitor.missedStarts(new Date('2030-01-07T01:30:00Z')), 0, 'not repeated');
  await t.db.query(`INSERT INTO special_days (day, kind, title, no_service) VALUES ('2030-01-08', 'HOLIDAY', 'Pongal', TRUE)`);
  monitor.calendar.cached.clear();
  assert.equal(await monitor.missedStarts(new Date('2030-01-08T01:30:00Z')), 0, 'holiday');
  assert.ok(nine);
});

test('an unexpected server error reaches the event log', async () => {
  await t.monitor.capture('server', new Error('database exploded'), 'GET /x');
  const { rows } = await t.db.query(`SELECT message, detail FROM system_events WHERE source = 'server' ORDER BY id DESC LIMIT 1`);
  assert.match(rows[0].message, /GET \/x: database exploded/);
  assert.match(rows[0].detail, /operations\.test/);
  assert.ok((await t.call('/api/admin/system', { token: admin })).body.errors24h >= 1);
});

test('a student downloads their own data, with no password in it', async () => {
  const s = await student();
  const r = await t.call('/api/me/export', { token: s.token });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal(r.body.profile.username, s.username);
  assert.ok(!JSON.stringify(r.body).includes('password_hash'));
  assert.ok(Array.isArray(r.body.attendance));
  assert.equal((await t.call('/api/me/export')).status, 401);
});

test('deleting an account removes the person and keeps the payment record', async () => {
  const s = await student();
  await t.subscribe(s.token);
  await t.db.query(
    `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, 'ExponentPushToken[x]', 'ANDROID')`,
    [s.id],
  ).catch(() => {});
  assert.equal((await t.call('/api/me/delete', { token: s.token, body: { password: 'wrong' } })).status, 400);
  assert.equal((await t.call('/api/me/delete', { token: s.token, body: { password: 'Route-pass-123' } })).status, 200);
  const { rows: [u] } = await t.db.query('SELECT * FROM users WHERE id = $1', [s.id]);
  assert.equal(u.status, 'deleted');
  assert.equal(u.full_name, 'Deleted user');
  assert.equal(u.email, null);
  assert.equal(u.register_no, null);
  assert.equal(await count(t.db, 'push_tokens', `user_id = ${s.id}`), 0);
  assert.equal((await t.call('/api/me', { token: s.token })).status === 200, false, 'old session stops');
  assert.equal((await t.call('/api/auth/login', { body: { username: s.username, password: 'Route-pass-123' } })).status, 401);
  assert.ok(await count(t.db, 'payments', `user_id = ${s.id}`) > 0, 'the payment record stays');
  // The name is free again.
  const again = await t.call('/api/auth/register', { body: { username: s.username, email: `${s.username}@test.edu`, fullName: 'Back Again', password: 'Route-pass-123', department: 'CA' } });
  assert.equal(again.status, 201);
});

test('staff cannot delete their own account', async () => {
  assert.equal((await t.call('/api/me/delete', { token: admin, body: { password: PASSWORD } })).status, 403);
});

const STUDENTS = `register_no,full_name,email,department,route,stop,graduation_year
2026CS001,Asha Ram,asha@test.edu,CSE,118,Ram Nagar,2027
2026CS002,"Vel, Murugan",vel@test.edu,CSE,118,Nowhere Stop,2030
,No Number,nonum@test.edu,CSE,118,,2030
2026CS004,Bad Route,badroute@test.edu,CSE,999,,2030
`;

test('a student list is previewed first, then applied', async () => {
  const preview = await t.call('/api/admin/roster/students', { token: admin, body: { csv: STUDENTS } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.committed, false);
  assert.deepEqual(
    { create: preview.body.summary.create, skip: preview.body.summary.skip, warnings: preview.body.summary.warnings },
    { create: 2, skip: 2, warnings: 1 },
  );
  assert.equal(await count(t.db, 'users', `register_no = '2026CS001'`), 0, 'preview changes nothing');

  const done = await t.call('/api/admin/roster/students', { token: admin, body: { csv: STUDENTS, commit: true } });
  assert.equal(done.body.committed, true);
  const { rows: [asha] } = await t.db.query(`SELECT * FROM users WHERE register_no = '2026CS001'`);
  assert.equal(asha.username, '2026cs001');
  assert.equal(asha.graduation_year, 2027);
  assert.ok(asha.home_stop_seq, 'stop matched by name');
  assert.ok(asha.email_verified_at);

  // Forgot password is how they first get in; nobody knows the random one.
  assert.equal((await t.call('/api/auth/login', { body: { username: '2026cs001', password: 'Route-pass-123' } })).status, 401);

  const again = await t.call('/api/admin/roster/students', { token: admin, body: { csv: STUDENTS.replace('Asha Ram', 'Asha R'), commit: true } });
  assert.equal(again.body.summary.update, 2);
  assert.equal(again.body.summary.create, 0);
  assert.equal((await t.db.query(`SELECT full_name FROM users WHERE register_no = '2026CS001'`)).rows[0].full_name, 'Asha R');
});

test('only an administrator can import', async () => {
  const s = await student();
  assert.equal((await t.call('/api/admin/roster/students', { token: s.token, body: { csv: STUDENTS } })).status, 403);
  assert.equal((await t.call('/api/admin/roster/students', { body: { csv: STUDENTS } })).status, 401);
});

test('a new route circular keeps students on stops that stay, by name', async () => {
  const { rows: stops } = await t.db.query(
    `SELECT s.name, s.scheduled_time, s.lat, s.lng FROM stops s JOIN routes r ON r.id = s.route_id WHERE r.code = '118' ORDER BY s.seq`,
  );
  const ram = stops.find((s) => s.name === 'Ram Nagar');
  const first = stops[0];
  const csv = ['route,route_name,stop_name,time,lat,lng',
    `118,New Velachery,New First Stop,6.40 AM,12.97,80.21`,
    `118,New Velachery,${ram.name},${ram.scheduled_time},,`,
    `118,New Velachery,BSACIST,8.30 AM,12.8737,80.0823`,
    `777,Brand New,Start Point,7.00 AM,12.90,80.10`,
    `777,Brand New,BSACIST,8.00 AM,12.8737,80.0823`].join('\n');
  const preview = await t.call('/api/admin/roster/routes', { token: admin, body: { csv } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.committed, false);
  assert.equal(preview.body.problems.length, 0);
  const route118 = preview.body.changes.find((c) => c.code === '118');
  assert.ok(route118.removed > 0);
  assert.ok(preview.body.missing.length > 20, 'routes not in the file are listed');

  const done = await t.call('/api/admin/roster/routes', { token: admin, body: { csv, commit: true } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const { rows: now } = await t.db.query(`SELECT s.seq, s.name FROM stops s JOIN routes r ON r.id = s.route_id WHERE r.code = '118' ORDER BY s.seq`);
  assert.deepEqual(now.map((s) => s.name), ['New First Stop', 'Ram Nagar', 'BSACIST']);
  const { rows: [asha] } = await t.db.query(`SELECT home_stop_seq FROM users WHERE register_no = '2026CS001'`);
  assert.equal(asha.home_stop_seq, 2, 'followed the stop to its new place');
  assert.equal(await count(t.db, 'routes', `code = '777' AND active`), 1);
  assert.ok(first);

  const bad = await t.call('/api/admin/roster/routes', { token: admin, body: { csv: 'route,stop_name,time\n118,Somewhere New,6.00 AM\n', commit: true } });
  assert.equal(bad.status, 400);
});

test('end of year: graduates stop signing in, or are removed', async () => {
  const preview = await t.call('/api/admin/roster/rollover', { token: admin, body: { graduationYear: 2027 } });
  assert.equal(preview.body.students, 1);
  assert.equal((await t.db.query(`SELECT status FROM users WHERE register_no = '2026CS001'`)).rows[0].status, 'active');

  await t.call('/api/admin/roster/rollover', { token: admin, body: { graduationYear: 2027, commit: true } });
  assert.equal((await t.db.query(`SELECT status FROM users WHERE register_no = '2026CS001'`)).rows[0].status, 'graduated');

  const removed = await t.call('/api/admin/roster/rollover', { token: admin, body: { graduationYear: 2027, action: 'delete', commit: true } });
  assert.equal(removed.body.students, 1);
  assert.equal(await count(t.db, 'users', `register_no = '2026CS001'`), 0);
  assert.equal(await count(t.db, 'users', `username = '2026cs001'`), 0);
  assert.ok((await t.call('/api/admin/roster/summary', { token: admin })).status === 200);
});

test('the live connection refuses other websites', async () => {
  const attempt = (origin) => new Promise((resolve) => {
    const socket = connect(t.url, { transports: ['websocket'], reconnection: false, timeout: 2000, extraHeaders: origin ? { origin } : {} });
    socket.on('connect', () => { socket.close(); resolve(true); });
    socket.on('connect_error', () => { socket.close(); resolve(false); });
  });
  assert.equal(await attempt('https://evil.example'), false);
  assert.equal(await attempt(t.url), true);
  assert.equal(await attempt(null), true, 'phone apps send no origin');
});

test('pages carry a Content-Security-Policy', async () => {
  const r = await fetch(`${t.url}/api/health`);
  const policy = r.headers.get('content-security-policy');
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /checkout\.razorpay\.com/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));
});

test('the password rule', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletterslong'));
  assert.ok(passwordProblem('1234567890123'));
  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('Crescent2026'));
  assert.ok(passwordProblem('rahul.kumar-99', { username: 'rahul.kumar' }));
  assert.equal(passwordProblem('Route-pass-123'), null);
  assert.equal(passwordProblem('நீலபேருந்து2026'), null);
});

test('a weak password is refused when registering', async () => {
  const r = await t.call('/api/auth/register', { body: { username: 'weakone', email: 'weakone@test.edu', fullName: 'Weak One', password: 'password1', department: 'CA' } });
  assert.equal(r.status, 400);
});

test('bus names do not depend on the college', () => {
  assert.equal(busLabel('BSACIST-118'), 'Bus 118');
  assert.equal(busLabel('SRM-104A'), 'Bus 104A');
  assert.equal(busLabel('118'), '118');
});

test('the college comes from settings', async () => {
  const r = await t.call('/api/institution');
  assert.equal(r.status, 200);
  assert.equal(r.body.shortName, 'BSACIST');
});
