// Reminders and fair-play the system sends by itself, each one once:
//
//   Renewal           a push (and an email) 3 days before a student's subscription
//                     ends, on its last day, and when the grace period starts,
//                     each with a one-tap "Renew" link.
//   Pre-trip check    the driver is reminded 15 minutes before the run if the
//                     checklist is not done yet.
//   Complaints        an unanswered complaint reminds the service desk after 48 h,
//                     then goes to the transport head after 72 h.
//   Service credit    a route whose bus did not run on a service day gets one day
//                     added to its students' subscriptions (nightly).
import { busLabel } from '../shared/institution.js';
import { DOWN, UP } from '../shared/direction.js';
import { clockMinutes } from './alternatives.js';
import { addDays, asDate, daysBetween, localDate, localMinutes } from './clock.js';
import { audit } from './util.js';

const DAY_START = 8 * 60; // nothing personal is sent before 8:00 ...
const DAY_END = 21 * 60; // ... or after 21:00

export class FollowupService {
  constructor(db, config, { billing, calendar, push = null, mailer = null, escalation = null, eveningDeparture = null, io = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.followups;
    this.billing = billing;
    this.calendar = calendar;
    this.push = push;
    this.mailer = mailer;
    this.escalation = escalation;
    this.eveningDeparture = eveningDeparture;
    this.io = io;
  }

  today(now = new Date()) {
    return localDate(now, this.config.timeZone);
  }

  /** Record a notice as sent; false if it already was. */
  async once(key) {
    const { rows } = await this.db.query('INSERT INTO sent_notices (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
    return Boolean(rows[0]);
  }

  // ---- Subscription renewal ------------------------------------------------------------

  renewUrl() {
    return this.config.appUrl ? `${this.config.appUrl}/pay` : null;
  }

  /** Which reminder is due for a subscription ending on `validTo`, or null. */
  renewStage(validTo, today) {
    const left = daysBetween(today, validTo);
    const [early, last] = this.settings.renewDaysBefore;
    if (left <= early && left > last) return { stage: `before${early}`, left };
    if (left === last) return { stage: 'lastDay', left };
    if (left < 0 && left >= -this.config.subscription.graceDays) return { stage: 'grace', left };
    return null;
  }

  async renewalReminders(now = new Date()) {
    const minutes = localMinutes(now, this.config.timeZone);
    if (minutes < DAY_START || minutes > DAY_END) return { sent: 0 };
    const today = this.today(now);
    const grace = this.config.subscription.graceDays;
    // Each student's latest active subscription, when it ends soon or has just ended.
    const { rows } = await this.db.query(
      `SELECT s.user_id, s.valid_to, u.email, u.full_name
         FROM subscriptions s JOIN users u ON u.id = s.user_id
        WHERE s.status = 'ACTIVE' AND u.role = 'student' AND u.status = 'active'
          AND s.valid_to BETWEEN $1 AND $2
          AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.user_id = s.user_id AND x.status = 'ACTIVE' AND x.valid_to > s.valid_to)`,
      [addDays(today, -grace), addDays(today, this.settings.renewDaysBefore[0])],
    );
    const url = this.renewUrl();
    let sent = 0;
    for (const r of rows) {
      const validTo = asDate(r.valid_to);
      const due = this.renewStage(validTo, today);
      if (!due || !(await this.once(`renew:${r.user_id}:${validTo}:${due.stage}`))) continue;
      const graceEnds = addDays(validTo, grace);
      const message = due.stage === 'grace'
        ? { title: 'Your bus subscription has ended', body: `You have until ${graceEnds} to renew before live tracking and alerts stop. Tap to renew.` }
        : due.stage === 'lastDay'
          ? { title: 'Your bus subscription ends today', body: 'Renew now so live tracking and alerts keep working. Tap to renew.' }
          : { title: `Your bus subscription ends in ${due.left} day${due.left === 1 ? '' : 's'}`, body: `It runs until ${validTo}. Tap to renew.` };
      this.push?.toUser(r.user_id, { ...message, data: { type: 'renew', url } });
      this.io?.to(`user:${r.user_id}`).emit('subscription:reminder', { ...message, url });
      if (r.email && this.mailer?.configured) {
        const text = `${message.title}.\n\n${message.body.replace(' Tap to renew.', '')}${url ? `\n\nRenew: ${url}` : ''}\n\n${this.config.institution.appName}`;
        await this.mailer.send({ to: r.email, subject: message.title, text }).catch((err) => console.error('[followups] renewal email failed:', err.message));
      }
      sent += 1;
    }
    return { sent };
  }

  // ---- Pre-trip check ------------------------------------------------------------------

  /** Minutes after midnight each route's run leaves today, by direction. */
  async departures(now) {
    const { rows } = await this.db.query(
      `SELECT b.id AS bus_id, b.fleet_code, r.departure_time, u.id AS driver_id
         FROM buses b JOIN routes r ON r.id = b.route_id
         JOIN users u ON u.bus_id = b.id AND u.role = 'driver' AND u.status = 'active'
        WHERE r.active AND b.status = 'active'`,
    );
    const morningShift = await this.calendar.shift(UP, now);
    const eveningShift = await this.calendar.shift(DOWN, now);
    const evening = clockMinutes(this.eveningDeparture);
    const out = [];
    for (const r of rows) {
      const morning = clockMinutes(r.departure_time);
      if (morning != null) out.push({ ...r, direction: UP, leaves: morning + morningShift });
      if (evening != null) out.push({ ...r, direction: DOWN, leaves: evening + eveningShift });
    }
    return out;
  }

  async checklistReminders(now = new Date()) {
    if (await this.calendar.isPaused(now)) return { sent: 0 };
    const today = this.today(now);
    const minutes = localMinutes(now, this.config.timeZone);
    const before = this.settings.checklistBeforeMin;
    let sent = 0;
    for (const d of await this.departures(now)) {
      // From 15 minutes before the run until it leaves.
      if (minutes < d.leaves - before || minutes > d.leaves) continue;
      const { rows } = await this.db.query(
        `SELECT
           EXISTS (SELECT 1 FROM bus_checklists WHERE bus_id = $1 AND day = $2 AND direction = $3) AS done,
           EXISTS (SELECT 1 FROM trips WHERE bus_id = $1 AND status = 'active') AS running`,
        [d.bus_id, today, d.direction],
      );
      if (rows[0].done || rows[0].running) continue;
      if (!(await this.once(`checklist:${d.bus_id}:${today}:${d.direction}`))) continue;
      this.push?.toUser(d.driver_id, {
        title: 'Pre-trip check not done',
        body: `${busLabel(d.fleet_code)} leaves in ${Math.max(0, d.leaves - minutes)} min. Do the safety check before you start.`,
        data: { type: 'checklist' },
      });
      sent += 1;
    }
    return { sent };
  }

  // ---- Complaints nobody answered ------------------------------------------------------

  async complaintFollowups() {
    const { remindH, escalateH } = { remindH: this.settings.complaintRemindHours, escalateH: this.settings.complaintEscalateHours };
    const { rows } = await this.db.query(
      `SELECT f.id, f.comment, f.created_at, b.fleet_code, extract(epoch FROM now() - f.created_at) / 3600 AS hours
         FROM trip_feedback f JOIN buses b ON b.id = f.bus_id
        WHERE f.status = 'OPEN' AND f.responded_at IS NULL AND f.created_at < now() - make_interval(hours => $1)`,
      [remindH],
    );
    let reminded = 0;
    let escalated = 0;
    for (const c of rows) {
      const what = `Complaint #${c.id} about ${busLabel(c.fleet_code)}${c.comment ? `: "${String(c.comment).slice(0, 80)}"` : ''}`;
      if (c.hours >= escalateH) {
        if (await this.once(`complaint:${c.id}:escalated`)) {
          await this.escalation?.toHead(`${what} has had no reply for ${Math.floor(c.hours / 24)} days.`, { type: 'feedback', id: c.id });
          escalated += 1;
        }
      } else if (await this.once(`complaint:${c.id}:reminded`)) {
        this.push?.toRole('admin', { title: 'Complaint waiting for a reply', body: `${what} - no reply for ${Math.floor(c.hours)} hours.`, data: { type: 'feedback', id: c.id } });
        this.io?.to('admins').emit('feedback', { id: c.id });
        reminded += 1;
      }
    }
    return { reminded, escalated };
  }

  // ---- Service credit for a bus that did not run ---------------------------------------

  /**
   * Nightly. A route whose bus did not run today, on a day the buses ran
   * elsewhere (so a holiday or a quiet test server gives nobody a day), adds
   * one day to each of its students' subscriptions. Once per route and day.
   */
  async serviceCredits(now = new Date()) {
    if (!this.settings.serviceCredits) return { routes: 0, students: 0 };
    const today = this.today(now);
    const special = await this.calendar.on(today);
    if (special?.no_service) return { routes: 0, students: 0 };
    const tz = this.config.timeZone;
    const { rows: ran } = await this.db.query(
      `SELECT count(*)::int AS n FROM trips WHERE status IN ('active', 'completed') AND to_char(started_at AT TIME ZONE $2, 'YYYY-MM-DD') = $1`,
      [today, tz],
    );
    if (!ran[0].n) return { routes: 0, students: 0 };
    // Routes with a bus, where no trip ran today (a cancelled one counts as not run).
    const { rows: missed } = await this.db.query(
      `SELECT r.id, r.code,
              EXISTS (SELECT 1 FROM trips t WHERE t.route_id = r.id AND t.status = 'cancelled'
                        AND to_char(coalesce(t.scheduled_for, t.started_at) AT TIME ZONE $2, 'YYYY-MM-DD') = $1) AS cancelled
         FROM routes r
        WHERE r.active AND EXISTS (SELECT 1 FROM buses b WHERE b.route_id = r.id AND b.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.route_id = r.id AND t.status IN ('active', 'completed')
                            AND to_char(t.started_at AT TIME ZONE $2, 'YYYY-MM-DD') = $1)`,
      [today, tz],
    );
    let students = 0;
    let routes = 0;
    for (const route of missed) {
      const credited = await this.db.transaction(async (tx) => {
        const { rows: fresh } = await tx.query(
          'INSERT INTO service_credits (route_id, day, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING route_id',
          [route.id, today, route.cancelled ? 'trip cancelled' : 'no trip ran'],
        );
        if (!fresh[0]) return [];
        // Each student's latest active subscription that covers today grows by a day.
        const { rows } = await tx.query(
          `UPDATE subscriptions s SET valid_to = s.valid_to + 1
            WHERE s.subscription_id IN (
              SELECT DISTINCT ON (x.user_id) x.subscription_id
                FROM subscriptions x JOIN users u ON u.id = x.user_id
               WHERE x.status = 'ACTIVE' AND u.home_route_id = $1 AND u.status = 'active' AND x.valid_to >= $2
                 AND EXISTS (SELECT 1 FROM subscriptions c WHERE c.user_id = x.user_id AND c.status = 'ACTIVE' AND c.valid_from <= $2 AND c.valid_to >= $2)
               ORDER BY x.user_id, x.valid_to DESC)
            RETURNING s.user_id`,
          [route.id, today],
        );
        await tx.query('UPDATE service_credits SET students = $3 WHERE route_id = $1 AND day = $2', [route.id, today, rows.length]);
        return rows.map((r) => r.user_id);
      });
      if (!credited.length) continue;
      routes += 1;
      students += credited.length;
      await audit(this.db, { action: 'SERVICE_CREDIT', entity: 'route', entityId: route.id, reason: route.cancelled ? 'trip cancelled' : 'no trip ran', detail: { day: today, students: credited.length } });
      for (const id of credited) {
        this.push?.toUser(id, {
          title: 'A day added to your subscription',
          body: `Route ${route.code} did not run today (${today}), so your subscription now lasts a day longer.`,
          data: { type: 'subscription' },
        });
      }
    }
    return { routes, students };
  }

  /** Every minute (jobs.js). */
  async tick(now = new Date()) {
    return {
      renewals: (await this.renewalReminders(now)).sent,
      checklists: (await this.checklistReminders(now)).sent,
      complaints: await this.complaintFollowups(),
    };
  }
}
