// Finance officer API (doc 4.4): collections, payments, refunds, suspensions,
// the collection statement and month-end reconciliation. Money and identity,
// and no access to live locations at all.
import express from 'express';
import { HttpError } from '../auth.js';
import { localDate, localMonth, monthRange } from '../clock.js';
import { audit, intParam, sendTable, toCsv } from '../util.js';

export function financeRouter({ db, config, billing, gateway, jobs }) {
  const r = express.Router();
  const month = (q) => q.month ?? localMonth(new Date(), config.timeZone);

  r.get('/collections', async (req, res) => res.json(await billing.collections(month(req.query))));

  r.get('/payments', async (req, res) => {
    const m = month(req.query);
    if (!monthRange(m)) throw new HttpError(400, 'month must be YYYY-MM');
    const { rows } = await db.query(
      `SELECT p.payment_id, p.receipt_no, p.gateway, p.gateway_order_id, p.gateway_payment_id, p.amount_paise, p.method,
              p.status, p.signature_verified, p.confirmed_by, p.failure_reason, p.paid_at, p.created_at, p.refunded_at,
              p.refund_reason, p.subscription_id, u.id AS user_id, u.username, u.full_name, u.register_no, u.department,
              pl.plan_code,
              (p.status = 'CAPTURED' AND p.paid_at > now() - make_interval(days => $4)) AS refundable
         FROM payments p
         JOIN users u ON u.id = p.user_id
         JOIN subscription_plans pl ON pl.plan_id = p.plan_id
        WHERE to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM') = $1
          AND ($3::text IS NULL OR p.status = $3)
        ORDER BY p.created_at DESC`,
      [m, config.timeZone, req.query.status || null, config.subscription.refundWindowDays],
    );
    res.json(rows);
  });

  r.post('/payments/:id/refund', async (req, res) => {
    res.json(await billing.refund(intParam(req.params.id, 'id'), req.auth, req.body?.reason, req.ip));
  });

  r.get('/students', async (req, res) => {
    const today = localDate(new Date(), config.timeZone);
    const q = req.query.q ? String(req.query.q).slice(0, 50) : null;
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.register_no, u.department, u.status, r.code AS route_code,
              (SELECT max(valid_to) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'ACTIVE') AS paid_until,
              (SELECT count(*)::int FROM payments p WHERE p.user_id = u.id AND p.status = 'CAPTURED') AS payments
         FROM users u LEFT JOIN routes r ON r.id = u.home_route_id
        WHERE u.role = 'student' AND ($1::text IS NULL OR u.username ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%')
        ORDER BY u.username LIMIT 500`,
      [q],
    );
    res.json(rows.map((s) => {
      const until = s.paid_until ? new Date(s.paid_until).toISOString().slice(0, 10) : null;
      return { ...s, paid_until: until, subscribed: Boolean(until && until >= today) };
    }));
  });

  const setStatus = (status, action) => async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 3) throw new HttpError(400, 'A reason is required');
    const { rows } = await db.query(`UPDATE users SET status = $2 WHERE id = $1 AND role = 'student' RETURNING id, username, status`, [id, status]);
    if (!rows[0]) throw new HttpError(404, 'Student not found');
    await audit(db, { actorId: req.auth.userId, action, entity: 'user', entityId: id, reason, ip: req.ip });
    res.json(rows[0]);
  };
  r.post('/users/:id/suspend', setStatus('suspended', 'ACCOUNT_SUSPENDED'));
  r.post('/users/:id/unsuspend', setStatus('active', 'ACCOUNT_REINSTATED'));

  /** The collection statement for the accounts department (CSV). */
  r.get('/statement', async (req, res) => {
    const m = month(req.query);
    sendTable(req, res, await billing.statement(m), `collection-statement-${m}`);
  });

  r.post('/reconcile', async (req, res) => {
    const result = await billing.reconcile(req.body?.month ?? month(req.query), req.body?.csv);
    await audit(db, { actorId: req.auth.userId, action: 'RECONCILIATION_RUN', entity: 'payment', detail: { month: result.month, matched: result.matched, exceptions: result.exceptions.length } });
    res.json(result);
  });

  r.post('/reconcile-pending', async (_req, res) => res.json(await jobs.run('reconcile')));

  /** In test mode the gateway's own settlement report is downloadable here. */
  r.get('/gateway-settlement', async (req, res) => {
    if (gateway.mode !== 'mock') throw new HttpError(404, 'Download the settlement report from the Razorpay dashboard');
    const range = monthRange(month(req.query));
    if (!range) throw new HttpError(400, 'month must be YYYY-MM');
    // Month boundaries in campus time.
    const from = new Date(`${range.from}T00:00:00+05:30`).toISOString();
    const to = new Date(new Date(`${range.to}T00:00:00+05:30`).getTime() + 86400000).toISOString();
    const rows = await gateway.settlementReport(from, to);
    res.set('content-type', 'text/csv; charset=utf-8');
    res.set('content-disposition', `attachment; filename="gateway-settlement-${month(req.query)}.csv"`);
    res.send(toCsv(rows, ['entity_id', 'type', 'payment_id', 'order_id', 'amount', 'fee', 'tax', 'method', 'created_at']));
  });

  r.get('/audit', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.ip, a.created_at, u.username AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity IN ('payment', 'subscription', 'webhook') OR a.action LIKE 'ACCOUNT_%'
        ORDER BY a.created_at DESC LIMIT 200`,
    );
    res.json(rows);
  });

  return r;
}
