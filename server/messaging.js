// WhatsApp and SMS to people who do not use the app: parents who never installed
// it, and the transport head when an SOS goes unanswered.
//
//   WhatsApp  Meta's WhatsApp Cloud API. A business may only start a conversation
//             with an approved template, so every message is the template
//             WHATSAPP_TEMPLATE with the text as its one variable ({{1}}).
//   SMS       Twilio.
//
// With neither configured nothing is sent and nothing fails. Each message is
// logged (number masked) so the transport office can see what it costs.
import { HttpError } from './auth.js';

const TIMEOUT_MS = 10000;

/** "98400 12345", "+91 98400-12345", "919840012345" -> "+919840012345"; null when it is not a phone number. */
export function normalisePhone(raw, country = '91') {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  let n = digits.startsWith('+') ? digits.slice(1) : digits.replace(/^00/, '');
  if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  if (n.length === 10) n = country + n;
  if (!/^\d{11,15}$/.test(n)) return null;
  return `+${n}`;
}

export const maskPhone = (phone) => {
  const s = String(phone ?? '');
  return s.length > 6 ? `${s.slice(0, 3)}${'•'.repeat(Math.max(0, s.length - 7))}${s.slice(-4)}` : '••••';
};

export class MessagingService {
  constructor(db, config, { fetchImpl = globalThis.fetch } = {}) {
    this.db = db;
    this.config = config;
    this.settings = config.messaging;
    this.fetch = fetchImpl;
  }

  /** Which channels can send right now. */
  channels() {
    return { whatsapp: Boolean(this.settings.whatsapp), sms: Boolean(this.settings.sms) };
  }

  get configured() {
    return Boolean(this.settings.whatsapp || this.settings.sms);
  }

  /** The channel to use: the one asked for if it is set up, else the other. */
  pick(preferred) {
    const c = this.channels();
    if (c[preferred]) return preferred;
    return c.whatsapp ? 'whatsapp' : c.sms ? 'sms' : null;
  }

  /**
   * Send one message. Never throws: an outside service being down must not
   * stop the push notifications and alerts that go with it.
   */
  async send({ to, text, kind = 'notice', channel = 'whatsapp' }) {
    const phone = normalisePhone(to, this.settings.defaultCountry);
    const use = this.pick(channel);
    if (!phone || !use) return { ok: false, skipped: true };
    const body = String(text).slice(0, 900);
    let ok = false;
    let error = null;
    try {
      if (use === 'whatsapp') await this.sendWhatsApp(phone, body);
      else await this.sendSms(phone, body);
      ok = true;
    } catch (err) {
      error = String(err.message ?? err).slice(0, 300);
      console.error(`[messaging] ${use} to ${maskPhone(phone)} failed: ${error}`);
    }
    await this.db.query(
      'INSERT INTO outbound_messages (channel, to_masked, kind, ok, cost_paise, error) VALUES ($1, $2, $3, $4, $5, $6)',
      [use, maskPhone(phone), kind, ok, ok ? this.settings.costPaise[use] ?? 0 : 0, error],
    ).catch(() => {});
    return { ok, channel: use, error };
  }

  async sendWhatsApp(phone, text) {
    const w = this.settings.whatsapp;
    const res = await this.fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.slice(1),
        type: 'template',
        template: {
          name: w.template,
          language: { code: w.language },
          components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  async sendSms(phone, text) {
    const s = this.settings.sms;
    const form = new URLSearchParams({ To: phone, From: s.from, Body: text });
    const res = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${s.sid}:${s.token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SMS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  /** Messages and their cost over the last `days` days. */
  async usage(days = 30) {
    const { rows } = await this.db.query(
      `SELECT channel, count(*)::int AS sent, count(*) FILTER (WHERE NOT ok)::int AS failed, coalesce(sum(cost_paise), 0)::int AS cost_paise
         FROM outbound_messages WHERE created_at > now() - make_interval(days => $1) GROUP BY channel ORDER BY channel`,
      [days],
    );
    return { days, channels: this.channels(), byChannel: rows, costRupees: rows.reduce((n, r) => n + r.cost_paise, 0) / 100 };
  }

  // ---- A student's parents without the app -----------------------------------------------

  async contacts(studentId) {
    const { rows } = await this.db.query(
      'SELECT id, name, phone, channel, active, created_at FROM guardian_contacts WHERE student_id = $1 ORDER BY id',
      [studentId],
    );
    return rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
  }

  async addContact(studentId, body = {}) {
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (name.length < 2) throw new HttpError(400, 'Enter the parent\'s name');
    const phone = normalisePhone(body.phone, this.settings.defaultCountry);
    if (!phone) throw new HttpError(400, 'Enter a valid mobile number');
    const channel = body.channel === 'sms' ? 'sms' : 'whatsapp';
    const { rows: count } = await this.db.query('SELECT count(*)::int AS n FROM guardian_contacts WHERE student_id = $1', [studentId]);
    if (count[0].n >= this.settings.maxContactsPerStudent) throw new HttpError(409, `You can add up to ${this.settings.maxContactsPerStudent} numbers`);
    let row;
    try {
      ({ rows: [row] } = await this.db.query(
        'INSERT INTO guardian_contacts (student_id, name, phone, channel) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, channel, active, created_at',
        [studentId, name, phone, channel],
      ));
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'That number is already added');
      throw err;
    }
    const student = (await this.db.query('SELECT full_name FROM users WHERE id = $1', [studentId])).rows[0];
    await this.send({
      to: phone,
      channel,
      kind: 'welcome',
      text: `${this.config.institution.appName}: ${student?.full_name ?? 'Your child'} added this number for bus messages - when they board, reach, and if the bus is late or there is an emergency. Ask them to remove it from the app to stop.`,
    });
    return { ...row, phone: maskPhone(row.phone) };
  }

  async removeContact(studentId, id) {
    const { rows } = await this.db.query('DELETE FROM guardian_contacts WHERE id = $1 AND student_id = $2 RETURNING id', [id, studentId]);
    if (!rows[0]) throw new HttpError(404, 'Number not found');
    return { removed: true };
  }

  /** Text the WhatsApp/SMS numbers of these students' parents. */
  async toStudentsContacts(studentIds, text, kind) {
    if (!this.configured || !studentIds.length) return { sent: 0 };
    const { rows } = await this.db.query(
      'SELECT DISTINCT phone, channel FROM guardian_contacts WHERE active AND student_id = ANY($1::int[])',
      [studentIds],
    );
    let sent = 0;
    for (const c of rows) if ((await this.send({ to: c.phone, channel: c.channel, text, kind })).ok) sent += 1;
    return { sent };
  }

  async toRouteContacts(routeId, text, kind) {
    const { rows } = await this.db.query(
      `SELECT id FROM users WHERE role = 'student' AND status = 'active' AND home_route_id = $1`,
      [routeId],
    );
    return this.toStudentsContacts(rows.map((r) => r.id), text, kind);
  }
}
