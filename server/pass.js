// The digital bus pass: a card on the student's phone with a QR code the driver
// scans. The code is signed by the server and lives for 90 seconds, so a
// screenshot passed to a friend stops working. Scanning shows the driver whether
// the student's pass is valid, and records them on the running trip.
import jwt from 'jsonwebtoken';
import { PASS_PREFIX } from '../shared/service.js';
import { HttpError } from './auth.js';

const PURPOSE = 'bus-pass';
const MAX_PHOTO_CHARS = 120000; // about 90 KB of JPEG: the apps shrink it to 256 px first
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export class BusPassService {
  constructor(db, config, { tracking, attendance, billing }) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
    this.attendance = attendance;
    this.billing = billing;
  }

  async holder(userId) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.username, u.full_name, u.register_no, u.department, u.photo, u.home_route_id,
              r.code AS route_code, r.name AS route_name, s.name AS stop_name
         FROM users u
         LEFT JOIN routes r ON r.id = u.home_route_id
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE u.id = $1 AND u.role = 'student'`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** ACTIVE, GRACE, EXPIRED or FREE (no subscription is needed), with the dates when there are some. */
  async standing(userId) {
    const required = Boolean(this.config.subscription.studentRequired);
    const { rows } = await this.db.query(
      `SELECT valid_from, valid_to FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY valid_to DESC LIMIT 1`,
      [userId],
    );
    const sub = rows[0] ?? null;
    const access = await this.billing.access(userId);
    const dates = sub ? { validFrom: sub.valid_from, validTo: sub.valid_to } : { validFrom: null, validTo: null };
    if (!required) return { status: 'FREE', valid: true, ...dates };
    if (!access.active) return { status: 'EXPIRED', valid: false, ...dates };
    return { status: access.inGrace ? 'GRACE' : 'ACTIVE', valid: true, ...dates };
  }

  /** What the pass screen shows, with a fresh code. */
  async issue(userId) {
    const h = await this.holder(userId);
    if (!h) throw new HttpError(404, 'Student not found');
    const seconds = this.config.busPass.codeValidS;
    const token = jwt.sign({ typ: PURPOSE, sub: String(userId) }, this.config.jwtSecret, { expiresIn: seconds });
    return {
      name: h.full_name,
      registerNo: h.register_no,
      department: h.department,
      photo: h.photo,
      routeCode: h.route_code,
      routeName: h.route_name,
      stopName: h.stop_name,
      ...(await this.standing(userId)),
      code: `${PASS_PREFIX}${token}`,
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
      refreshInS: Math.max(10, seconds - 30),
    };
  }

  /** Anyone's profile picture; a student's also goes on the pass. Null removes it. */
  async getPhoto(userId) {
    return { photo: (await this.db.query('SELECT photo FROM users WHERE id = $1', [userId])).rows[0]?.photo ?? null };
  }

  async setPhoto(userId, photo) {
    if (photo !== null && (typeof photo !== 'string' || !PHOTO_RE.test(photo) || photo.length > MAX_PHOTO_CHARS)) {
      throw new HttpError(400, 'Choose a JPEG or PNG photo under 90 KB');
    }
    await this.db.query('UPDATE users SET photo = $2 WHERE id = $1', [userId, photo]);
    return { ok: true };
  }

  /** The driver scans a pass. */
  async scan(auth, payload) {
    const text = String(payload ?? '');
    if (!text.startsWith(PASS_PREFIX)) throw new HttpError(400, 'That is not a Crescent Transit bus pass', { code: 'NOT_A_PASS' });
    let claims;
    try {
      claims = jwt.verify(text.slice(PASS_PREFIX.length), this.config.jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw new HttpError(410, 'This code has expired. Ask the student to reopen their pass.', { code: 'PASS_CODE_EXPIRED' });
      throw new HttpError(400, 'That pass could not be read', { code: 'NOT_A_PASS' });
    }
    if (claims.typ !== PURPOSE) throw new HttpError(400, 'That is not a Crescent Transit bus pass', { code: 'NOT_A_PASS' });
    const h = await this.holder(Number(claims.sub));
    if (!h) throw new HttpError(404, 'This student is no longer registered');

    const standing = await this.standing(h.id);
    const bus = (await this.db.query('SELECT route_id FROM buses WHERE id = $1', [auth.busId])).rows[0];
    const trip = await this.tracking.activeTrip(auth.busId);
    let recorded = false;
    let alreadyRecorded = false;
    if (standing.valid && trip) {
      const existing = (await this.db.query(
        `SELECT 1 FROM attendance WHERE user_id = $1 AND trip_id = $2 AND status NOT IN ('REJECTED', 'VOID')`,
        [h.id, trip.id],
      )).rows[0];
      if (existing) alreadyRecorded = true;
      else {
        await this.attendance.manual(auth, { tripId: trip.id, username: h.username });
        recorded = true;
      }
    }
    return {
      name: h.full_name,
      registerNo: h.register_no,
      department: h.department,
      photo: h.photo,
      routeCode: h.route_code,
      routeName: h.route_name,
      stopName: h.stop_name,
      ...standing,
      sameRoute: h.home_route_id === bus?.route_id,
      tripRunning: Boolean(trip),
      recorded,
      alreadyRecorded,
    };
  }
}
