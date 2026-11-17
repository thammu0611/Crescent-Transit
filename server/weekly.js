// The Monday report: one page for the transport head, by email, without anyone
// having to sign in. Last week (Monday to Sunday): on-time running, late buses,
// incidents, riders, complaints and collections. WEEKLY_REPORT_TO (or
// ALERT_EMAIL) receives it at WEEKLY_REPORT_AT (07:30) every Monday.
import { busLabel } from '../shared/institution.js';
import { PRESENT_SQL } from './attendance.js';
import { renderPdf } from './billing/pdf.js';
import { addDays, localDate, localMinutes } from './clock.js';

const rupees = (paise) => `Rs ${(Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '-');

export class WeeklyReportService {
  constructor(db, config, { mailer = null, monitor = null }) {
    this.db = db;
    this.config = config;
    this.settings = config.weeklyReport;
    this.mailer = mailer;
    this.monitor = monitor;
  }

  /** Monday to Sunday of the week before `now`. */
  lastWeek(now = new Date()) {
    const today = localDate(now, this.config.timeZone);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const thisMonday = addDays(today, -((weekday + 6) % 7));
    return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
  }

  /** Everything the page shows, for any period. */
  async figures({ from, to }) {
    const tz = this.config.timeZone;
    const day = (col) => `(${col} AT TIME ZONE $3)::date BETWEEN $1 AND $2`;
    const args = [from, to, tz];
    const [trips, onTime, late, incidents, riders, feedback, money] = await Promise.all([
      this.db.query(
        `SELECT count(*) FILTER (WHERE status IN ('active', 'completed'))::int AS ran, count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
           FROM trips WHERE ${day('coalesce(started_at, scheduled_for)')}`,
        args,
      ),
      this.db.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE extract(epoch FROM (sa.arrived_at - t.started_at)) / 60 <= (s.offset_minutes - first.offset_minutes) + 5)::int AS on_time
           FROM stop_arrivals sa
           JOIN trips t ON t.id = sa.trip_id
           JOIN stops s ON s.route_id = t.route_id AND s.seq = sa.stop_seq
           JOIN stops first ON first.route_id = t.route_id AND first.seq = 1
          WHERE ${day('sa.arrived_at')} AND s.offset_minutes IS NOT NULL AND t.direction = 'UP'`,
        args,
      ),
      this.db.query(
        `SELECT b.fleet_code, count(*)::int AS times, max(l.minutes)::int AS worst
           FROM late_alerts l JOIN trips t ON t.id = l.trip_id JOIN buses b ON b.id = t.bus_id
          WHERE ${day('l.created_at')} GROUP BY b.fleet_code ORDER BY count(*) DESC, max(l.minutes) DESC LIMIT 5`,
        args,
      ),
      this.db.query(
        `SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE status = 'OPEN')::int AS still_open
           FROM incidents WHERE ${day('created_at')} GROUP BY kind ORDER BY count(*) DESC`,
        args,
      ),
      this.db.query(
        `SELECT count(*)::int AS boardings, count(DISTINCT a.user_id)::int AS students
           FROM attendance a WHERE ${PRESENT_SQL} AND ${day('a.boarded_at')}`,
        args,
      ),
      this.db.query(
        `SELECT count(*)::int AS ratings, round(avg(rating)::numeric, 1)::float AS avg_rating,
                count(*) FILTER (WHERE status IN ('OPEN', 'RESOLVED'))::int AS complaints,
                count(*) FILTER (WHERE status = 'OPEN')::int AS unanswered
           FROM trip_feedback WHERE ${day('created_at')}`,
        args,
      ),
      this.db.query(
        `SELECT count(*) FILTER (WHERE status = 'CAPTURED')::int AS paid, coalesce(sum(amount_paise) FILTER (WHERE status = 'CAPTURED'), 0)::bigint AS paise,
                count(*) FILTER (WHERE status = 'REFUNDED')::int AS refunds
           FROM payments WHERE ${day('coalesce(paid_at, created_at)')}`,
        args,
      ),
    ]);
    const ot = onTime.rows[0];
    return {
      from,
      to,
      trips: trips.rows[0],
      onTimePct: ot.n ? Math.round((ot.on_time / ot.n) * 100) : null,
      stopsChecked: ot.n,
      lateBuses: late.rows,
      incidents: incidents.rows,
      riders: riders.rows[0],
      feedback: feedback.rows[0],
      collections: { ...money.rows[0], paise: Number(money.rows[0].paise) },
    };
  }

  /** The one-page PDF. */
  pdf(f) {
    const lines = [];
    const rules = [];
    let y = 790;
    const head = (text) => { y -= 30; lines.push({ text, x: 50, y, size: 13, bold: true }); rules.push({ x1: 50, y1: y - 6, x2: 545, y2: y - 6 }); y -= 8; };
    const row = (k, v) => { y -= 18; lines.push({ text: k, x: 60, y, size: 10.5 }); lines.push({ text: String(v), x: 330, y, size: 10.5, bold: true }); };
    lines.push({ text: `${this.config.institution.appName} - weekly transport report`, x: 50, y, size: 17, bold: true });
    y -= 20;
    lines.push({ text: `${this.config.institution.name}`, x: 50, y, size: 9 });
    y -= 16;
    lines.push({ text: `Week ${f.from} to ${f.to}`, x: 50, y, size: 11, bold: true });

    head('Running');
    row('Trips run', f.trips.ran);
    row('Trips cancelled', f.trips.cancelled);
    row('On time (stops within 5 min of the timetable)', f.onTimePct == null ? '-' : `${f.onTimePct}%  (${f.stopsChecked} stops)`);
    if (f.lateBuses.length) {
      row('Late buses (times late, worst)', '');
      for (const b of f.lateBuses) row(`   ${busLabel(b.fleet_code)}`, `${b.times} time${b.times === 1 ? '' : 's'}, up to ${b.worst} min`);
    } else row('Late buses', 'none');

    head('Incidents');
    if (!f.incidents.length) row('Incidents reported', 'none');
    for (const i of f.incidents.slice(0, 8)) row(`   ${i.kind.replaceAll('_', ' ').toLowerCase()}`, `${i.n}${i.still_open ? `  (${i.still_open} still open)` : ''}`);

    head('Riders');
    row('Students who travelled', f.riders.students);
    row('Boardings', f.riders.boardings);

    head('Feedback and complaints');
    row('Trip ratings (average)', f.feedback.ratings ? `${f.feedback.ratings}  (${f.feedback.avg_rating} / 5)` : 'none');
    row('Complaints', f.feedback.complaints);
    row('Complaints still unanswered', f.feedback.unanswered);

    head('Collections');
    row('Payments received', `${f.collections.paid}  (${rupees(f.collections.paise)})`);
    row('Refunds', f.collections.refunds);

    lines.push({ text: 'Sent automatically every Monday. Full registers and reports are in the app under Reports.', x: 50, y: 50, size: 8.5 });
    return renderPdf(lines, rules);
  }

  summary(f) {
    return [
      `Week ${f.from} to ${f.to}`,
      `Trips run: ${f.trips.ran} (cancelled ${f.trips.cancelled})`,
      `On time: ${f.onTimePct == null ? '-' : `${f.onTimePct}%`}`,
      `Late buses: ${f.lateBuses.length ? f.lateBuses.map((b) => `${busLabel(b.fleet_code)} x${b.times}`).join(', ') : 'none'}`,
      `Incidents: ${f.incidents.reduce((n, i) => n + i.n, 0)}`,
      `Students who travelled: ${f.riders.students} (${f.riders.boardings} boardings)`,
      `Complaints: ${f.feedback.complaints} (${f.feedback.unanswered} unanswered)`,
      `Collections: ${rupees(f.collections.paise)} from ${f.collections.paid} payments`,
    ].join('\n');
  }

  /** Build and email last week's report. `to` overrides the configured list (the "send now" button). */
  async send({ now = new Date(), to = null } = {}) {
    const recipients = to ? [to] : this.settings.to;
    if (!recipients.length) return { sent: false, reason: 'Set WEEKLY_REPORT_TO (or ALERT_EMAIL) on the server' };
    if (!this.mailer?.configured) return { sent: false, reason: 'Email is not set up on the server (SMTP_HOST)' };
    const week = this.lastWeek(now);
    const f = await this.figures(week);
    const subject = `${this.config.institution.appName}: weekly transport report ${week.from} to ${week.to}`;
    await this.mailer.send({
      to: recipients.join(', '),
      subject,
      text: `${this.summary(f)}\n\nThe one-page report is attached.`,
      attachments: [{ filename: `transport-report-${week.from}.pdf`, content: this.pdf(f), contentType: 'application/pdf' }],
    });
    await this.db.query(
      `INSERT INTO job_runs (job, last_run) VALUES ('weekly-report', now()) ON CONFLICT (job) DO UPDATE SET last_run = now()`,
    );
    return { sent: true, to: recipients, ...week };
  }

  /** Monday after WEEKLY_REPORT_AT and not yet sent this week. */
  async due(now = new Date()) {
    if (!this.settings.enabled || !this.settings.to.length || !this.mailer?.configured) return false;
    const tz = this.config.timeZone;
    const today = localDate(now, tz);
    if (new Date(`${today}T12:00:00Z`).getUTCDay() !== this.settings.weekday) return false;
    const [h, m] = this.settings.at.split(':').map(Number);
    if (localMinutes(now, tz) < h * 60 + (m || 0)) return false;
    const { rows } = await this.db.query(`SELECT last_run FROM job_runs WHERE job = 'weekly-report'`);
    return !rows[0] || localDate(new Date(rows[0].last_run), tz) < today;
  }
}
