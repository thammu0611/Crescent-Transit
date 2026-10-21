// Arrival estimates (design document, section 7), shared by server and client.
//
// Progression implemented: straight-line along the route polyline, current and
// average speed, then segment travel time — the timetable's scheduled segment
// minutes at first, replaced per segment by the learned average from recorded
// stop arrivals once enough trips exist. The result is always a band
// ("7-11 min"), never a single minute (Appendix A.1.3).
import { haversineMeters } from './geo.js';

/** Project a point onto the stop polyline: which segment it is on and how far along. */
export function projectOnRoute(stops, point) {
  const kx = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const ky = 110540;
  let best = null;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const ax = a.lng * kx;
    const ay = a.lat * ky;
    const dx = b.lng * kx - ax;
    const dy = b.lat * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.lng * kx - ax) * dx + (point.lat * ky - ay) * dy) / len2));
    const off = Math.hypot(point.lng * kx - (ax + t * dx), point.lat * ky - (ay + t * dy));
    // Prefer the later segment on ties so a bus at a stop counts as having reached it.
    if (!best || off < best.offRouteM - 1 || (Math.abs(off - best.offRouteM) <= 1 && i > best.segment)) {
      best = { segment: i, fraction: t, offRouteM: off };
    }
  }
  return best ?? { segment: 0, fraction: 0, offRouteM: stops[0] ? haversineMeters(stops[0], point) : 0 };
}

/** Segment lengths in metres. */
export function segmentLengths(stops) {
  const out = [];
  for (let i = 0; i < stops.length - 1; i++) out.push(haversineMeters(stops[i], stops[i + 1]));
  return out;
}

/** Scheduled minutes between consecutive stops, from the timetable offsets. */
export function timetableSegmentMinutes(stops) {
  const out = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].offset_minutes ?? stops[i].offsetMinutes;
    const b = stops[i + 1].offset_minutes ?? stops[i + 1].offsetMinutes;
    out.push(Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : null);
  }
  return out;
}

/**
 * Estimated arrival of a bus at one stop.
 *
 * @param stops           ordered [{ seq, lat, lng, offset_minutes? }]
 * @param bus             { lat, lng, speedKmh, recordedAt, freshness }
 * @param targetSeq       stop the student cares about
 * @param segmentMinutes  optional [minutes | null] per segment (learned or timetable)
 * @param options         { defaultSpeedKmh, now }
 * @returns null when unknown, { passed: true } when the bus is past the stop, or
 *          { minutes, low, high, remainingM, stopsRemaining, method, confidence, arrivalAt }
 */
export function estimateArrival(stops, bus, targetSeq, segmentMinutes = null, options = {}) {
  const { defaultSpeedKmh = 20, now = Date.now() } = options;
  const targetIndex = stops.findIndex((s) => s.seq === targetSeq);
  if (targetIndex < 0 || !bus || bus.freshness === 'offline') return null;

  const proj = projectOnRoute(stops, bus);
  const lengths = segmentLengths(stops);
  // Bus is on segment `proj.segment` (between stop i and i+1).
  if (proj.segment >= targetIndex) {
    const atStop = proj.segment === targetIndex && proj.fraction === 0;
    if (!atStop) return { passed: true };
  }

  let remainingM = lengths[proj.segment] * (1 - proj.fraction);
  for (let i = proj.segment + 1; i < targetIndex; i++) remainingM += lengths[i];
  remainingM += proj.offRouteM; // a bus slightly off the line still has to reach it
  const stopsRemaining = targetIndex - proj.segment;

  // 1. Distance / speed: blend the live speed with the historical average.
  const live = Number.isFinite(bus.speedKmh) && bus.speedKmh >= 5 ? bus.speedKmh : null;
  const speed = live ? 0.3 * live + 0.7 * defaultSpeedKmh : defaultSpeedKmh;
  let minutes = (remainingM / 1000 / speed) * 60;
  let method = 'distance-speed';

  // 2. Segment travel time, when every remaining segment has one.
  if (segmentMinutes) {
    const parts = [];
    for (let i = proj.segment; i < targetIndex; i++) parts.push(segmentMinutes[i]);
    if (parts.length && parts.every((m) => Number.isFinite(m))) {
      minutes = parts[0] * (1 - proj.fraction) + parts.slice(1).reduce((s, m) => s + m, 0);
      method = options.segmentSource ?? 'segment-history';
    }
  }

  // Age of the fix: the bus has moved on since it was recorded.
  const ageMin = bus.recordedAt ? Math.max(0, (now - new Date(bus.recordedAt).getTime()) / 60000) : 0;
  minutes = Math.max(0, minutes - ageMin);

  // Band widens with distance and with staleness (doc A.1.3).
  const spread = 0.15 * minutes + 1 + (bus.freshness === 'delayed' ? 2 : 0);
  const low = Math.max(0, Math.floor(minutes - spread));
  const high = Math.ceil(minutes + spread);
  const confidence = bus.freshness === 'delayed' ? 'low' : minutes > 25 ? 'medium' : 'high';
  return {
    minutes: Math.round(minutes),
    low,
    high,
    remainingM: Math.round(remainingM),
    stopsRemaining,
    method,
    confidence,
    arrivalAt: new Date(now + minutes * 60000).toISOString(),
  };
}

/** "Leave now" (doc A.1.1): minutes until the student must start walking. */
export function leaveIn(eta, walkMeters, walkKmh = 4.5) {
  if (!eta || eta.passed) return null;
  const walkMin = Math.ceil((walkMeters / 1000 / walkKmh) * 60);
  return { walkMin, leaveInMin: eta.low - walkMin };
}

/** How close the bus must be to the student's stop before "leave home" turns urgent. */
export const LEAVE_ALERT_M = 2000;

/**
 * "When to leave home", from the bus's live position (doc A.1.1).
 * `eta` is estimateArrival's result. The walk to the stop comes from the
 * student's location when they share it, otherwise a short default is assumed.
 * The leave time uses the early end of the arrival band, so the student is
 * at the stop before the bus even if it runs ahead of the estimate.
 *
 * @returns null when unknown, { state: 'passed' } once the bus is past the stop, or
 *   { state: 'near' | 'far', distanceM, stopsRemaining, walkMin, walkAssumed,
 *     leaveInMin, leaveAt, arriveFrom, arriveTo, confidence }
 */
export function leavePlan(eta, { walkMeters = null, assumedWalkMin = 5, walkKmh = 4.5, alertM = LEAVE_ALERT_M, now = Date.now() } = {}) {
  if (!eta) return null;
  if (eta.passed) return { state: 'passed' };
  const walkMin = walkMeters != null ? Math.max(1, Math.ceil((walkMeters / 1000 / walkKmh) * 60)) : assumedWalkMin;
  const leaveInMin = eta.low - walkMin;
  const at = (min) => new Date(now + Math.max(0, min) * 60000).toISOString();
  return {
    state: eta.remainingM <= alertM ? 'near' : 'far',
    distanceM: eta.remainingM,
    stopsRemaining: eta.stopsRemaining,
    walkMin,
    walkAssumed: walkMeters == null,
    leaveInMin,
    leaveAt: at(leaveInMin),
    arriveFrom: at(eta.low),
    arriveTo: at(eta.high),
    confidence: eta.confidence,
  };
}

/** Mean absolute error in minutes, doc 7.3. */
export function meanAbsoluteError(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((s, [actual, predicted]) => s + Math.abs(actual - predicted), 0) / pairs.length;
}
