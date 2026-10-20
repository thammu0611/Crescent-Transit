// Geometry helpers shared by the server, the simulator and the driver app.

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0-360 degrees. */
export function bearingDegrees(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * A polyline that can be walked by distance. Used to move a simulated bus
 * along its route at a realistic speed.
 */
export class PathWalker {
  constructor(points) {
    if (points.length < 2) throw new Error('A path needs at least two points');
    this.points = points;
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
  }

  /** Position and heading after travelling `distance` metres from the start. */
  at(distance) {
    const d = Math.max(0, Math.min(distance, this.length));
    let i = 1;
    while (i < this.cumulative.length - 1 && this.cumulative[i] < d) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const segment = this.cumulative[i] - this.cumulative[i - 1];
    const t = segment === 0 ? 0 : (d - this.cumulative[i - 1]) / segment;
    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
      heading: bearingDegrees(a, b),
      segmentIndex: i - 1,
      done: d >= this.length,
    };
  }
}
