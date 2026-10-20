// Push notifications through Expo's push service. The phone app registers its
// Expo push token after sign-in; the server sends route alerts, the boarding
// question and SOS reports to phones even when the app is closed or in the
// background (the socket only reaches an open app). Expo forwards each message
// to Firebase Cloud Messaging (Android) or APNs (iOS).
//
// Push is best effort: a failure is logged, never thrown, because the same
// information is already in the app (alerts list, pending boarding question).

import { addDays } from './clock.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts at most 100 messages per request
const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export class PushService {
  constructor(db, config, billing) {
    this.db = db;
    this.config = config;
    this.billing = billing;
    this.enabled = config.push?.enabled !== false;
    this.fetch = config.push?.fetch ?? globalThis.fetch;
  }

  isToken(token) {
    return typeof token === 'string' && TOKEN_RE.test(token);
  }

  /** One row per phone: a phone that signs in to another account moves to it. */
  async register(userId, token, platform = null) {
    await this.db.query(
      `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [token, userId, platform],
    );
  }

  async unregister(userId, token) {
    await this.db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, userId]);
  }

  // ---- Audiences -------------------------------------------------------------

  // Callers do not wait for these (a request is never slowed by Expo), so each
  // one catches its own errors: an unhandled rejection would stop the server.

  async toUser(userId, message) {
    return this.safely(async () => {
      const { rows } = await this.db.query('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
      return this.send(rows.map((r) => r.token), message);
    });
  }

  async toRole(role, message) {
    return this.safely(async () => {
      const { rows } = await this.db.query(
        `SELECT p.token FROM push_tokens p JOIN users u ON u.id = p.user_id WHERE u.role = $1 AND u.status = 'active'`,
        [role],
      );
      return this.send(rows.map((r) => r.token), message);
    });
  }

  /**
   * Students who get route alerts: those on the route, or every one when
   * routeId is null. When subscriptions are required for students, only those
   * with an active one (as BillingService.entitlement(), grace days included).
   */
  async toSubscribers(routeId, message) {
    return this.safely(async () => {
      const today = this.billing.today();
      const graceStart = addDays(today, -this.config.subscription.graceDays);
      const { rows } = await this.db.query(
        `SELECT p.token FROM push_tokens p JOIN users u ON u.id = p.user_id
          WHERE u.role = 'student' AND u.status = 'active' AND ($1::int IS NULL OR u.home_route_id = $1)
            AND (NOT $4 OR EXISTS (SELECT 1 FROM subscriptions s
                         WHERE s.user_id = u.id AND s.status = 'ACTIVE' AND s.valid_from <= $2 AND s.valid_to >= $3))`,
        [routeId, today, graceStart, Boolean(this.config.subscription.studentRequired)],
      );
      return this.send(rows.map((r) => r.token), message);
    });
  }

  async safely(fn) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[push] not sent: ${err.message}`);
      return { sent: 0, failed: 0 };
    }
  }

  // ---- Delivery ---------------------------------------------------------------

  /**
   * Send one message to many phones. `channelId` matches the Android channel
   * the app creates ('alerts', high importance, so the banner pops up).
   */
  async send(tokens, { title, body, data = {} }) {
    if (!this.enabled || !tokens.length) return { sent: 0, failed: 0 };
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const chunk = tokens.slice(i, i + BATCH);
      const messages = chunk.map((to) => ({ to, title, body, data, sound: 'default', priority: 'high', channelId: 'alerts' }));
      try {
        const res = await this.fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            // Only needed when "enhanced push security" is switched on for the Expo project.
            ...(this.config.push?.accessToken ? { authorization: `Bearer ${this.config.push.accessToken}` } : {}),
          },
          body: JSON.stringify(messages),
        });
        const out = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(out?.data)) {
          failed += chunk.length;
          console.warn(`[push] Expo push service answered ${res.status}: ${JSON.stringify(out?.errors ?? out)}`);
          continue;
        }
        // One ticket per message, in order. A token Expo no longer knows (app
        // uninstalled, or the phone's FCM token changed) is removed.
        const stale = [];
        out.data.forEach((ticket, k) => {
          if (ticket.status === 'ok') sent += 1;
          else {
            failed += 1;
            if (ticket.details?.error === 'DeviceNotRegistered') stale.push(chunk[k]);
            else console.warn(`[push] ${ticket.details?.error ?? 'error'}: ${ticket.message}`);
          }
        });
        for (const token of stale) await this.db.query('DELETE FROM push_tokens WHERE token = $1', [token]);
      } catch (err) {
        failed += chunk.length;
        console.warn(`[push] could not reach the Expo push service: ${err.message}`);
      }
    }
    return { sent, failed };
  }
}
