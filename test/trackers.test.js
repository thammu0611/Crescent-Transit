// GPS trackers fitted in the buses: the protocol decoders byte for byte, then
// whole trackers talking to a real server over HTTP and TCP.
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { localMinutes } from '../server/clock.js';
import { parseOsmand, parseWebhook } from '../server/gps/formats.js';
import * as gt06 from '../server/gps/gt06.js';
import * as teltonika from '../server/gps/teltonika.js';
import { startTestServer } from './helpers.js';

// ---- Decoders --------------------------------------------------------------------

test('both CRCs give the standard check values', () => {
  assert.equal(gt06.crc16x25(Buffer.from('123456789')), 0x906e); // CRC-16/X-25
  assert.equal(teltonika.crc16ibm(Buffer.from('123456789')), 0xbb3d); // CRC-16/ARC
});

test('GT06: the login example of the protocol document, and our answer', () => {
  const { frames, rest } = gt06.splitFrames(Buffer.from('78780D01012345678901234500018CDD0D0A', 'hex'));
  assert.equal(rest.length, 0);
  assert.equal(frames[0].crcOk, true);
  assert.deepEqual(gt06.interpret(frames[0]), { kind: 'login', imei: '123456789012345' });
  assert.equal(gt06.reply(0x01, 1).toString('hex'), '787805010001d9dc0d0a');
});

test('GT06: the position example of the protocol document', () => {
  // Field layout only: the checksum bytes as copied here do not verify, so the
  // CRC is covered by the login example above and the standard check value.
  const hex = '78781F120B081D112E10CC027AC7EB0C46584900148F01CC00287D001FB8000380810D0A';
  const { frames } = gt06.splitFrames(Buffer.from(hex, 'hex'));
  const { kind, fix, info } = gt06.interpret(frames[0]);
  assert.equal(kind, 'position');
  assert.equal(fix.recordedAt, '2011-08-29T17:46:16.000Z');
  assert.ok(Math.abs(fix.lat - 23.1116683) < 1e-6, `lat ${fix.lat}`);
  assert.ok(Math.abs(fix.lng - 114.409285) < 1e-6, `lng ${fix.lng}`);
  assert.equal(fix.speedKmh, 0);
  assert.equal(fix.heading, 143);
  assert.equal(fix.valid, true);
  assert.equal(info.satellites, 12);
});

test('GT06: frames split across reads, glued together, or after garbage', () => {
  const a = gt06.encodeLocation({ lat: -12.5, lng: -45.25, speedKmh: 42, heading: 271, time: '2026-10-16T08:00:00Z', ignition: true }, 7);
  const b = gt06.encodeHeartbeat({ ignition: false }, 8);
  const stream = Buffer.concat([Buffer.from([0x00, 0x13, 0x55]), a, b]);
  const first = gt06.splitFrames(stream.subarray(0, 20));
  assert.equal(first.frames.length, 0);
  const all = gt06.splitFrames(Buffer.concat([first.rest, stream.subarray(20)]));
  assert.equal(all.frames.length, 2);
  assert.equal(all.rest.length, 0);
  const pos = gt06.interpret(all.frames[0]);
  assert.deepEqual(
    { lat: pos.fix.lat, lng: pos.fix.lng, speed: pos.fix.speedKmh, heading: pos.fix.heading, at: pos.fix.recordedAt, ignition: pos.info.ignition },
    { lat: -12.5, lng: -45.25, speed: 42, heading: 271, at: '2026-10-16T08:00:00.000Z', ignition: true },
  );
  assert.equal(all.frames[1].serial, 8);
  assert.equal(gt06.interpret(all.frames[1]).info.ignition, false);
  assert.equal(gt06.needsReply(gt06.MSG.HEARTBEAT), true);
  assert.equal(gt06.needsReply(gt06.MSG.GPS_LBS_2), false);
});

test('Teltonika: the Codec 8 example of the protocol document', () => {
  const avl = Buffer.from([
    '00000000', '00000036', '08', '01',
    '0000016B40D8EA30', '01', '00'.repeat(15), // time, priority, GPS element (no fix)
    '01', '05', '02', '1503', '0101', '01', '425E0F', '01', 'F10000601A', '01', '4E0000000000000000',
    '01', '0000C7CF',
  ].join(''), 'hex');
  const p = teltonika.readPacket(avl);
  assert.equal(p.crcOk, true);
  assert.equal(p.consumed, avl.length);
  assert.equal(p.records.length, 1);
  const r = p.records[0];
  assert.equal(new Date(r.time).toISOString(), '2019-06-10T10:04:46.000Z');
  assert.deepEqual(r.io, { 21: 3, 1: 1, 66: 0x5e0f, 241: 0x601a, 78: 0 });
  assert.equal(teltonika.toFix(r).fix.valid, false); // 0 satellites: last known position, not a fix
  assert.equal(teltonika.ack(1).toString('hex'), '00000001');
});

test('Teltonika: Codec 8 round trip in all four hemispheres, and Codec 8 Extended', () => {
  const positions = [
    { lat: 12.9716, lng: 80.2209, speedKmh: 35, heading: 90, time: '2026-10-16T08:00:00Z', ignition: true },
    { lat: -33.8688, lng: -70.6693, speedKmh: 0, heading: 359, time: '2026-10-16T08:00:10Z', ignition: false },
  ];
  const p = teltonika.readPacket(teltonika.encodePacket(positions));
  assert.equal(p.crcOk, true);
  assert.deepEqual(p.records.map((r) => teltonika.toFix(r)), [
    { fix: { lat: 12.9716, lng: 80.2209, speedKmh: 35, heading: 90, recordedAt: '2026-10-16T08:00:00.000Z', valid: true }, info: { satellites: 10, ignition: true, externalVoltage: 24.079 } },
    { fix: { lat: -33.8688, lng: -70.6693, speedKmh: 0, heading: 359, recordedAt: '2026-10-16T08:00:10.000Z', valid: true }, info: { satellites: 10, ignition: false, externalVoltage: 24.079 } },
  ]);

  // Codec 8E: two-byte ids and counts, plus a variable-length element to skip.
  const rec = Buffer.alloc(24);
  rec.writeBigUInt64BE(BigInt(Date.parse('2026-10-16T08:00:00Z')), 0);
  rec.writeInt32BE(802209000, 9);
  rec.writeInt32BE(129716000, 13);
  rec.writeUInt16BE(180, 19);
  rec.writeUInt8(7, 21);
  rec.writeUInt16BE(28, 22);
  const io = Buffer.from('0000' + '0002' + '0001' + '00EF01' + '0000' + '0000' + '0000' + '0001' + '0100' + '0003' + 'AABBCC', 'hex');
  const data = Buffer.concat([Buffer.from([0x8e, 1]), rec, io, Buffer.from([1])]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(teltonika.crc16ibm(data));
  const e = teltonika.readPacket(Buffer.concat([head, data, crc]));
  assert.equal(e.crcOk, true);
  assert.deepEqual(teltonika.toFix(e.records[0]), {
    fix: { lat: 12.9716, lng: 80.2209, speedKmh: 28, heading: 180, recordedAt: '2026-10-16T08:00:00.000Z', valid: true },
    info: { satellites: 7, ignition: true },
  });
});

test('HTTP formats: OsmAnd query (knots), Traccar Client JSON, Traccar forwarding, generic list', () => {
  const [q] = parseOsmand({ id: 'bus7', lat: '12.97', lon: '80.22', timestamp: '1700000000', speed: '10', bearing: '90', accuracy: '5', batt: '81' });
  assert.deepEqual(q, {
    uniqueId: 'bus7',
    fix: { lat: 12.97, lng: 80.22, speedKmh: 18.5, heading: 90, accuracyM: 5, recordedAt: '2023-11-14T22:13:20.000Z', valid: true },
    info: { batteryPct: 81, ignition: undefined, hdop: undefined },
  });
  assert.equal(parseOsmand({ id: 'x', lat: '1', lon: '2', timestamp: '1700000000000' })[0].fix.recordedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(parseOsmand({ id: 'x', location: '12.5,80.5', speed: '-1' })[0].fix.lat, 12.5);
  assert.equal(parseOsmand({ id: 'x', location: '12.5,80.5', speed: '-1' })[0].fix.speedKmh, undefined);

  const [j] = parseOsmand({}, { device_id: 'bus8', location: { timestamp: '2026-10-16T08:00:00Z', coords: { latitude: 12.9, longitude: 80.1, speed: 10, heading: 45, accuracy: 6 }, battery: { level: 0.5, is_charging: true } } });
  assert.deepEqual([j.uniqueId, j.fix.speedKmh, j.fix.heading, j.info.batteryPct], ['bus8', 36, 45, 50]);

  const [t] = parseWebhook({ device: { uniqueId: '860000000000127' }, position: { latitude: 12.9, longitude: 80.1, speed: 5, course: 180, accuracy: 0, fixTime: '2026-10-16T08:00:00.000+00:00', valid: true, attributes: { ignition: true, sat: 9 } } });
  assert.deepEqual([t.uniqueId, t.fix.speedKmh, t.fix.heading, t.fix.accuracyM, t.fix.recordedAt, t.info.ignition], ['860000000000127', 9.3, 180, undefined, '2026-10-16T08:00:00.000Z', true]);

  const list = parseWebhook({ positions: [{ imei: 'a1', lat: 1, lng: 2, speedKmh: 30, recordedAt: '2026-10-16T08:00:00Z' }, { deviceId: 'b2', latitude: 3, longitude: 4 }] });
  assert.deepEqual(list.map((p) => [p.uniqueId, p.fix.lat, p.fix.speedKmh]), [['a1', 1, 30], ['b2', 3, undefined]]);
});

// ---- Whole trackers against a real server ----------------------------------------

let t;
let admin;
const stopsOf = {};
before(async () => {
  t = await startTestServer();
  admin = await t.login('admin');
  for (const code of ['110', '117', '118', '119', '125', '127']) stopsOf[code] = (await t.call(`/api/routes/${code}`)).body.stops;
});
after(async () => { await t.stop(); });

const busIdOf = async (code) => (await t.db.query('SELECT id FROM buses WHERE fleet_code = $1', [`BSACIST-${code}`])).rows[0].id;
const activeTrip = async (code) => (await t.db.query(`SELECT * FROM trips WHERE status = 'active' AND bus_id = $1`, [await busIdOf(code)])).rows[0];
const register = async (uniqueId, code, protocol = 'auto') => {
  const r = await t.call('/api/admin/trackers', { token: admin, body: { uniqueId, protocol, fleetCode: code ? `BSACIST-${code}` : null, label: `Test ${uniqueId}` } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
/** A point `metres` along the segment from the route's first stop to its second. */
const along = (code, metres) => {
  const [a, b] = stopsOf[code];
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const len = Math.hypot(dLat * 111320, dLng * 111320 * Math.cos((a.lat * Math.PI) / 180));
  const k = Math.min(1, metres / len);
  return { lat: a.lat + dLat * k, lng: a.lng + dLng * k };
};
const ago = (s) => new Date(Date.now() - s * 1000);
const waitFor = async (check, ms = 3000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const osmand = (key, params) => t.call(`/api/gps/osmand/${key}?${new URLSearchParams(params)}`);
const connect = (port) => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', () => resolve(s));
  s.once('error', reject);
});
const nextData = (socket) => new Promise((resolve) => socket.once('data', resolve));

test('an HTTP tracker runs the bus with no driver: the trip starts by itself and the bus goes live', async () => {
  const { key, tracker } = await register('860000000000118', '118', 'osmand');
  assert.equal(tracker.fleetCode, 'BSACIST-118');
  assert.equal(await activeTrip('118'), undefined);

  // First moving fix: not yet a trip (the bus must keep moving for a little while).
  const p0 = along('118', 0);
  const first = await osmand(key, { id: '860000000000118', lat: p0.lat, lon: p0.lng, speed: 16, bearing: 45, timestamp: Math.floor(ago(25) / 1000) });
  assert.equal(first.status, 200);
  assert.equal(first.body.outcome, 'WAITING');
  assert.match(first.body.detail, /only just started moving/);

  const p1 = along('118', 200);
  const second = await osmand(key, { id: '860000000000118', lat: p1.lat, lon: p1.lng, speed: 16, bearing: 45, timestamp: Math.floor(Date.now() / 1000) });
  assert.equal(second.body.outcome, 'LIVE', JSON.stringify(second.body));
  const trip = await activeTrip('118');
  assert.equal(trip.started_by, 'tracker');
  assert.ok(trip.driver_id, 'the bus\'s assigned driver is recorded on the trip');

  const live = (await t.call('/api/live?route=118', { token: admin })).body;
  assert.equal(live.length, 1);
  assert.equal(live[0].source, 'tracker');
  assert.ok(Math.abs(live[0].speedKmh - 29.6) < 0.2, `speed ${live[0].speedKmh}`); // 16 knots
  const stored = await t.db.query('SELECT source FROM location_pings WHERE trip_id = $1', [trip.id]);
  assert.deepEqual(stored.rows.map((r) => r.source), ['tracker']);

  // A wrong key or an unknown tracker is refused; the unknown one is listed for the admin.
  assert.equal((await osmand('wrong-key', { id: '860000000000118', lat: p1.lat, lon: p1.lng })).status, 401);
  assert.equal((await osmand(key, { id: '860000000000555', lat: p1.lat, lon: p1.lng })).status, 401);
  const list = (await t.call('/api/admin/trackers', { token: admin })).body;
  assert.ok(list.unknown.some((u) => u.uniqueId === '860000000000555' && u.protocol === 'osmand'));
  const mine = list.trackers.find((x) => x.uniqueId === '860000000000118');
  assert.deepEqual([mine.online, mine.outcome, mine.accepted, mine.sourceOfLive], [true, 'LIVE', 1, 'tracker']);
});

test('the driver\'s phone stands by while the tracker reports, and takes over when it goes quiet', async () => {
  const driver = await t.login('drv118');
  const p = along('118', 260);
  const fix = { lat: p.lat, lng: p.lng, speedKmh: 28, heading: 45, accuracyM: 8, recordedAt: new Date().toISOString() };
  const standby = await t.call('/api/driver/locations', { token: driver, body: { fixes: [fix] } });
  assert.equal(standby.status, 200);
  assert.equal(standby.body.standby, true);
  assert.equal(standby.body.results[0].reason, 'TRACKER_ACTIVE');

  // The tracker has been silent for over a minute: the phone's fixes count again.
  t.tracking.lastTrackerFixAt.set(await busIdOf('118'), Date.now() - 61000);
  const p2 = along('118', 320);
  // 20 s after the tracker's last fix, so the 120 m step is a plausible drive, not a jump.
  const taken = await t.call('/api/driver/locations', { token: driver, body: { fixes: [{ ...fix, lat: p2.lat, lng: p2.lng, recordedAt: new Date(Date.now() + 20000).toISOString() }] } });
  assert.equal(taken.status, 202, JSON.stringify(taken.body));
  assert.equal((await t.call('/api/live?route=118', { token: admin })).body[0].source, 'phone');
});

test('a GT06 tracker over TCP: login acknowledged, positions go live; an unknown IMEI is refused and listed', async () => {
  const server = await t.trackers.listen('gt06', 0);
  const port = server.address().port;
  await register('860000000000119', '119', 'gt06');

  const s = await connect(port);
  let reply = nextData(s);
  s.write(gt06.encodeLogin('860000000000119', 1));
  assert.equal((await reply).toString('hex'), gt06.reply(0x01, 1).toString('hex'));

  const a = along('119', 0);
  const b = along('119', 250);
  s.write(Buffer.concat([
    gt06.encodeLocation({ ...a, speedKmh: 32, heading: 90, time: ago(20) }, 2),
    gt06.encodeLocation({ ...b, speedKmh: 34, heading: 90, time: new Date() }, 3),
  ]));
  const busId = await busIdOf('119');
  const snap = await waitFor(() => t.tracking.latest.get(busId));
  assert.equal(snap.source, 'tracker');
  assert.equal(snap.speedKmh, 34);
  assert.equal((await activeTrip('119')).started_by, 'tracker');

  reply = nextData(s);
  s.write(gt06.encodeHeartbeat({ ignition: true }, 4));
  assert.equal((await reply).toString('hex'), gt06.reply(0x13, 4).toString('hex'));
  const view = (await t.call('/api/admin/trackers', { token: admin })).body.trackers.find((x) => x.uniqueId === '860000000000119');
  assert.deepEqual([view.connected, view.sendingAs, view.info.ignition], [true, 'gt06', true]);

  const stranger = await connect(port);
  const closed = new Promise((resolve) => stranger.once('close', resolve));
  stranger.write(gt06.encodeLogin('860000000000999', 1));
  await closed;
  const unknown = (await t.call('/api/admin/trackers', { token: admin })).body.unknown;
  assert.ok(unknown.some((u) => u.uniqueId === '860000000000999' && u.protocol === 'gt06'));
  s.destroy();
});

test('a Teltonika tracker over TCP: IMEI accepted, records acknowledged by count; an unknown IMEI gets 00', async () => {
  const server = await t.trackers.listen('teltonika', 0);
  const port = server.address().port;
  await register('352093081234567', '117', 'teltonika');

  const s = await connect(port);
  let reply = nextData(s);
  s.write(teltonika.encodeImei('352093081234567'));
  assert.equal((await reply).toString('hex'), '01');

  const a = along('117', 0);
  const b = along('117', 240);
  reply = nextData(s);
  s.write(teltonika.encodePacket([
    { ...a, speedKmh: 30, heading: 10, time: ago(20) },
    { ...b, speedKmh: 31, heading: 12, time: new Date() },
  ]));
  assert.equal((await reply).toString('hex'), '00000002');
  const busId = await busIdOf('117');
  const snap = await waitFor(() => t.tracking.latest.get(busId));
  assert.equal(snap.source, 'tracker');
  assert.equal(snap.speedKmh, 31);

  const stranger = await connect(port);
  reply = nextData(stranger);
  stranger.write(teltonika.encodeImei('352093089999999'));
  assert.equal((await reply).toString('hex'), '00');
  s.destroy();
  stranger.destroy();
});

test('the webhook takes Traccar-forwarded positions, only with the shared secret', async () => {
  await register('860000000000127', '127', 'webhook');
  const p0 = along('127', 0);
  const p1 = along('127', 220);
  const body = (p, at) => ({ device: { uniqueId: '860000000000127' }, position: { latitude: p.lat, longitude: p.lng, speed: 17, course: 30, fixTime: at.toISOString(), valid: true, attributes: { ignition: true } } });

  assert.equal((await t.call('/api/gps/webhook', { body: body(p0, ago(20)) })).status, 403); // no secret configured
  t.config.gps.webhookSecret = 'hook-secret';
  try {
    assert.equal((await t.call('/api/gps/webhook', { body: body(p0, ago(20)), headers: { authorization: 'Bearer nope' } })).status, 401);
    const first = await t.call('/api/gps/webhook', { body: body(p0, ago(20)), headers: { authorization: 'Bearer hook-secret' } });
    assert.deepEqual(first.body, { received: 1, accepted: 0, rejected: 0, unknown: [] }); // moving, trip not started yet
    const second = await t.call('/api/gps/webhook?secret=hook-secret', { body: body(p1, new Date()) });
    assert.equal(second.body.accepted, 1, JSON.stringify(second.body));
    const unknown = await t.call('/api/gps/webhook', { body: { imei: 'nobody-1', lat: 1, lng: 2 }, headers: { 'x-gps-secret': 'hook-secret' } });
    assert.deepEqual(unknown.body.unknown, ['nobody-1']);
  } finally {
    t.config.gps.webhookSecret = null;
  }
  assert.equal((await t.call('/api/live?route=127', { token: admin })).body[0].source, 'tracker');
});

test('a trip the tracker started ends by itself when the tracker goes silent; a driver\'s trip does not', async () => {
  const trip118 = await activeTrip('118');
  assert.equal(trip118.started_by, 'tracker');
  // A driver starts route 110 by hand.
  const driver = await t.login('drv110');
  assert.equal((await t.call('/api/driver/trips', { token: driver, method: 'POST' })).status, 201);

  const ended = await t.trackers.checkTrips(Date.now() + 25 * 60000);
  const ids = ended.map((e) => e.tripId);
  assert.ok(ids.includes(trip118.id), JSON.stringify(ended));
  assert.match(ended.find((e) => e.tripId === trip118.id).reason, /no position from the tracker/);
  assert.equal((await activeTrip('110')).started_by, 'driver'); // untouched
  const logged = await t.db.query(`SELECT reason FROM audit_log WHERE action = 'TRIP_ENDED_BY_TRACKER' AND entity_id = $1`, [String(trip118.id)]);
  assert.equal(logged.rows.length, 1);
});

test('a bus parked at the end of its route for 15 minutes ends the tracker\'s trip', async () => {
  const code = '125';
  const { key } = await register('860000000000125', code, 'osmand');
  const send = (p, s, speed) => osmand(key, { id: '860000000000125', lat: p.lat, lon: p.lng, speed, timestamp: Math.floor(ago(s) / 1000) });
  await send(along(code, 0), 30, 16);
  assert.equal((await send(along(code, 220), 10, 16)).body.outcome, 'LIVE');
  // Now at the last stop, standing still.
  const end = stopsOf[code].at(-1);
  const busId = await busIdOf(code);
  t.tracking.latest.set(busId, { ...t.tracking.latest.get(busId), lat: end.lat, lng: end.lng });
  t.tracking.motion.set(busId, { lat: end.lat, lng: end.lng, movedAt: Date.now() });
  t.tracking.lastTrackerFixAt.set(busId, Date.now() + 14 * 60000); // still reporting
  assert.deepEqual(await t.trackers.checkTrips(Date.now() + 10 * 60000), []);
  const ended = await t.trackers.checkTrips(Date.now() + 16 * 60000);
  assert.equal(ended.length, 1);
  assert.match(ended[0].reason, /parked at the end of the route/);
});

test('no trip outside the trip hours, no bus, no GPS fix, switched off: each says why', async () => {
  const { key, tracker } = await register('osm-spare-1', null, 'osmand');
  const p = along('110', 0);
  const fix = (extra = {}) => osmand(key, { id: 'osm-spare-1', lat: p.lat, lon: p.lng, speed: 20, timestamp: Math.floor(Date.now() / 1000), ...extra });
  assert.equal((await fix()).body.outcome, 'NO_BUS');
  assert.equal((await fix({ valid: 'false' })).body.outcome, 'NO_BUS');

  // On a bus with no trip, outside the trip hours.
  assert.equal((await t.call(`/api/admin/trackers/${tracker.id}`, { token: admin, method: 'PATCH', body: { fleetCode: 'BSACIST-127' } })).status, 409); // 127 has a tracker
  const trips = await t.call('/api/admin/trips', { token: admin });
  assert.ok(trips.body.some((x) => x.started_by === 'tracker'), 'tracker trips are listed for the admin');
  const bus = (await t.call(`/api/admin/trackers/${tracker.id}`, { token: admin, method: 'PATCH', body: { fleetCode: 'BSACIST-101' } })).body.tracker;
  assert.equal(bus.fleetCode, 'BSACIST-101');
  assert.equal((await fix({ valid: 'false' })).body.outcome, 'NO_GPS_FIX');
  const minutes = (localMinutes(new Date(), t.config.timeZone) + 180) % 1440; // a window three hours away
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  t.config.gps.tripWindows = `${hhmm(minutes)}-${hhmm(minutes + 1)}`;
  try {
    const p101 = (await t.call('/api/routes/101')).body.stops[0];
    await osmand(key, { id: 'osm-spare-1', lat: p101.lat, lon: p101.lng, speed: 20, timestamp: Math.floor(ago(30) / 1000) });
    const out = await osmand(key, { id: 'osm-spare-1', lat: p101.lat + 0.002, lon: p101.lng, speed: 20, timestamp: Math.floor(Date.now() / 1000) });
    assert.equal(out.body.outcome, 'WAITING');
    assert.match(out.body.detail, /outside the trip hours/);
  } finally {
    t.config.gps.tripWindows = null;
  }

  assert.equal((await t.call(`/api/admin/trackers/${tracker.id}`, { token: admin, method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await fix()).body.outcome, 'DISABLED');
});

test('admin rules: ids are unique, one tracker per bus, the key is shown once and can be replaced', async () => {
  assert.equal((await t.call('/api/admin/trackers', { token: admin, body: { uniqueId: '860000000000118', fleetCode: 'BSACIST-110' } })).status, 409);
  assert.equal((await t.call('/api/admin/trackers', { token: admin, body: { uniqueId: 'new-one-1', fleetCode: 'BSACIST-118' } })).status, 409);
  assert.equal((await t.call('/api/admin/trackers', { token: admin, body: { uniqueId: 'a b' } })).status, 400);
  assert.equal((await t.call('/api/admin/trackers', { token: admin, body: { uniqueId: 'ok-id-1', protocol: 'smoke-signals' } })).status, 400);
  assert.equal((await t.call('/api/admin/trackers', { token: await t.login('drv118'), body: { uniqueId: 'driver-cannot' } })).status, 403);

  const { key, tracker } = await register('key-test-1', '110', 'osmand');
  const list = (await t.call('/api/admin/trackers', { token: admin })).body.trackers;
  assert.ok(!JSON.stringify(list).includes(key), 'the key is never listed');
  const fresh = (await t.call(`/api/admin/trackers/${tracker.id}/key`, { token: admin, method: 'POST' })).body.key;
  const p = along('110', 0);
  assert.equal((await osmand(key, { id: 'key-test-1', lat: p.lat, lon: p.lng })).status, 401);
  assert.equal((await osmand(fresh, { id: 'key-test-1', lat: p.lat, lon: p.lng })).status, 200);
  assert.equal((await t.call(`/api/admin/trackers/${tracker.id}`, { token: admin, method: 'DELETE' })).status, 200);
  assert.equal((await osmand(fresh, { id: 'key-test-1', lat: p.lat, lon: p.lng })).status, 401);
  const audit = await t.db.query(`SELECT action FROM audit_log WHERE entity = 'tracker' AND entity_id = $1 ORDER BY id`, [String(tracker.id)]);
  assert.deepEqual(audit.rows.map((r) => r.action), ['TRACKER_ADDED', 'TRACKER_KEY_RESET', 'TRACKER_DELETED']);
});
