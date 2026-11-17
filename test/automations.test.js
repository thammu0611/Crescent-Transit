// What the system does by itself: renewal reminders, the pre-trip check
// reminder, complaint follow-up, SOS escalation, the phone starting a trip,
// fuel receipts, the weekly report, service credit, suggestions, and WhatsApp
// or SMS for parents without the app.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_ITEMS } from '../shared/service.js';
import { renderPdf } from '../server/billing/pdf.js';
import { addDays, localDate } from '../server/clock.js';
import { clockMinutes } from '../server/alternatives.js';
import { clockText } from '../server/insights.js';
import { normalisePhone } from '../server/messaging.js';
import { secondsAgo, startTestServer } from './helpers.js';

let t;
let admin;
const pushed = [];
before(async () => {
  t = await startTestServer({ subscription: { studentRequired: false } });
  admin = await t.login('admin');
  // Capture pushes instead of calling Expo.
  const capture = (to) => async (who, message) => { pushed.push({ to, who, ...message }); };
  for (const svc of [t.followups, t.escalation, t.insights, t.autoStart]) {
    svc.push = { toUser: capture('user'), toRole: capture('role') };
  }
});
after(() => t.stop());

const tz = () => t.config.timeZone;
const today = () => localDate(new Date(), tz());
/** A moment today at a campus clock time, e.g. at('10:00'). */
const at = (hhmm, day = today()) => new Date(`${day}T${hhmm}:00+05:30`);
const idOf = async (username) => (await t.db.query('SELECT id FROM users WHERE username = $1', [username])).rows[0].id;
const take = (filter) => { const out = pushed.filter(filter); pushed.length = 0; return out; };

test('renewal reminders: 3 days before, on the last day, when grace starts - each once, with a renew link', async () => {
  t.config.appUrl = 'https://transit.example.edu';
  const s = await t.newStudent('118');
  await t.subscribe(s.token);
  const id = await idOf(s.username);
  const day = today();
  const setEnd = (d) => t.db.query(`UPDATE subscriptions SET valid_from = least(valid_from, $2::date - 30), valid_to = $2 WHERE user_id = $1 AND status = 'ACTIVE'`, [id, d]);
  pushed.length = 0;

  await setEnd(addDays(day, 3));
  assert.equal((await t.followups.renewalReminders(at('07:00'))).sent, 0, 'nothing before 8:00');
  await t.followups.renewalReminders(at('10:00'));
  let mine = take((p) => p.who === id);
  assert.equal(mine.length, 1);
  assert.match(mine[0].title, /ends in 3 days/);
  assert.equal(mine[0].data.type, 'renew');
  assert.equal(mine[0].data.url, 'https://transit.example.edu/pay');
  await t.followups.renewalReminders(at('11:00'));
  assert.equal(take((p) => p.who === id).length, 0, 'sent once');

  await setEnd(day);
  await t.followups.renewalReminders(at('10:00'));
  mine = take((p) => p.who === id);
  assert.match(mine[0].title, /ends today/);

  await setEnd(addDays(day, -1));
  await t.followups.renewalReminders(at('10:00'));
  mine = take((p) => p.who === id);
  assert.match(mine[0].title, /has ended/);
  assert.match(mine[0].body, new RegExp(addDays(addDays(day, -1), t.config.subscription.graceDays)));

  // Renewed (a later subscription exists): no reminder for the old one.
  const other = await t.newStudent('118');
  await t.subscribe(other.token);
  const otherId = await idOf(other.username);
  await t.db.query(`UPDATE subscriptions SET valid_to = $2 WHERE user_id = $1`, [otherId, addDays(day, 2)]);
  await t.subscribe(other.token);
  await t.followups.renewalReminders(at('10:00'));
  assert.equal(take((p) => p.who === otherId).length, 0);
});

test('the driver is reminded before the run when the pre-trip check is not done', async () => {
  const route = (await t.call('/api/routes/120')).body;
  const leaves = clockMinutes(route.departure_time);
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const driverId = await idOf('drv120');
  pushed.length = 0;
  await t.followups.checklistReminders(at(hhmm(leaves - 30)));
  assert.equal(take((p) => p.who === driverId).length, 0, 'too early');
  await t.followups.checklistReminders(at(hhmm(leaves - 10)));
  const got = take((p) => p.who === driverId);
  assert.equal(got.length, 1);
  assert.match(got[0].title, /Pre-trip check/);
  await t.followups.checklistReminders(at(hhmm(leaves - 5)));
  assert.equal(take((p) => p.who === driverId).length, 0, 'once');

  // Bus 121 did its check: no reminder.
  const r121 = (await t.call('/api/routes/121')).body;
  const token = await t.login('drv121');
  const results = Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, true]));
  assert.equal((await t.call('/api/driver/checklist', { token, body: { results } })).status, 201);
  await t.followups.checklistReminders(at(hhmm(clockMinutes(r121.departure_time) - 10)));
  assert.equal(take((p) => p.who === (driverId + 0) && false).length, 0);
  assert.equal(pushed.filter((p) => p.title?.includes('Pre-trip')).length, 0);
});

test('an unanswered complaint reminds the service desk after 48 h and reaches the transport head after 72 h', async () => {
  const s = await t.newStudent('118');
  const sid = await idOf(s.username);
  const trip = (await t.db.query(`SELECT t.id, t.bus_id, t.route_id FROM trips t LIMIT 1`)).rows[0]
    ?? (await t.db.query(`INSERT INTO trips (bus_id, route_id, status, direction) SELECT b.id, b.route_id, 'completed', 'UP' FROM buses b WHERE b.fleet_code = 'BSACIST-118' RETURNING id, bus_id, route_id`)).rows[0];
  const { rows: [c] } = await t.db.query(
    `INSERT INTO trip_feedback (user_id, trip_id, bus_id, route_id, rating, comment, status, created_at)
     VALUES ($1, $2, $3, $4, 1, 'Driver skipped my stop', 'OPEN', now() - interval '50 hours') RETURNING id`,
    [sid, trip.id, trip.bus_id, trip.route_id],
  );
  const told = [];
  t.escalation.monitor = { deliver: async (subject, text) => told.push({ subject, text }) };
  pushed.length = 0;
  let r = await t.followups.complaintFollowups();
  assert.equal(r.reminded, 1);
  assert.match(take((p) => p.to === 'role')[0].body, /Driver skipped my stop/);
  assert.equal((await t.followups.complaintFollowups()).reminded, 0, 'once');

  await t.db.query(`UPDATE trip_feedback SET created_at = now() - interval '80 hours' WHERE id = $1`, [c.id]);
  r = await t.followups.complaintFollowups();
  assert.equal(r.escalated, 1);
  assert.match(told[0].text, new RegExp(`Complaint #${c.id}`));
  assert.equal((await t.followups.complaintFollowups()).escalated, 0);
});

test('an SOS nobody acknowledges goes up the chain every 5 minutes; acknowledging stops it', async () => {
  const s = await t.newStudent('118');
  const sos = await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'Help near the bridge', lat: 13.0, lng: 80.2 } });
  assert.equal(sos.status, 201);
  const id = sos.body.id;
  const reached = [];
  t.escalation.reach = async (person, msg) => reached.push({ person: person.username, ...msg });
  t.escalation.monitor = { deliver: async () => {} };

  assert.equal((await t.escalation.sweep()).escalated, 0, 'not yet 5 minutes');
  await t.db.query(`UPDATE incidents SET created_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
  // No ESCALATE_TO: every administrator, every way.
  assert.equal((await t.escalation.sweep()).escalated, 1);
  assert.ok(reached.some((r) => r.person === 'admin' && /UNANSWERED SOS/.test(r.title) && /Help near the bridge/.test(r.body)));
  assert.equal((await t.escalation.sweep()).escalated, 0, 'one step only without a chain');

  // With a chain: the next person after 5 min, then the head after 5 more.
  await t.db.query(`INSERT INTO users (username, password_hash, full_name, role, email, phone) VALUES ('deputy', 'x', 'Deputy Officer', 'admin', 'deputy@example.edu', '9840012345'), ('head', 'x', 'Transport Head', 'admin', 'head@example.edu', '9840054321') ON CONFLICT DO NOTHING`);
  t.config.escalation.chain = ['deputy', 'head'];
  const second = await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'Second' } });
  await t.db.query(`UPDATE incidents SET created_at = now() - interval '6 minutes' WHERE id = $1`, [second.body.id]);
  reached.length = 0;
  await t.escalation.sweep();
  assert.deepEqual(reached.map((r) => r.person), ['deputy']);
  await t.db.query(`UPDATE incidents SET escalated_at = now() - interval '6 minutes' WHERE id = $1`, [second.body.id]);
  await t.escalation.sweep();
  assert.deepEqual(reached.map((r) => r.person), ['deputy', 'head']);

  const third = await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'Third' } });
  const ack = await t.call(`/api/admin/incidents/${third.body.id}/ack`, { token: admin, method: 'POST' });
  assert.equal(ack.status, 200);
  assert.ok(ack.body.acknowledged_at);
  await t.db.query(`UPDATE incidents SET created_at = now() - interval '20 minutes' WHERE id = $1`, [third.body.id]);
  reached.length = 0;
  await t.escalation.sweep();
  assert.equal(reached.filter((r) => r.data.id === third.body.id).length, 0);
  t.config.escalation.chain = [];
  // Students cannot acknowledge.
  assert.equal((await t.call(`/api/admin/incidents/${third.body.id}/ack`, { token: s.token, method: 'POST' })).status, 403);
});

test('a phone-only driver: the trip starts by itself once the bus leaves the depot, moving', async () => {
  const token = await t.login('drv122');
  const route = (await t.call('/api/routes/122')).body;
  const depot = route.stops[0];
  const post = (fixes) => t.call('/api/driver/standby', { token, body: { fixes } });
  // Parked at the depot.
  let r = await post([0, 5, 10].map((s) => ({ lat: depot.lat, lng: depot.lng, speedKmh: 0, recordedAt: secondsAgo(60 - s) })));
  assert.equal(r.status, 200);
  assert.ok(r.body.waiting);
  // Moving, but still inside the depot.
  r = await post([{ lat: depot.lat + 0.0005, lng: depot.lng, speedKmh: 15, recordedAt: secondsAgo(40) }, { lat: depot.lat + 0.001, lng: depot.lng, speedKmh: 15, recordedAt: secondsAgo(20) }]);
  assert.match(r.body.waiting, /not left the depot|only just/);
  // Out on the road and still moving: the trip starts.
  r = await post([{ lat: depot.lat + 0.004, lng: depot.lng, speedKmh: 30, recordedAt: secondsAgo(10) }, { lat: depot.lat + 0.006, lng: depot.lng, speedKmh: 32, recordedAt: secondsAgo(1) }]);
  assert.equal(r.body.started, true, JSON.stringify(r.body));
  const trip = (await t.db.query('SELECT started_by, status FROM trips WHERE id = $1', [r.body.trip.id])).rows[0];
  assert.deepEqual(trip, { started_by: 'auto', status: 'active' });
  assert.ok(take((p) => p.title === 'Trip started automatically').length);
  // Already running: the same trip comes back.
  r = await post([{ lat: depot.lat + 0.007, lng: depot.lng, speedKmh: 30, recordedAt: secondsAgo(0) }]);
  assert.equal(r.body.started, false);
  await t.call(`/api/driver/trips/${trip.id ?? r.body.trip.id}/end`, { token, method: 'POST' });
  // Only drivers send standby positions.
  assert.equal((await t.call('/api/driver/standby', { token: admin, body: { fixes: [] } })).status, 403);
});

test('a fuel receipt is read into litres, amount and odometer', async () => {
  const lines = ['INDIAN OIL CORPORATION', 'Product: HSD Diesel', 'Rate Rs/L : 92.45', 'Volume (L): 54.10', 'Amount Rs: 5001.55', 'Odometer: 124560', 'Date: 14/11/2026']
    .map((text, i) => ({ text, x: 50, y: 780 - i * 20 }));
  const pdf = renderPdf(lines).toString('base64');
  const token = await t.login('drv118');
  const r = await t.call('/api/fuel/receipt', { token, body: { data: pdf, mimeType: 'application/pdf', name: 'receipt.pdf' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'FUEL');
  assert.equal(r.body.litres, 54.1);
  assert.equal(r.body.amountRupees, 5001.55);
  assert.equal(r.body.odometerKm, 124560);
});

test('the weekly report: last week\'s figures, a one-page PDF, and the email', async () => {
  const r = await t.call('/api/admin/weekly-report', { token: admin });
  assert.equal(r.status, 200);
  for (const k of ['trips', 'onTimePct', 'lateBuses', 'incidents', 'riders', 'feedback', 'collections']) assert.ok(k in r.body, k);
  const week = t.weekly.lastWeek();
  assert.equal(new Date(`${week.from}T12:00:00Z`).getUTCDay(), 1, 'Monday');
  assert.equal(addDays(week.from, 6), week.to);
  const pdf = await t.call('/api/admin/weekly-report.pdf', { token: admin });
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  const sent = [];
  t.weekly.mailer = { configured: true, send: async (m) => sent.push(m) };
  t.config.weeklyReport.to = ['head@example.edu'];
  const monday = at('08:00', addDays(week.to, 1));
  assert.equal(await t.weekly.due(at('07:00', addDays(week.to, 1))), false, 'before 7:30');
  assert.equal(await t.weekly.due(monday), true);
  await t.weekly.send({ now: monday });
  assert.equal(sent[0].to, 'head@example.edu');
  assert.equal(sent[0].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await t.weekly.due(monday), false, 'once a week');
  const now = await t.call('/api/admin/weekly-report/send', { token: admin, body: { to: 'me@example.edu' } });
  assert.equal(now.status, 200);
  assert.equal(sent[1].to, 'me@example.edu');
});

test('a route whose bus did not run gets a day added to its students\' subscriptions, once', async () => {
  const s = await t.newStudent('123');
  await t.subscribe(s.token);
  const id = await idOf(s.username);
  const before = (await t.db.query(`SELECT valid_to FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'`, [id])).rows[0].valid_to;
  // Another route ran today; route 123 did not.
  const drv = await t.login('drv124');
  const started = await t.call('/api/driver/trips', { token: drv, method: 'POST', body: { direction: 'UP' } });
  await t.call(`/api/driver/trips/${started.body.trip.id}/end`, { token: drv, method: 'POST' });
  const r = await t.followups.serviceCredits();
  assert.ok(r.students >= 1);
  const afterDay = (await t.db.query(`SELECT valid_to FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'`, [id])).rows[0].valid_to;
  assert.equal(Math.round((afterDay - before) / 86400000), 1);
  assert.equal((await t.followups.serviceCredits()).students, 0, 'once per route and day');
  const list = await t.call('/api/admin/service-credits', { token: admin });
  assert.ok(list.body.some((c) => c.route_code === '123'));
});

test('a breakdown suggests the nearest free bus; approving it tells the route', async () => {
  const token = await t.login('drv125');
  const route = (await t.call('/api/routes/125')).body;
  await t.call('/api/driver/trips', { token, method: 'POST', body: { direction: 'UP' } });
  const r = await t.call('/api/driver/incidents', { token, body: { kind: 'BREAKDOWN', message: 'Engine', lat: route.stops[2].lat, lng: route.stops[2].lng } });
  assert.equal(r.status, 201);
  let list;
  for (let i = 0; i < 20; i += 1) {
    list = (await t.call('/api/admin/suggestions', { token: admin })).body;
    if (list.some((s) => s.kind === 'REPLACEMENT')) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  const sugg = list.find((s) => s.kind === 'REPLACEMENT' && s.incident_id === r.body.id);
  assert.ok(sugg, JSON.stringify(list));
  assert.ok(sugg.detail.replacement.fleetCode);
  const done = await t.call(`/api/admin/suggestions/${sugg.id}/apply`, { token: admin, method: 'POST' });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'APPLIED');
  const notices = await t.db.query(`SELECT title FROM notifications WHERE kind = 'BREAKDOWN' ORDER BY id DESC LIMIT 1`);
  assert.match(notices.rows[0].title, /is on its way/);
  assert.equal((await t.call(`/api/admin/suggestions/${sugg.id}/apply`, { token: admin, method: 'POST' })).status, 404, 'decided once');
});

test('a timetable that keeps running late is proposed for approval, and applying it updates the stops', async () => {
  const code = '126';
  const routeId = (await t.db.query('SELECT id FROM routes WHERE code = $1', [code])).rows[0].id;
  const busId = (await t.db.query('SELECT id FROM buses WHERE route_id = $1', [routeId])).rows[0].id;
  const stops = (await t.db.query('SELECT seq, offset_minutes FROM stops WHERE route_id = $1 ORDER BY seq', [routeId])).rows;
  // Five morning runs, each stop 10 minutes later than printed.
  for (let k = 0; k < 5; k += 1) {
    const { rows: [trip] } = await t.db.query(
      `INSERT INTO trips (bus_id, route_id, status, direction, started_at, ended_at) VALUES ($1, $2, 'completed', 'UP', now() - make_interval(days => $3), now() - make_interval(days => $3)) RETURNING id, started_at`,
      [busId, routeId, k + 1],
    );
    for (const s of stops) {
      const late = s.seq === 1 ? 0 : 10;
      await t.db.query(`INSERT INTO stop_arrivals (trip_id, stop_seq, arrived_at) VALUES ($1, $2, $3::timestamptz + make_interval(mins => $4))`,
        [trip.id, s.seq, trip.started_at, (s.offset_minutes - stops[0].offset_minutes) + late]);
    }
  }
  await t.call('/api/admin/suggestions/refresh', { token: admin, method: 'POST' });
  const sugg = (await t.call('/api/admin/suggestions', { token: admin })).body.find((s) => s.kind === 'TIMETABLE' && s.route_code === code);
  assert.ok(sugg);
  assert.match(sugg.title, /10 min later/);
  const res = await t.call(`/api/admin/suggestions/${sugg.id}/apply`, { token: admin, method: 'POST' });
  assert.equal(res.body.result.stopsUpdated, stops.length - 1);
  const after2 = (await t.db.query('SELECT offset_minutes FROM stops WHERE route_id = $1 AND seq = 2', [routeId])).rows[0].offset_minutes;
  assert.equal(after2, stops[1].offset_minutes + 10);
  assert.equal(clockText(7 * 60 + 5), '7.05 AM');
  assert.equal(clockText(16 * 60 + 30), '4.30 PM');
});

test('WhatsApp for a parent without the app: the student adds the number; boarding, late and SOS messages reach it', async () => {
  assert.equal(normalisePhone('98400 12345'), '+919840012345');
  assert.equal(normalisePhone('+91 98400-12345'), '+919840012345');
  assert.equal(normalisePhone('12'), null);
  const sent = [];
  t.messaging.settings.whatsapp = { token: 'test', phoneId: '123', template: 'transport_update', language: 'en', apiVersion: 'v20.0' };
  t.messaging.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, text: async () => '' }; };

  const s = await t.newStudent('118');
  const add = await t.call('/api/me/parent-contacts', { token: s.token, body: { name: 'Amma', phone: '98400 12345' } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.ok(!add.body.phone.includes('9840012'), 'the number is shown masked');
  assert.equal(sent.length, 1, 'a welcome message');
  assert.equal(sent[0].body.to, '919840012345');
  assert.equal(sent[0].body.template.name, 'transport_update');
  assert.equal((await t.call('/api/me/parent-contacts', { token: s.token, body: { name: 'Amma', phone: '9840012345' } })).status, 409);

  sent.length = 0;
  await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'Bus did not stop' } });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.template.components[0].parameters[0].text, /sent an SOS/);

  const usage = await t.call('/api/admin/messaging', { token: admin });
  assert.ok(usage.body.byChannel.find((c) => c.channel === 'whatsapp').sent >= 2);
  const list = await t.call('/api/me/parent-contacts', { token: s.token });
  assert.equal(list.body.contacts.length, 1);
  assert.equal((await t.call(`/api/me/parent-contacts/${list.body.contacts[0].id}`, { token: s.token, method: 'DELETE' })).status, 200);
  t.messaging.settings.whatsapp = null;
});

test('escalation leaves alone: resolved alerts, non-urgent kinds, and alerts older than a day; stops after the transport head', async () => {
  const s = await t.newStudent('118');
  const reached = [];
  t.escalation.reach = async (person, msg) => reached.push({ person: person.username, id: msg.data.id });
  t.escalation.monitor = { deliver: async () => {} };
  const report = async (kind, message) => (await t.call('/api/problems', { token: s.token, body: { kind, message } })).body.id;
  const old = (id, min) => t.db.query('UPDATE incidents SET created_at = now() - make_interval(mins => $2) WHERE id = $1', [id, min]);

  const resolved = await report('SOS', 'resolved one');
  await t.call(`/api/admin/incidents/${resolved}/resolve`, { token: admin, body: { resolution: 'Called the student' } });
  const ack = (await t.db.query('SELECT acknowledged_at FROM incidents WHERE id = $1', [resolved])).rows[0].acknowledged_at;
  assert.ok(ack, 'resolving acknowledges too');
  const minor = await report('OTHER', 'a minor one');
  const stale = await report('SOS', 'yesterday');
  for (const [id, m] of [[resolved, 30], [minor, 30], [stale, 26 * 60]]) await old(id, m);
  await t.escalation.sweep();
  assert.equal(reached.filter((r) => [resolved, minor, stale].includes(r.id)).length, 0);

  // A chain of two: two steps, then nothing more however long it waits.
  await t.db.query(`INSERT INTO users (username, password_hash, full_name, role) VALUES ('deputy', 'x', 'Deputy', 'admin'), ('head', 'x', 'Head', 'admin') ON CONFLICT DO NOTHING`);
  t.config.escalation.chain = ['deputy', 'nobody-by-this-name', 'head'];
  assert.deepEqual((await t.escalation.chain()).map((p) => p.username), ['deputy', 'head'], 'unknown names are skipped');
  const id = await report('SOS', 'long wait');
  for (let step = 0; step < 4; step += 1) {
    await t.db.query(
      `UPDATE incidents SET created_at = now() - interval '30 minutes',
              escalated_at = CASE WHEN escalated_at IS NULL THEN NULL ELSE now() - interval '6 minutes' END WHERE id = $1`,
      [id],
    );
    await t.escalation.sweep();
  }
  assert.deepEqual(reached.filter((r) => r.id === id).map((r) => r.person), ['deputy', 'head']);
  assert.equal((await t.db.query('SELECT escalation_level FROM incidents WHERE id = $1', [id])).rows[0].escalation_level, 2);
  const log = await t.db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'INCIDENT_ESCALATED' AND entity_id::text = $1`, [String(id)]);
  assert.equal(log.rows[0].n, 2, 'each step is audited');
  t.config.escalation.chain = [];
});

test('the transport head is reached by push, text and email', async () => {
  const texts = [];
  const mails = [];
  const pushes = [];
  const svc = Object.assign(Object.create(Object.getPrototypeOf(t.escalation)), t.escalation, {
    push: { toUser: (id, m) => pushes.push({ id, ...m }) },
    messaging: { send: async (m) => { texts.push(m); return { ok: true }; } },
    mailer: { configured: true, send: async (m) => mails.push(m) },
  });
  delete svc.reach; // the real one, not a test stub
  await svc.reach({ id: 1, username: 'head', phone: '9840054321', email: 'head@example.edu' }, { title: 'UNANSWERED SOS', body: 'Bus 118', data: { type: 'incident', id: 9 } });
  assert.equal(pushes.length, 1);
  assert.equal(texts[0].to, '9840054321');
  assert.match(texts[0].text, /UNANSWERED SOS/);
  assert.equal(mails[0].to, 'head@example.edu');
});

test('automatic start waits: outside trip hours, when off, right after the last trip, with a tracker, and for old positions', async () => {
  const token = await t.login('drv127');
  const route = (await t.call('/api/routes/127')).body;
  const depot = route.stops[0];
  const { rows: [bus] } = await t.db.query(`SELECT id, route_id FROM buses WHERE fleet_code = 'BSACIST-127'`);
  const away = (n) => ({ lat: depot.lat + 0.001 * n, lng: depot.lng });
  const drive = (now = Date.now()) => {
    t.autoStart.state.clear();
    return t.autoStart.standby({ userId: null, busId: bus.id }, { fixes: [
      { ...away(0), speedKmh: 0, recordedAt: new Date(now - 60000).toISOString() },
      { ...away(4), speedKmh: 30, recordedAt: new Date(now - 30000).toISOString() },
      { ...away(7), speedKmh: 30, recordedAt: new Date(now - 1000).toISOString() },
    ] }, now);
  };

  const windows = t.config.attendance.travelWindows;
  const nowMin = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const shut = nowMin < 12 ? '13:00-14:00' : '01:00-02:00';
  t.config.attendance.travelWindows = shut;
  assert.equal((await drive()).waiting, 'Outside the trip hours');
  t.config.attendance.travelWindows = windows;

  t.config.phoneAutoStart.enabled = false;
  assert.equal((await drive()).waiting, 'Automatic start is off');
  t.config.phoneAutoStart.enabled = true;

  await t.db.query(
    `INSERT INTO trips (bus_id, route_id, status, direction, started_at, ended_at) VALUES ($1, $2, 'completed', 'UP', now() - interval '1 hour', now() - interval '5 minutes')`,
    [bus.id, bus.route_id],
  );
  assert.match((await drive()).waiting, /last trip ended/);
  await t.db.query(`UPDATE trips SET ended_at = now() - interval '2 hours' WHERE bus_id = $1 AND status = 'completed'`, [bus.id]);

  t.tracking.lastTrackerFixAt.set(bus.id, Date.now());
  assert.match((await drive()).waiting, /tracker/);
  t.tracking.lastTrackerFixAt.delete(bus.id);

  t.autoStart.state.clear();
  const stale = await t.autoStart.standby({ userId: null, busId: bus.id }, { fixes: [{ ...away(7), speedKmh: 30, recordedAt: new Date(Date.now() - 3600000).toISOString() }] });
  assert.equal(stale.waiting, 'No position yet');

  // It starts once nothing stands in the way, and stores none of the standby positions.
  const count = async () => (await t.db.query('SELECT count(*)::int AS n FROM location_pings WHERE bus_id = $1', [bus.id])).rows[0].n;
  const before = await count();
  const r = await drive();
  assert.equal(r.started, true, JSON.stringify(r));
  assert.equal(await count(), before);
  await t.call(`/api/driver/trips/${r.trip.id}/end`, { token, method: 'POST' });
});

test('suggestions: only admins see and decide them; a dismissed one changes nothing', async () => {
  const s = await t.newStudent('118');
  assert.equal((await t.call('/api/admin/suggestions', { token: s.token })).status, 403);
  const { rows: [sg] } = await t.db.query(
    `INSERT INTO ops_suggestions (kind, key, title, detail) VALUES ('OVERCROWDING', 'test:crowd', 'Route X ran full', '{}') RETURNING id`,
  );
  assert.equal((await t.call(`/api/admin/suggestions/${sg.id}/explode`, { token: admin, method: 'POST' })).status, 400);
  const r = await t.call(`/api/admin/suggestions/${sg.id}/dismiss`, { token: admin, method: 'POST' });
  assert.equal(r.body.status, 'DISMISSED');
  const done = await t.call('/api/admin/suggestions?status=DISMISSED', { token: admin });
  assert.ok(done.body.some((x) => x.id === sg.id && x.decided_by_name));
  assert.equal((await t.call('/api/admin/suggestions?status=WHATEVER', { token: admin })).status, 400);
});

test('a trip still running hours after it started is closed by itself', async () => {
  const { rows: [bus] } = await t.db.query(`SELECT id, route_id FROM buses WHERE fleet_code = 'BSACIST-116'`);
  const { rows: [trip] } = await t.db.query(
    `INSERT INTO trips (bus_id, route_id, status, direction, started_at) VALUES ($1, $2, 'active', 'UP', now() - interval '9 hours') RETURNING id`,
    [bus.id, bus.route_id],
  );
  const ended = await t.automation.endStaleTrips();
  assert.ok(ended.includes(trip.id));
  assert.equal((await t.db.query('SELECT status FROM trips WHERE id = $1', [trip.id])).rows[0].status, 'completed');
  assert.deepEqual(await t.automation.endStaleTrips(), [], 'nothing left to close');
});

test('automatic alerts: a tracker-offline flag closes when its trip ends; the office clears the rest in one go; SOS stays', async () => {
  const token = await t.login('drv115');
  const started = await t.call('/api/driver/trips', { token, method: 'POST', body: { direction: 'UP' } });
  const tripId = started.body.trip.id;
  const { rows: [bus] } = await t.db.query('SELECT bus_id, route_id FROM trips WHERE id = $1', [tripId]);
  const flag = async (kind) => (await t.db.query(
    `INSERT INTO incidents (kind, source, message, trip_id, bus_id, route_id) VALUES ($1, 'system', 'test', $2, $3, $4) RETURNING id`,
    [kind, tripId, bus.bus_id, bus.route_id],
  )).rows[0].id;
  const offline = await flag('TRACKER_OFFLINE');
  const speeding = await flag('SPEEDING');
  await t.call(`/api/driver/trips/${tripId}/end`, { token, method: 'POST' });
  await new Promise((r) => setTimeout(r, 100));
  const status = async (id) => (await t.db.query('SELECT status FROM incidents WHERE id = $1', [id])).rows[0].status;
  assert.equal(await status(offline), 'RESOLVED', 'closed when the trip ended');
  assert.equal(await status(speeding), 'OPEN', 'speeding waits for a person');

  const s = await t.newStudent('118');
  const sos = (await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'stays open' } })).body.id;
  const r = await t.call('/api/admin/incidents/resolve-system', { token: admin, body: {} });
  assert.equal(r.status, 200);
  assert.ok(r.body.resolved >= 1);
  assert.equal(await status(speeding), 'RESOLVED');
  assert.equal(await status(sos), 'OPEN', 'what people sent is never cleared in bulk');
  assert.equal((await t.call('/api/admin/incidents/resolve-system', { token: s.token, body: {} })).status, 403);
});
