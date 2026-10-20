// Positions that arrive over HTTP, in the formats GPS hardware and platforms use.
// Each parser returns [{ uniqueId, fix, info }] with the pipeline's units:
// km/h, degrees, metres, ISO time.

const KNOTS_TO_KMH = 1.852;

const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
// Unknown readings arrive as -1 from some senders.
const nonNegative = (v) => (v === undefined || v < 0 ? undefined : v);
const bool = (v) => (v === undefined ? undefined : v === true || v === 1 || /^(1|true|on|yes)$/i.test(String(v)));

/** Unix seconds, Unix milliseconds or an ISO string -> ISO string (or undefined). */
export function parseTime(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * OsmAnd protocol, as spoken by Traccar Client, OsmAnd and trackers with an
 * "HTTP" upload mode: ?id=&lat=&lon=&timestamp=&speed(knots)=&bearing=&accuracy=
 * Parameters may come in the query string or a form body. Also the JSON body
 * newer Traccar Client versions post ({ device_id, location: { coords, ... } }).
 */
export function parseOsmand(query = {}, body = {}) {
  if (body && typeof body === 'object' && body.location && typeof body.location === 'object') {
    const loc = body.location;
    const c = loc.coords ?? {};
    const speedMs = nonNegative(num(c.speed));
    return [{
      uniqueId: String(body.device_id ?? query.id ?? '').trim(),
      fix: {
        lat: num(c.latitude),
        lng: num(c.longitude),
        speedKmh: speedMs === undefined ? undefined : Math.round(speedMs * 3.6 * 10) / 10,
        heading: nonNegative(num(c.heading)),
        accuracyM: nonNegative(num(c.accuracy)),
        recordedAt: parseTime(loc.timestamp) ?? new Date().toISOString(),
        valid: true,
      },
      info: {
        batteryPct: loc.battery?.level === undefined ? undefined : Math.round(Number(loc.battery.level) * 100),
        charging: loc.battery?.is_charging,
      },
    }];
  }
  const p = { ...(body && typeof body === 'object' ? body : {}), ...query };
  let lat = num(p.lat);
  let lng = num(p.lon ?? p.lng);
  if ((lat === undefined || lng === undefined) && typeof p.location === 'string') {
    [lat, lng] = p.location.split(',').map(num);
  }
  const knots = nonNegative(num(p.speed));
  return [{
    uniqueId: String(p.id ?? p.deviceid ?? '').trim(),
    fix: {
      lat,
      lng,
      speedKmh: knots === undefined ? undefined : Math.round(knots * KNOTS_TO_KMH * 10) / 10,
      heading: nonNegative(num(p.bearing ?? p.heading ?? p.course)),
      accuracyM: nonNegative(num(p.accuracy)),
      recordedAt: parseTime(p.timestamp) ?? new Date().toISOString(),
      valid: p.valid === undefined ? true : bool(p.valid),
    },
    info: { batteryPct: num(p.batt), ignition: bool(p.ignition), hdop: num(p.hdop) },
  }];
}

/**
 * Webhook bodies:
 *   - Traccar position forwarding (forward.type=json): { position, device }
 *     with speed in knots and fixTime;
 *   - a generic list from a vendor platform or your own bridge:
 *     { uniqueId|imei|deviceId, lat, lng, speedKmh, heading, accuracyM, recordedAt }
 *     as one object, an array, or { positions: [...] }.
 */
export function parseWebhook(body) {
  if (body && typeof body === 'object' && body.position && body.device) {
    const pos = body.position;
    const attrs = pos.attributes ?? {};
    const knots = nonNegative(num(pos.speed));
    return [{
      uniqueId: String(body.device.uniqueId ?? '').trim(),
      fix: {
        lat: num(pos.latitude),
        lng: num(pos.longitude),
        speedKmh: knots === undefined ? undefined : Math.round(knots * KNOTS_TO_KMH * 10) / 10,
        heading: nonNegative(num(pos.course)),
        accuracyM: nonNegative(num(pos.accuracy)) || undefined, // Traccar sends 0 when unknown
        recordedAt: parseTime(pos.fixTime ?? pos.deviceTime) ?? new Date().toISOString(),
        valid: pos.valid !== false,
      },
      info: {
        ignition: attrs.ignition,
        batteryPct: num(attrs.batteryLevel),
        satellites: num(attrs.sat),
        externalVoltage: num(attrs.power),
      },
    }];
  }
  const list = Array.isArray(body) ? body : Array.isArray(body?.positions) ? body.positions : body && typeof body === 'object' ? [body] : [];
  return list.map((p) => ({
    uniqueId: String(p.uniqueId ?? p.imei ?? p.deviceId ?? p.id ?? '').trim(),
    fix: {
      lat: num(p.lat ?? p.latitude),
      lng: num(p.lng ?? p.lon ?? p.longitude),
      speedKmh: nonNegative(num(p.speedKmh ?? p.speed)),
      heading: nonNegative(num(p.heading ?? p.course ?? p.bearing)),
      accuracyM: nonNegative(num(p.accuracyM ?? p.accuracy)),
      recordedAt: parseTime(p.recordedAt ?? p.time ?? p.timestamp ?? p.fixTime) ?? new Date().toISOString(),
      valid: p.valid === undefined ? true : bool(p.valid),
    },
    info: { ignition: p.ignition === undefined ? undefined : bool(p.ignition), batteryPct: num(p.batteryPct ?? p.battery) },
  }));
}
