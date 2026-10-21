// GPS co-location rules for automatic attendance (design document, section 9.3).
//
// Pure functions: they take positions and return verdicts, so the whole rule
// set can be checked against recorded traces in milliseconds, without a bus.
import { bearingDegrees, haversineMeters } from './geo.js';

export const DEFAULT_RULES = {
  maxDistanceM: 50, // a student in the next street
  maxSkewS: 30, // a fresh fix compared against a stale one
  minSpeedKmh: 8, // a student standing at the stop while the bus waits
  maxBearingDeltaDeg: 30, // a student in a car going the other way
  persistenceMatches: 2, // one noisy GPS reading
  persistenceSpanS: 40,
  maxGapS: 75, // two matches further apart than this are not "in a row"
  alightDistanceM: 150, // the student has got off
  alightSamples: 2,
  promptTimeoutS: 180, // unanswered prompt -> PROVISIONAL or dropped
  provisionalMinS: 90, // co-location needed for PROVISIONAL
  noCooldownS: 600, // after "No", that bus is not proposed again for 10 min
  pendingPromptMaxS: 1800, // the prompt waits in the app for up to 30 min
  corridorM: 300, // sampling only near a route corridor (doc 9.10)
};

export const MATCH_FAIL = {
  STALE: 'TIME_SKEW',
  DISTANCE: 'TOO_FAR',
  SPEED: 'TOO_SLOW',
  BEARING: 'WRONG_DIRECTION',
  BEARING_UNKNOWN: 'NO_BEARING',
};

/** Smallest angle between two compass bearings, 0..180. */
export function angularDifference(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Cheap rejection before the trigonometry: is b within `meters` of a on both axes? */
export function withinBox(a, b, meters) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((a.lat * Math.PI) / 180));
  return Math.abs(a.lat - b.lat) <= dLat && Math.abs(a.lng - b.lng) <= dLng;
}

/**
 * One comparison of a student device fix with a bus fix.
 *
 * @param device { lat, lng, ts (ms), speedKmh, bearing }  speed/bearing may be null
 * @param bus    { lat, lng, ts (ms), speedKmh, bearing }
 * @returns { match, reason?, distanceM, dtS, bearingDelta }
 */
export function matchFix(device, bus, rules = DEFAULT_RULES) {
  const dtS = Math.abs(device.ts - bus.ts) / 1000;
  const out = { match: false, distanceM: null, dtS, bearingDelta: null, speedKmh: device.speedKmh ?? null };
  if (dtS > rules.maxSkewS) return { ...out, reason: MATCH_FAIL.STALE };

  if (!withinBox(device, bus, rules.maxDistanceM * 2)) return { ...out, reason: MATCH_FAIL.DISTANCE };
  const distanceM = haversineMeters(device, bus);
  out.distanceM = distanceM;
  if (distanceM > rules.maxDistanceM) return { ...out, reason: MATCH_FAIL.DISTANCE };

  if (!(device.speedKmh > rules.minSpeedKmh)) return { ...out, reason: MATCH_FAIL.SPEED };

  if (device.bearing == null || bus.bearing == null) return { ...out, reason: MATCH_FAIL.BEARING_UNKNOWN };
  const bearingDelta = angularDifference(device.bearing, bus.bearing);
  out.bearingDelta = bearingDelta;
  if (bearingDelta > rules.maxBearingDeltaDeg) return { ...out, reason: MATCH_FAIL.BEARING };

  return { ...out, match: true };
}

/** The document's isOnBoard(): one match; the caller requires two in a row. */
export const isOnBoard = (device, bus, rules = DEFAULT_RULES) => matchFix(device, bus, rules).match;

/**
 * Fill in speed and bearing a phone did not report, from its previous fix.
 * Browsers often give neither; a moving phone still reveals both.
 */
export function deriveMotion(fix, previous) {
  let { speedKmh, bearing } = fix;
  if (previous && fix.ts > previous.ts) {
    const dist = haversineMeters(previous, fix);
    const dt = (fix.ts - previous.ts) / 1000;
    if (speedKmh == null && dt <= 120) speedKmh = (dist / dt) * 3.6;
    if (bearing == null && dist >= 15) bearing = bearingDegrees(previous, fix);
  }
  return { ...fix, speedKmh: speedKmh ?? null, bearing: bearing ?? null };
}

/**
 * Persistence (doc 9.3): a candidate becomes a boarding only after
 * `persistenceMatches` consecutive matches on the same trip spanning at
 * least `persistenceSpanS` seconds.
 *
 * @param candidate  previous state or null: { tripId, firstTs, lastTs, count }
 * @param tripId     trip matched by this fix, or null when nothing matched
 * @param ts         time of this fix (ms)
 * @returns { candidate, ready }
 */
export function advanceCandidate(candidate, tripId, ts, rules = DEFAULT_RULES) {
  if (tripId == null) return { candidate: null, ready: false };
  const continues = candidate && candidate.tripId === tripId && (ts - candidate.lastTs) / 1000 <= rules.maxGapS;
  const next = continues
    ? { ...candidate, lastTs: ts, count: candidate.count + 1 }
    : { tripId, firstTs: ts, lastTs: ts, count: 1 };
  const ready = next.count >= rules.persistenceMatches && (next.lastTs - next.firstTs) / 1000 >= rules.persistenceSpanS;
  return { candidate: next, ready };
}

/**
 * What an unanswered prompt becomes after the timeout (doc 9.4):
 * PROVISIONAL if device and bus stayed together for provisionalMinS, else dropped.
 */
export function unansweredOutcome(firstMatchMs, lastMatchMs, rules = DEFAULT_RULES) {
  return (lastMatchMs - firstMatchMs) / 1000 >= rules.provisionalMinS ? 'PROVISIONAL' : 'DROP';
}

/** Confidence 0..1 from the match evidence: closer, better aligned, longer = higher. */
export function confidenceScore({ distanceM, bearingDelta, spanS }, rules = DEFAULT_RULES) {
  const d = 1 - Math.min(1, (distanceM ?? rules.maxDistanceM) / rules.maxDistanceM) * 0.5;
  const b = 1 - Math.min(1, (bearingDelta ?? rules.maxBearingDeltaDeg) / rules.maxBearingDeltaDeg) * 0.3;
  const p = Math.min(1, (spanS ?? 0) / (rules.provisionalMinS * 2));
  return Math.round(Math.min(1, d * b * (0.7 + 0.3 * p)) * 1000) / 1000;
}

/** Distance in metres from a point to a polyline of {lat,lng} (equirectangular, fine below ~50 km). */
export function distanceToPolylineM(point, line) {
  if (!line.length) return Infinity;
  const kx = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const ky = 110540;
  const px = point.lng * kx;
  const py = point.lat * ky;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = line[i].lng * kx;
    const ay = line[i].lat * ky;
    if (i === line.length - 1) {
      best = Math.min(best, Math.hypot(px - ax, py - ay));
      break;
    }
    const bx = line[i + 1].lng * kx;
    const by = line[i + 1].lat * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Parse "06:00-10:30,15:30-19:30" into [[360, 630], [930, 1170]]; null if malformed. */
export function parseWindows(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const out = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    if (Number(m[2]) > 59 || Number(m[4]) > 59 || from > 1440 || to > 1440 || from >= to) return null;
    out.push([from, to]);
  }
  return out;
}

export const inWindows = (minutes, windows) => windows.some(([from, to]) => minutes >= from && minutes < to);
