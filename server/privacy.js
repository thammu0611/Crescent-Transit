// A person's own data: they can download it, and they can delete their account
// (India's DPDP Act). Payment records stay, because accounting law requires
// them, but they no longer point at a name.
import crypto from 'node:crypto';
import { HttpError, hashPassword } from './auth.js';
import { comparePassword } from './passwords.js';
import { audit } from './util.js';

const SELF_SERVICE_ROLES = new Set(['student', 'parent']);

/** Every trace that identifies the person. Used by account deletion and by removing graduates. */
export async function anonymiseUser(tx, userId, passwordHash) {
  for (const sql of [
    'DELETE FROM push_tokens WHERE user_id = $1',
    'DELETE FROM devices WHERE user_id = $1',
    'DELETE FROM device_otps WHERE user_id = $1',
    'DELETE FROM email_codes WHERE user_id = $1',
    'DELETE FROM password_resets WHERE user_id = $1',
    'DELETE FROM guardian_codes WHERE student_id = $1',
    'DELETE FROM guardian_links WHERE parent_id = $1 OR student_id = $1',
    'DELETE FROM guardian_notices WHERE parent_id = $1',
    'DELETE FROM parent_alerts WHERE parent_id = $1',
    'DELETE FROM bus_alternative_alerts WHERE user_id = $1',
    'DELETE FROM stop_alerts WHERE user_id = $1',
    'DELETE FROM boarding_checks WHERE user_id = $1',
    'DELETE FROM route_requests WHERE user_id = $1',
    'UPDATE trip_feedback SET comment = NULL WHERE user_id = $1',
    `UPDATE lost_items SET description = NULL WHERE reported_by = $1`,
    `UPDATE attendance_disputes SET reason = 'Removed with the account' WHERE raised_by = $1`,
    `UPDATE incidents SET message = NULL, lat = NULL, lng = NULL WHERE user_id = $1`,
    `UPDATE attendance_events SET detail = NULL, distance_m = NULL, speed_kmph = NULL, bearing_delta = NULL WHERE user_id = $1`,
  ]) await tx.query(sql, [userId]);
  await tx.query(
    `UPDATE users SET username = 'deleted-' || id, full_name = 'Deleted user', password_hash = $2,
            email = NULL, phone = NULL, register_no = NULL, department = NULL, photo = NULL,
            home_route_id = NULL, home_stop_seq = NULL, travel_windows = NULL, graduation_year = NULL,
            location_consent = FALSE, consent_at = NULL, boarding_reminders = FALSE, arrival_alerts = FALSE,
            status = 'deleted', deleted_at = now(), password_changed_at = now()
      WHERE id = $1`,
    [userId, passwordHash],
  );
}

export const unusablePassword = () => hashPassword(crypto.randomBytes(24).toString('hex'));

export class PrivacyService {
  constructor(db) {
    this.db = db;
  }

  /** Everything held about this person, as one file. */
  async exportFor(userId) {
    const q = async (sql) => (await this.db.query(sql, [userId])).rows;
    const [profile] = await q(
      `SELECT u.username, u.full_name, u.role, u.email, u.phone, u.register_no, u.department, u.status,
              r.code AS route_code, s.name AS stop_name, u.location_consent, u.consent_at, u.travel_windows,
              u.language, u.boarding_reminders, u.arrival_alerts, u.created_at, u.email_verified_at, u.photo
         FROM users u
         LEFT JOIN routes r ON r.id = u.home_route_id
         LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE u.id = $1`,
    );
    if (!profile) throw new HttpError(404, 'Account not found');
    return {
      exportedAt: new Date().toISOString(),
      notice: 'Your data held by the transport office. Your live location is never stored, so it is not in this file.',
      profile,
      subscriptions: await q(`SELECT p.plan_code AS plan, s.status, s.valid_from, s.valid_to, s.created_at FROM subscriptions s JOIN subscription_plans p ON p.plan_id = s.plan_id WHERE s.user_id = $1 ORDER BY s.created_at`),
      payments: await q(`SELECT amount_paise, method, status, receipt_no, paid_at, created_at FROM payments WHERE user_id = $1 ORDER BY created_at`),
      attendance: await q(
        `SELECT a.created_at, a.status, a.method, a.boarded_at, a.alighted_at, b.fleet_code, t.direction,
                bs.name AS boarding_stop, als.name AS alighting_stop
           FROM attendance a
           JOIN trips t ON t.id = a.trip_id JOIN buses b ON b.id = a.bus_id
           LEFT JOIN stops bs ON bs.id = a.boarding_stop_id
           LEFT JOIN stops als ON als.id = a.alighting_stop_id
          WHERE a.user_id = $1 ORDER BY a.created_at`,
      ),
      disputes: await q(`SELECT reason, claimed_present, resolution, created_at, resolved_at FROM attendance_disputes WHERE raised_by = $1 ORDER BY created_at`),
      feedback: await q(`SELECT rating, tags, comment, created_at FROM trip_feedback WHERE user_id = $1 ORDER BY created_at`),
      routeRequests: await q(`SELECT reason, status, created_at FROM route_requests WHERE user_id = $1 ORDER BY created_at`),
      lostAndFound: await q(`SELECT kind, title, description, status, created_at FROM lost_items WHERE reported_by = $1 ORDER BY created_at`),
      device: await q(`SELECT platform, bound_at FROM devices WHERE user_id = $1`),
      linkedParents: await q(`SELECT p.full_name, l.created_at FROM guardian_links l JOIN users p ON p.id = l.parent_id WHERE l.student_id = $1`),
      linkedChildren: await q(`SELECT s.full_name, l.created_at FROM guardian_links l JOIN users s ON s.id = l.student_id WHERE l.parent_id = $1`),
    };
  }

  /** Delete one's own account. The password is asked again: this cannot be undone. */
  async deleteAccount(auth, password, ip = null) {
    if (!SELF_SERVICE_ROLES.has(auth.role)) {
      throw new HttpError(403, 'Staff accounts are removed by the transport office');
    }
    const { rows } = await this.db.query('SELECT password_hash FROM users WHERE id = $1', [auth.userId]);
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
    if (typeof password !== 'string' || !password || !(await comparePassword(password, rows[0].password_hash))) {
      throw new HttpError(400, 'Password is incorrect', { code: 'WRONG_PASSWORD' });
    }
    const hash = await unusablePassword();
    await this.db.transaction((tx) => anonymiseUser(tx, auth.userId, hash));
    await audit(this.db, { actorId: auth.userId, action: 'ACCOUNT_DELETED', entity: 'user', entityId: auth.userId, ip });
    return { deleted: true };
  }
}
