// Endpoints for the automations: the driver's standby positions (automatic
// trip start), acknowledging an SOS, the suggestions queue, the weekly report,
// WhatsApp/SMS numbers for parents without the app, and service credits.
import { HttpError } from '../auth.js';
import { intParam, rateLimit } from '../util.js';

export function mountAutomations(app, { db, config, autoStart, escalation, insights, weekly, messaging, followups, driverOnly, adminOnly, student }) {
  // ---- Driver: automatic trip start --------------------------------------------------
  app.post('/api/driver/standby', driverOnly, rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    res.json(await autoStart.standby(req.auth, req.body));
  });

  // ---- Transport office: SOS acknowledgement ------------------------------------------
  app.post('/api/admin/incidents/:id/ack', adminOnly, async (req, res) => {
    res.json(await escalation.acknowledge(intParam(req.params.id, 'id'), req.auth.userId));
  });

  // ---- Suggestions -------------------------------------------------------------------
  app.get('/api/admin/suggestions', adminOnly, async (req, res) => {
    const status = req.query.status === 'all' ? null : String(req.query.status ?? 'PENDING').toUpperCase();
    if (status && !['PENDING', 'APPLIED', 'DISMISSED'].includes(status)) throw new HttpError(400, 'Unknown status');
    res.json(await insights.list(status));
  });
  app.post('/api/admin/suggestions/refresh', adminOnly, async (_req, res) => res.json(await insights.daily()));
  app.post('/api/admin/suggestions/:id/:action', adminOnly, async (req, res) => {
    res.json(await insights.decide(intParam(req.params.id, 'id'), req.params.action, req.auth.userId));
  });

  // ---- Weekly report -----------------------------------------------------------------
  const weekQuery = (q) => {
    if (q.from && q.to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) throw new HttpError(400, 'from/to must be YYYY-MM-DD');
      return { from: q.from, to: q.to };
    }
    return weekly.lastWeek();
  };
  app.get('/api/admin/weekly-report', adminOnly, async (req, res) => {
    res.json({ ...(await weekly.figures(weekQuery(req.query))), recipients: config.weeklyReport.to, schedule: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][config.weeklyReport.weekday]} ${config.weeklyReport.at}` });
  });
  app.get('/api/admin/weekly-report.pdf', adminOnly, async (req, res) => {
    const week = weekQuery(req.query);
    res.type('application/pdf').set('content-disposition', `attachment; filename="transport-report-${week.from}.pdf"`).send(weekly.pdf(await weekly.figures(week)));
  });
  app.post('/api/admin/weekly-report/send', adminOnly, rateLimit({ windowMs: 60000, max: 3 }), async (req, res) => {
    const to = req.body?.to ? String(req.body.to).trim() : null;
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'Enter a valid email address');
    const result = await weekly.send({ to });
    if (!result.sent) throw new HttpError(409, result.reason);
    res.json(result);
  });

  // ---- WhatsApp / SMS ----------------------------------------------------------------
  app.get('/api/admin/messaging', adminOnly, async (req, res) => res.json(await messaging.usage(Number(req.query.days) || 30)));

  app.get('/api/me/parent-contacts', student, async (req, res) => {
    res.json({ contacts: await messaging.contacts(req.auth.userId), channels: messaging.channels(), max: config.messaging.maxContactsPerStudent });
  });
  app.post('/api/me/parent-contacts', student, rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    res.status(201).json(await messaging.addContact(req.auth.userId, req.body));
  });
  app.delete('/api/me/parent-contacts/:id', student, async (req, res) => {
    res.json(await messaging.removeContact(req.auth.userId, intParam(req.params.id, 'id')));
  });

  // ---- Service credits and what runs by itself ---------------------------------------
  app.get('/api/admin/service-credits', adminOnly, async (_req, res) => {
    const { rows } = await db.query(
      `SELECT c.day, c.students, c.reason, r.code AS route_code FROM service_credits c JOIN routes r ON r.id = c.route_id ORDER BY c.day DESC, r.code LIMIT 100`,
    );
    res.json(rows);
  });
  app.get('/api/admin/automations', adminOnly, async (_req, res) => {
    const chain = await escalation.chain();
    res.json({
      renewalReminders: { daysBefore: config.followups.renewDaysBefore, link: followups.renewUrl() },
      checklistReminderMin: config.followups.checklistBeforeMin,
      complaintHours: { remind: config.followups.complaintRemindHours, escalate: config.followups.complaintEscalateHours },
      escalation: { afterMinutes: config.escalation.afterMinutes, chain: chain.map((p) => ({ username: p.username, name: p.full_name })) },
      weeklyReport: { enabled: config.weeklyReport.enabled, to: config.weeklyReport.to, at: config.weeklyReport.at },
      phoneAutoStart: config.phoneAutoStart.enabled,
      serviceCredits: config.followups.serviceCredits,
      messaging: messaging.channels(),
    });
  });
}
