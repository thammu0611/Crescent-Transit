import { haversineMeters } from '../shared/geo.js';

/** Reasons a GPS fix can be rejected. Stored in rejected_pings.reason. */
export const REJECT = {
  INVALID_COORDINATES: 'INVALID_COORDINATES',
  NULL_ISLAND: 'NULL_ISLAND',
  OUTSIDE_SERVICE_AREA: 'OUTSIDE_SERVICE_AREA',
  LOW_ACCURACY: 'LOW_ACCURACY',
  INVALID_SPEED: 'INVALID_SPEED',
  INVALID_HEADING: 'INVALID_HEADING',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  FUTURE_TIMESTAMP: 'FUTURE_TIMESTAMP',
  STALE_FIX: 'STALE_FIX',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  IMPOSSIBLE_JUMP: 'IMPOSSIBLE_JUMP',
};

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const optionalNumber = (v) => v === undefined || v === null || isFiniteNumber(v);

/**
 * Bounding box around every boarding point, widened by a margin.
 * A fix outside it cannot belong to a university bus.
 */
export function serviceAreaFromStops(stops, marginDeg) {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  return {
    minLat: Math.min(...lats) - marginDeg,
    maxLat: Math.max(...lats) + marginDeg,
    minLng: Math.min(...lngs) - marginDeg,
    maxLng: Math.max(...lngs) + marginDeg,
  };
}

/**
 * Check one GPS fix before it is stored or broadcast.
 *
 * @param fix       { lat, lng, speedKmh?, heading?, accuracyM?, recordedAt }
 * @param previous  last accepted fix for this bus in this trip, or null
 * @param limits    config.validation
 * @param area      service area box from serviceAreaFromStops, or null
 * @param now       server time (Date), injectable for tests
 * @returns { ok: true, fix } with normalised values, or { ok: false, reason, detail }
 */
export function validateFix(fix, previous, limits, area, now = new Date()) {
  const fail = (reason, detail) => ({ ok: false, reason, detail });

  if (!fix || typeof fix !== 'object') return fail(REJECT.INVALID_COORDINATES, 'fix must be an object');
  const { lat, lng, speedKmh, heading, accuracyM, recordedAt } = fix;

  // 1. Coordinates must be real numbers on the globe.
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return fail(REJECT.INVALID_COORDINATES, 'lat must be -90..90 and lng -180..180');
  }
  // 2. (0, 0) is what many GPS stacks report before they have a fix.
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) {
    return fail(REJECT.NULL_ISLAND, 'device reported 0,0 (no GPS fix yet)');
  }
  // 3. Must be inside the area the university buses actually serve.
  if (area && (lat < area.minLat || lat > area.maxLat || lng < area.minLng || lng > area.maxLng)) {
    return fail(REJECT.OUTSIDE_SERVICE_AREA, 'position is outside the bus service area');
  }
  // 4. Optional sensor values must be plausible.
  if (!optionalNumber(accuracyM) || (isFiniteNumber(accuracyM) && (accuracyM < 0 || accuracyM > limits.maxAccuracyM))) {
    return fail(REJECT.LOW_ACCURACY, `accuracy must be 0..${limits.maxAccuracyM} m`);
  }
  if (!optionalNumber(speedKmh) || (isFiniteNumber(speedKmh) && (speedKmh < 0 || speedKmh > limits.maxSpeedKmh))) {
    return fail(REJECT.INVALID_SPEED, `speed must be 0..${limits.maxSpeedKmh} km/h`);
  }
  if (!optionalNumber(heading) || (isFiniteNumber(heading) && (heading < 0 || heading > 360))) {
    return fail(REJECT.INVALID_HEADING, 'heading must be 0..360 degrees');
  }

  // 5. Timestamp must parse and be neither in the future nor too old.
  const recorded = new Date(recordedAt);
  if (recordedAt === undefined || recordedAt === null || Number.isNaN(recorded.getTime())) {
    return fail(REJECT.INVALID_TIMESTAMP, 'recordedAt must be an ISO date-time');
  }
  const ageS = (now.getTime() - recorded.getTime()) / 1000;
  if (ageS < -limits.maxFutureSkewS) return fail(REJECT.FUTURE_TIMESTAMP, `fix is ${Math.round(-ageS)} s in the future`);
  if (ageS > limits.maxAgeS) return fail(REJECT.STALE_FIX, `fix is ${Math.round(ageS)} s old`);

  // 6. Compare with the previous accepted fix of the same trip.
  if (previous) {
    const dtS = (recorded.getTime() - new Date(previous.recordedAt).getTime()) / 1000;
    if (dtS <= 0) return fail(REJECT.OUT_OF_ORDER, 'fix is not newer than the last accepted fix');
    const distanceM = haversineMeters(previous, { lat, lng });
    const impliedKmh = (distanceM / dtS) * 3.6;
    // Small moves are always allowed: GPS jitter over 1-2 s can look fast.
    if (distanceM > 50 && impliedKmh > limits.maxImpliedSpeedKmh) {
      return fail(REJECT.IMPOSSIBLE_JUMP, `jump of ${Math.round(distanceM)} m in ${dtS.toFixed(1)} s (${Math.round(impliedKmh)} km/h)`);
    }
  }

  return {
    ok: true,
    fix: {
      lat,
      lng,
      speedKmh: isFiniteNumber(speedKmh) ? speedKmh : null,
      heading: isFiniteNumber(heading) ? heading : null,
      accuracyM: isFiniteNumber(accuracyM) ? accuracyM : null,
      recordedAt: recorded,
    },
  };
}
