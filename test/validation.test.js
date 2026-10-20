import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { REJECT, serviceAreaFromStops, validateFix } from '../server/validation.js';
import { freshnessOf } from '../shared/freshness.js';
import { haversineMeters, PathWalker } from '../shared/geo.js';

const limits = loadConfig().validation;
const area = serviceAreaFromStops([{ lat: 12.87, lng: 80.08 }, { lat: 13.16, lng: 80.30 }], 0.25);
const NOW = new Date('2026-09-30T08:00:00Z');
const at = (secondsBefore) => new Date(NOW.getTime() - secondsBefore * 1000).toISOString();
const good = { lat: 12.98, lng: 80.22, speedKmh: 30, heading: 90, accuracyM: 8, recordedAt: at(2) };
const check = (fix, previous = null) => validateFix(fix, previous, limits, area, NOW);

test('accepts a normal fix and normalises it', () => {
  const r = check(good);
  assert.equal(r.ok, true);
  assert.ok(r.fix.recordedAt instanceof Date);
});

test('optional sensor fields may be missing', () => {
  const r = check({ lat: 12.98, lng: 80.22, recordedAt: at(1) });
  assert.equal(r.ok, true);
  assert.equal(r.fix.speedKmh, null);
});

const rejections = [
  ['non-numeric latitude', { ...good, lat: '12.9' }, REJECT.INVALID_COORDINATES],
  ['latitude beyond 90', { ...good, lat: 95 }, REJECT.INVALID_COORDINATES],
  ['0,0 before GPS lock', { ...good, lat: 0, lng: 0 }, REJECT.NULL_ISLAND],
  ['position in Bengaluru', { ...good, lat: 12.97, lng: 77.59 }, REJECT.OUTSIDE_SERVICE_AREA],
  ['accuracy of 500 m', { ...good, accuracyM: 500 }, REJECT.LOW_ACCURACY],
  ['speed of 200 km/h', { ...good, speedKmh: 200 }, REJECT.INVALID_SPEED],
  ['negative speed', { ...good, speedKmh: -3 }, REJECT.INVALID_SPEED],
  ['heading of 400', { ...good, heading: 400 }, REJECT.INVALID_HEADING],
  ['missing timestamp', { ...good, recordedAt: undefined }, REJECT.INVALID_TIMESTAMP],
  ['unparseable timestamp', { ...good, recordedAt: 'yesterday' }, REJECT.INVALID_TIMESTAMP],
  ['timestamp 5 min ahead', { ...good, recordedAt: at(-300) }, REJECT.FUTURE_TIMESTAMP],
  ['fix 20 minutes old', { ...good, recordedAt: at(1200) }, REJECT.STALE_FIX],
];
for (const [name, fix, reason] of rejections) {
  test(`rejects ${name}`, () => {
    const r = check(fix);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
  });
}

test('allows small clock skew into the future', () => {
  assert.equal(check({ ...good, recordedAt: at(-10) }).ok, true);
});

test('rejects a fix that is not newer than the previous one', () => {
  const previous = { lat: 12.98, lng: 80.22, recordedAt: at(2) };
  assert.equal(check({ ...good, recordedAt: at(2) }, previous).reason, REJECT.OUT_OF_ORDER);
  assert.equal(check({ ...good, recordedAt: at(5) }, previous).reason, REJECT.OUT_OF_ORDER);
});

test('rejects a jump no bus can make, accepts normal driving', () => {
  const previous = { lat: 12.98, lng: 80.22, recordedAt: at(12) };
  // ~11 km in 10 s
  assert.equal(check({ ...good, lat: 13.08, recordedAt: at(2) }, previous).reason, REJECT.IMPOSSIBLE_JUMP);
  // ~110 m in 10 s = 40 km/h
  assert.equal(check({ ...good, lat: 12.981, recordedAt: at(2) }, previous).ok, true);
});

test('GPS jitter under 50 m is never treated as a jump', () => {
  const previous = { lat: 12.98, lng: 80.22, recordedAt: at(3) };
  // 30 m in 1 s would be 108 km/h, but it is within jitter tolerance
  assert.equal(check({ ...good, lat: 12.98027, recordedAt: at(2) }, previous).ok, true);
});

test('freshness state machine: live <= 30 s, delayed <= 2 min, then offline', () => {
  const now = NOW.getTime();
  assert.equal(freshnessOf(at(0), now), 'live');
  assert.equal(freshnessOf(at(30), now), 'live');
  assert.equal(freshnessOf(at(31), now), 'delayed');
  assert.equal(freshnessOf(at(120), now), 'delayed');
  assert.equal(freshnessOf(at(121), now), 'offline');
  assert.equal(freshnessOf(null, now), 'offline');
});

test('haversine distance matches a known value', () => {
  // Chennai Central to BSACIST campus is about 31 km in a straight line.
  const d = haversineMeters({ lat: 13.0827, lng: 80.2757 }, { lat: 12.8737, lng: 80.0823 });
  assert.ok(d > 30000 && d < 32000, `got ${d}`);
});

test('PathWalker walks a route by distance', () => {
  const w = new PathWalker([{ lat: 12.9, lng: 80.1 }, { lat: 12.91, lng: 80.1 }, { lat: 12.91, lng: 80.11 }]);
  assert.ok(Math.abs(w.at(0).lat - 12.9) < 1e-9);
  assert.equal(w.at(w.length + 100).done, true);
  const mid = w.at(w.cumulative[1] / 2);
  assert.ok(Math.abs(mid.lat - 12.905) < 1e-6);
  assert.ok(mid.heading < 1 || mid.heading > 359, 'first leg heads due north');
});
