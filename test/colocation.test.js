// Unit tests for the attendance matching rules (doc 9.3) and the ETA
// (doc 7). Pure functions, checked against synthetic GPS traces that include
// the known false positives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  MATCH_FAIL,
  advanceCandidate,
  angularDifference,
  deriveMotion,
  distanceToPolylineM,
  inWindows,
  isOnBoard,
  matchFix,
  parseWindows,
  unansweredOutcome,
} from '../shared/colocation.js';
import { estimateArrival, leaveIn, leavePlan, meanAbsoluteError, projectOnRoute } from '../shared/eta.js';
import { PathWalker } from '../shared/geo.js';

const T0 = Date.parse('2026-09-15T08:14:00Z');
const bus = { lat: 12.9716, lng: 80.2209, ts: T0, speedKmh: 30, bearing: 90 };
// ~ n metres east of the bus
const east = (m) => bus.lng + m / (111320 * Math.cos((bus.lat * Math.PI) / 180));

test('a student on the bus matches: close, fresh, moving, same direction', () => {
  const device = { lat: bus.lat, lng: east(12), ts: T0 + 3000, speedKmh: 28, bearing: 95 };
  const v = matchFix(device, bus);
  assert.equal(v.match, true);
  assert.ok(v.distanceM > 10 && v.distanceM < 14);
  assert.equal(isOnBoard(device, bus), true);
});

test('each threshold removes its own false positive', () => {
  const ok = { lat: bus.lat, lng: east(10), ts: T0, speedKmh: 30, bearing: 90 };
  assert.equal(matchFix({ ...ok, lng: east(80) }, bus).reason, MATCH_FAIL.DISTANCE, 'a student in the next street');
  assert.equal(matchFix({ ...ok, ts: T0 + 45000 }, bus).reason, MATCH_FAIL.STALE, 'a fresh fix vs a stale one');
  assert.equal(matchFix({ ...ok, speedKmh: 3 }, bus).reason, MATCH_FAIL.SPEED, 'standing at the stop while the bus waits');
  assert.equal(matchFix({ ...ok, speedKmh: 8 }, bus).reason, MATCH_FAIL.SPEED, 'exactly 8 km/h is not > 8');
  assert.equal(matchFix({ ...ok, bearing: 270 }, bus).reason, MATCH_FAIL.BEARING, 'a car going the other way');
  assert.equal(matchFix({ ...ok, bearing: 125 }, bus).reason, MATCH_FAIL.BEARING, '35 degrees off');
  assert.equal(matchFix({ ...ok, bearing: null }, bus).reason, MATCH_FAIL.BEARING_UNKNOWN);
  assert.equal(matchFix({ ...ok, bearing: 119 }, bus).match, true, '29 degrees is within 30');
});

test('bearing difference wraps around north', () => {
  assert.equal(angularDifference(350, 10), 20);
  assert.equal(angularDifference(10, 350), 20);
  assert.equal(angularDifference(0, 180), 180);
  assert.equal(angularDifference(725, 5), 0);
});

test('persistence: two matches spanning at least 40 s, on the same trip, in a row', () => {
  let s = advanceCandidate(null, 7, T0);
  assert.equal(s.ready, false, 'one noisy reading is never enough');
  s = advanceCandidate(s.candidate, 7, T0 + 20000);
  assert.equal(s.ready, false, 'two matches 20 s apart do not span 40 s');
  s = advanceCandidate(s.candidate, 7, T0 + 41000);
  assert.equal(s.ready, true);
  assert.equal(s.candidate.count, 3);

  const other = advanceCandidate(advanceCandidate(null, 7, T0).candidate, 8, T0 + 45000);
  assert.equal(other.ready, false, 'a match on another trip starts over');
  const gap = advanceCandidate(advanceCandidate(null, 7, T0).candidate, 7, T0 + 90000);
  assert.equal(gap.ready, false, 'matches 90 s apart are not consecutive');
  assert.equal(advanceCandidate(s.candidate, null, T0 + 60000).candidate, null, 'a miss resets');
});

test('unanswered prompt: PROVISIONAL after 90 s of co-location, otherwise dropped', () => {
  assert.equal(unansweredOutcome(T0, T0 + 95000), 'PROVISIONAL');
  assert.equal(unansweredOutcome(T0, T0 + 45000), 'DROP');
});

test('speed and bearing are derived when the phone does not report them', () => {
  const prev = { lat: bus.lat, lng: bus.lng, ts: T0 };
  const d = deriveMotion({ lat: bus.lat, lng: east(100), ts: T0 + 10000, speedKmh: null, bearing: null }, prev);
  assert.ok(Math.abs(d.speedKmh - 36) < 1, `speed ${d.speedKmh}`);
  assert.ok(angularDifference(d.bearing, 90) < 1, `bearing ${d.bearing}`);
  const still = deriveMotion({ lat: bus.lat, lng: east(3), ts: T0 + 10000, speedKmh: null, bearing: null }, prev);
  assert.equal(still.bearing, null, 'no bearing from a 3 m wobble');
});

/** Replay a trace: bus along a line at 30 km/h; the device follows a rule. */
function replay(deviceAt, rules = DEFAULT_RULES) {
  const line = new PathWalker([{ lat: 12.97, lng: 80.2 }, { lat: 12.97, lng: 80.23 }]);
  let candidate = null;
  let readyAt = null;
  let prevDevice = null;
  for (let t = 0; t <= 180; t += 20) {
    const p = line.at((30 / 3.6) * t);
    const b = { lat: p.lat, lng: p.lng, ts: T0 + t * 1000, speedKmh: 30, bearing: p.heading };
    const raw = deviceAt(t, p);
    const dev = deriveMotion({ ...raw, ts: T0 + t * 1000 + 2000 }, prevDevice);
    prevDevice = dev;
    const r = advanceCandidate(candidate, matchFix(dev, b, rules).match ? 1 : null, dev.ts, rules);
    candidate = r.candidate;
    if (r.ready && readyAt === null) readyAt = t;
  }
  return readyAt;
}

test('trace: a student riding the bus is detected after 40 s', () => {
  const readyAt = replay((t, p) => ({ lat: p.lat + 0.00005, lng: p.lng, speedKmh: null, bearing: null }));
  assert.equal(readyAt, 60, 'matches at t=20 (first with a derived bearing), 40, 60 -> ready at 60 s');
});

test('trace: a student walking on the pavement beside the route is never detected', () => {
  const walk = (t) => ({ lat: 12.97 + 0.0001, lng: 80.2 + ((4.5 / 3.6) * t) / 109000, speedKmh: null, bearing: null });
  assert.equal(replay(walk), null);
});

test('trace: two buses passing a student who waits at the stop write nothing', () => {
  const stop = (t) => ({ lat: 12.97, lng: 80.2 + ((30 / 3.6) * 40) / 109000, speedKmh: 0, bearing: null });
  assert.equal(replay(stop), null);
});

test('trace: a car driving the opposite way past the bus is never detected', () => {
  const opposite = (t, p) => ({ lat: p.lat + 0.0002, lng: 80.2 + (1500 - (30 / 3.6) * t) / 109000, speedKmh: 30, bearing: 270 });
  assert.equal(replay(opposite), null);
});

test('travel windows parse and apply', () => {
  const w = parseWindows('06:00-10:30, 15:30-19:30');
  assert.deepEqual(w, [[360, 630], [930, 1170]]);
  assert.equal(inWindows(8 * 60, w), true);
  assert.equal(inWindows(12 * 60, w), false);
  assert.equal(parseWindows('10:00-09:00'), null);
  assert.equal(parseWindows('nonsense'), null);
  assert.deepEqual(parseWindows('00:00-24:00'), [[0, 1440]]);
});

test('distance to a route corridor', () => {
  const line = [{ lat: 12.97, lng: 80.2 }, { lat: 12.97, lng: 80.21 }];
  const d = distanceToPolylineM({ lat: 12.9727, lng: 80.205 }, line);
  assert.ok(Math.abs(d - 298) < 5, `distance ${d}`);
});

// ---- ETA (doc section 7) ----------------------------------------------------

// Two stops 3 km apart, due east.
const stops = [
  { seq: 1, lat: 12.97, lng: 80.2, offset_minutes: 0 },
  { seq: 2, lat: 12.97, lng: 80.2 + 3000 / (111320 * Math.cos((12.97 * Math.PI) / 180)), offset_minutes: 12 },
];

test('basic ETA: 3 km at 20 km/h is 9 minutes (the document\'s worked example)', () => {
  const now = Date.now();
  const eta = estimateArrival(stops, { lat: 12.97, lng: 80.2, speedKmh: 0, recordedAt: new Date(now).toISOString(), freshness: 'live' }, 2, null, { defaultSpeedKmh: 20, now });
  assert.equal(eta.minutes, 9);
  assert.equal(eta.method, 'distance-speed');
  assert.ok(eta.low < 9 && eta.high > 9, 'shown as a band, never a single minute');
});

test('segment history replaces distance/speed when every segment has a time', () => {
  const now = Date.now();
  const half = { lat: 12.97, lng: (stops[0].lng + stops[1].lng) / 2, speedKmh: 25, recordedAt: new Date(now).toISOString(), freshness: 'live' };
  const eta = estimateArrival(stops, half, 2, [12], { now, segmentSource: 'timetable' });
  assert.equal(eta.minutes, 6);
  assert.equal(eta.method, 'timetable');
});

test('ETA: delayed fixes widen the band; offline has no ETA; a passed stop says so', () => {
  const now = Date.now();
  const at = { lat: 12.97, lng: 80.2, speedKmh: 20, recordedAt: new Date(now).toISOString() };
  const live = estimateArrival(stops, { ...at, freshness: 'live' }, 2, null, { now });
  const delayed = estimateArrival(stops, { ...at, freshness: 'delayed' }, 2, null, { now });
  assert.ok(delayed.high - delayed.low > live.high - live.low);
  assert.equal(delayed.confidence, 'low');
  assert.equal(estimateArrival(stops, { ...at, freshness: 'offline' }, 2, null, { now }), null);
  const beyond = { ...at, lng: stops[1].lng, freshness: 'live' };
  assert.equal(projectOnRoute(stops, beyond).fraction, 1);
  assert.deepEqual(estimateArrival([...stops, { seq: 3, lat: 12.97, lng: stops[1].lng + 0.02 }], { ...beyond, lng: stops[1].lng + 0.01 }, 2, null, { now }), { passed: true });
});

test('"Leave now" subtracts the walk from the early end of the band', () => {
  assert.deepEqual(leaveIn({ low: 10, high: 14 }, 375), { walkMin: 5, leaveInMin: 5 });
});

test('mean absolute error', () => {
  assert.equal(meanAbsoluteError([[10, 12], [5, 4], [8, 8]]), 1);
  assert.equal(meanAbsoluteError([]), null);
});

test('leave home: urgent within 2 km of the stop, timed from the bus GPS and the walk', () => {
  const now = Date.now();
  const bus = (lng) => ({ lat: 12.97, lng, speedKmh: 0, recordedAt: new Date(now).toISOString(), freshness: 'live' });
  // 3 km away: not yet urgent, a default 5-minute walk is assumed.
  const far = leavePlan(estimateArrival(stops, bus(80.2), 2, null, { defaultSpeedKmh: 20, now }), { now });
  assert.equal(far.state, 'far');
  assert.ok(far.distanceM > 2000);
  assert.equal(far.walkAssumed, true);
  assert.equal(far.walkMin, 5);
  // Half way (1.5 km): urgent, and the leave time is the band's early end minus the walk.
  const half = (stops[0].lng + stops[1].lng) / 2;
  const eta = estimateArrival(stops, bus(half), 2, null, { defaultSpeedKmh: 20, now });
  const near = leavePlan(eta, { walkMeters: 450, now });
  assert.equal(near.state, 'near');
  assert.equal(near.walkMin, 6); // 450 m at 4.5 km/h
  assert.equal(near.leaveInMin, eta.low - 6);
  assert.ok(new Date(near.arriveFrom) <= new Date(near.arriveTo));
  // Past the stop, or no estimate.
  assert.deepEqual(leavePlan({ passed: true }), { state: 'passed' });
  assert.equal(leavePlan(null), null);
});
