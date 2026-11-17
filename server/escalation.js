// An SOS, emergency or breakdown must be seen. Every administrator's phone gets
// it at once (app.js); if nobody in the transport office acknowledges it within
// ESCALATE_AFTER_MIN (5) minutes it goes to the next person in ESCALATE_TO, then
// after as long again to the next, the last being the transport head. Each
// person is reached every way they can be: push, WhatsApp or SMS to their phone
// number, and email. With no ESCALATE_TO, the second round goes to every
// administrator by text and email, and to ALERT_EMAIL.
import { HttpError } from './auth.js';
import { audit } from './util.js';

export const ESCALATING = ['SOS', 'EMERGENCY', 'BREAKDOWN'];

export class EscalationService {
  constructor(db, config, { push = null, mailer = null, messaging = null, monitor = null, io = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.escalation;
    this.push = push;
    this.mailer = mailer;
    this.messaging = messaging;
    this.monitor = monitor;
    this.io = io;
  }

  /** The people in the chain, in order (unknown or inactive usernames are skipped). */
  async chain() {
    if (!this.settings.chain.length) return [];
    const { rows } = await this.db.query(
      `SELECT id, username, full_name, email, phone FROM users WHERE username = ANY($1::text[]) AND status = 'active' AND role IN ('admin', 'finance')`,
      [this.settings.chain],
    );
    return this.settings.chain.map((name) => rows.find((r) => r.username === name)).filter(Boolean);
  }

  /** Reach one person every way the server can. */
  async reach(person, { title, body, data }) {
    this.push?.toUser(person.id, { title, body, data });
    if (person.phone) await this.messaging?.send({ to: person.phone, channel: 'sms', kind: 'escalation', text: `${title}. ${body}` });
    if (person.email && this.mailer?.configured) {
      await this.mailer.send({ to: person.email, subject: title, text: `${body}\n\n${this.config.institution.appName}` })
        .catch((err) => console.error('[escalation] email failed:', err.message));
    }
  }

  /** Something for the transport head (the last in the chain), or for ALERT_EMAIL. */
  async toHead(body, data = {}) {
    const title = 'Needs the transport head';
    const head = (await this.chain()).at(-1);
    if (head) await this.reach(head, { title, body, data });
    else await this.monitor?.deliver(title, body);
    return { told: head?.username ?? 'alert email' };
  }

  async acknowledge(incidentId, userId) {
    const { rows } = await this.db.query(
      `UPDATE incidents SET acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, $2)
        WHERE id = $1 RETURNING *`,
      [incidentId, userId],
    );
    if (!rows[0]) throw new HttpError(404, 'Incident not found');
    this.io?.to('admins').emit('incident', rows[0]);
    return rows[0];
  }

  describe(i) {
    const what = i.kind === 'SOS' ? 'SOS' : i.kind === 'EMERGENCY' ? 'Emergency' : 'Breakdown';
    const where = [i.fleet_code?.replace('BSACIST-', 'Bus '), i.route_code ? `route ${i.route_code}` : null].filter(Boolean).join(', ');
    const map = i.lat != null ? ` Location: https://maps.google.com/?q=${i.lat},${i.lng}` : '';
    return `${what}${where ? ` on ${where}` : ''}${i.message ? `: "${i.message}"` : ''}.${map}`;
  }

  /** Every minute (jobs.js): move unacknowledged alerts one step up the chain. */
  async sweep(now = Date.now()) {
    const after = this.settings.afterMinutes * 60000;
    const { rows } = await this.db.query(
      `SELECT i.*, b.fleet_code, r.code AS route_code
         FROM incidents i LEFT JOIN buses b ON b.id = i.bus_id LEFT JOIN routes r ON r.id = i.route_id
        WHERE i.kind = ANY($1::text[]) AND i.status = 'OPEN' AND i.acknowledged_at IS NULL
          AND i.created_at > now() - interval '1 day'`,
      [ESCALATING],
    );
    if (!rows.length) return { escalated: 0 };
    const chain = await this.chain();
    const steps = chain.length || 1;
    let escalated = 0;
    for (const i of rows) {
      if (i.escalation_level >= steps) continue;
      const since = new Date(i.escalated_at ?? i.created_at).getTime();
      if (now - since < after) continue;
      const minutes = Math.round((now - new Date(i.created_at).getTime()) / 60000);
      const title = `UNANSWERED ${i.kind}: no one has acknowledged it for ${minutes} min`;
      const body = this.describe(i);
      const data = { type: 'incident', id: i.id, kind: i.kind };
      // Claim the step first, so two servers never send it twice.
      const { rows: claimed } = await this.db.query(
        `UPDATE incidents SET escalation_level = escalation_level + 1, escalated_at = now()
          WHERE id = $1 AND escalation_level = $2 AND acknowledged_at IS NULL RETURNING escalation_level`,
        [i.id, i.escalation_level],
      );
      if (!claimed[0]) continue;
      let to;
      if (chain.length) {
        const person = chain[i.escalation_level];
        await this.reach(person, { title, body, data });
        to = person.username;
      } else {
        const { rows: admins } = await this.db.query(`SELECT id, username, full_name, email, phone FROM users WHERE role = 'admin' AND status = 'active'`);
        for (const a of admins) await this.reach(a, { title, body, data });
        await this.monitor?.deliver(title, body);
        to = 'all administrators';
      }
      await audit(this.db, { action: 'INCIDENT_ESCALATED', entity: 'incident', entityId: i.id, detail: { level: claimed[0].escalation_level, to } });
      this.io?.to('admins').emit('incident', { ...i, escalation_level: claimed[0].escalation_level });
      escalated += 1;
    }
    return { escalated };
  }
}
