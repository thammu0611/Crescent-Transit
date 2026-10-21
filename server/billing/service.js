// Subscription and online fee payment (design document, section 8).
//
// The one rule that matters: a payment is real when the gateway's webhook says
// so and its signature verifies. The client's "payment successful" screen is a
// claim, never evidence, so nothing here accepts a success from the app.
import crypto from 'node:crypto';
import { HttpError } from '../auth.js';
import { cacheFor } from '../cache.js';
import { addDays, asDate, daysBetween, localDate, monthRange } from '../clock.js';
import { audit, parseCsv } from '../util.js';
import { normaliseMethod, verifyWebhookSignature } from './gateway.js';

const RECEIPT_PREFIX = 'UBTS';

export class BillingService {
  constructor(db, config, gateway, io = null) {
    this.db = db;
    this.config = config;
    this.gateway = gateway;
    this.io = io;
    this.cache = cacheFor(db);
  }

  today() {
    return localDate(new Date(), this.config.timeZone);
  }

  async plans() {
    return this.cache.get('plans', ['subscription_plans'], 300000, async () => (await this.db.query(
      `SELECT plan_code, display_name, amount_paise, duration_days FROM subscription_plans
        WHERE active ORDER BY duration_days`,
    )).rows);
  }

  async planByCode(code) {
    return this.cache.get(`plan:${code}`, ['subscription_plans'], 300000, async () => (
      (await this.db.query('SELECT * FROM subscription_plans WHERE plan_code = $1 AND active', [code])).rows[0] ?? null
    ));
  }

  // ---- Entitlement (doc 8.4) ------------------------------------------------

  /**
   * The student's access, answered from the subscriptions table: the app never
   * decides this for itself.
   */
  async entitlement(userId) {
    // Asked on every live-data request and socket subscription: cached, and
    // refreshed by any write to subscriptions (payment, refund, expiry).
    const today = this.today();
    return this.cache.get(`entitlement:${userId}:${today}`, ['subscriptions', 'subscription_plans'], 30000, () => this.loadEntitlement(userId, today));
  }

  async loadEntitlement(userId, today) {
    const graceStart = addDays(today, -this.config.subscription.graceDays);
    const { rows } = await this.db.query(
      `SELECT s.subscription_id, s.valid_from, s.valid_to, s.status, p.plan_code, p.display_name
         FROM subscriptions s JOIN subscription_plans p ON p.plan_id = s.plan_id
        WHERE s.user_id = $1 AND s.status = 'ACTIVE' AND s.valid_to >= $2
        ORDER BY s.valid_to`,
      [userId, graceStart],
    );
    const current = rows.find((r) => asDate(r.valid_from) <= today);
    const paidUntil = rows.length ? asDate(rows.at(-1).valid_to) : null;
    if (!current) {
      const last = await this.db.query(
        `SELECT valid_to, status FROM subscriptions WHERE user_id = $1 AND status <> 'PENDING'
          ORDER BY valid_to DESC NULLS LAST LIMIT 1`,
        [userId],
      );
      return { active: false, inGrace: false, paidUntil, lastStatus: last.rows[0]?.status ?? null, lastValidTo: asDate(last.rows[0]?.valid_to) };
    }
    const validTo = asDate(current.valid_to);
    const inGrace = validTo < today;
    return {
      active: true,
      inGrace,
      subscriptionId: current.subscription_id,
      planCode: current.plan_code,
      planName: current.display_name,
      validFrom: asDate(current.valid_from),
      validTo,
      paidUntil,
      daysLeft: daysBetween(today, paidUntil),
      graceEndsOn: inGrace ? addDays(validTo, this.config.subscription.graceDays) : null,
    };
  }

  /**
   * What a student may use. With subscriptions switched off for students (the
   * default) everything is open; otherwise it is the paid entitlement.
   * `required` tells the apps whether to show the subscription screens at all.
   */
  async access(userId) {
    if (!this.config.subscription.studentRequired) return { active: true, inGrace: false, required: false };
    return { ...(await this.entitlement(userId)), required: true };
  }

  /**
   * Express middleware: refuse protected endpoints with 402 when a student has
   * no active subscription (only when subscriptions are required). Staff roles
   * pass; finance never reaches live data because those routes do not admit
   * the finance role at all.
   */
  requireSubscription() {
    return async (req, _res, next) => {
      if (req.auth?.role !== 'student') return next();
      const ent = await this.access(req.auth.userId);
      if (ent.active) {
        req.entitlement = ent;
        return next();
      }
      const plan = await this.planByCode(this.config.subscription.defaultPlan);
      next(new HttpError(402, 'An active subscription is required for this feature', {
        code: 'SUBSCRIPTION_REQUIRED',
        plan: plan?.plan_code ?? this.config.subscription.defaultPlan,
        amountPaise: plan?.amount_paise ?? 6000,
      }));
    };
  }

  // ---- Orders (doc 8.3 steps 3-4) -------------------------------------------

  async createOrder(userId, planCode, idempotencyKey) {
    const plan = await this.planByCode(planCode || this.config.subscription.defaultPlan);
    if (!plan) throw new HttpError(400, 'Unknown or inactive plan');
    const { rows: users } = await this.db.query('SELECT role, status, full_name, email, phone FROM users WHERE id = $1', [userId]);
    if (users[0]?.role !== 'student') throw new HttpError(403, 'Only students buy subscriptions');

    // A retried request (same key) or a double tap returns the same order.
    const key = typeof idempotencyKey === 'string' && /^[\w-]{8,80}$/.test(idempotencyKey) ? idempotencyKey : null;
    const existing = await this.db.query(
      `SELECT * FROM payments
        WHERE user_id = $1 AND status = 'CREATED' AND plan_id = $2
          AND (idempotency_key = $3 OR created_at > now() - interval '2 minutes')
        ORDER BY created_at DESC LIMIT 1`,
      [userId, plan.plan_id, key ?? ''],
    );
    if (existing.rows[0]) return this.orderResponse(existing.rows[0], plan, users[0], true);

    const order = await this.gateway.createOrder({
      amountPaise: plan.amount_paise,
      receipt: `u${userId}-${Date.now()}`,
      notes: { userId: String(userId), plan: plan.plan_code },
    });
    const { rows } = await this.db.query(
      `INSERT INTO payments (user_id, plan_id, gateway, gateway_order_id, idempotency_key, amount_paise)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, plan.plan_id, this.gateway.mode === 'mock' ? 'MOCK' : 'RAZORPAY', order.id, key ?? crypto.randomUUID(), plan.amount_paise],
    );
    await audit(this.db, { actorId: userId, action: 'PAYMENT_ORDER_CREATED', entity: 'payment', entityId: rows[0].payment_id, detail: { orderId: order.id, amountPaise: plan.amount_paise } });
    return this.orderResponse(rows[0], plan, users[0], false);
  }

  orderResponse(payment, plan, user, reused) {
    return {
      paymentId: payment.payment_id,
      orderId: payment.gateway_order_id,
      amountPaise: payment.amount_paise,
      currency: 'INR',
      planCode: plan.plan_code,
      planName: plan.display_name,
      gateway: this.gateway.mode,
      keyId: this.gateway.keyId,
      merchant: this.config.payment.merchantName,
      prefill: { name: user.full_name, email: user.email ?? undefined, contact: user.phone ?? undefined },
      reused,
    };
  }

  // ---- Webhook (doc 8.3 steps 5-6) ------------------------------------------

  async handleWebhook(rawBody, signature, ip) {
    if (!verifyWebhookSignature(rawBody, signature, this.config.payment.webhookSecret)) {
      await audit(this.db, { action: 'SECURITY_WEBHOOK_BAD_SIGNATURE', entity: 'webhook', ip, detail: { bytes: rawBody?.length ?? 0 } });
      console.warn(`[security] payment webhook with an invalid signature from ${ip}`);
      throw new HttpError(401, 'Invalid signature');
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Body is not valid JSON');
    }
    const payment = event?.payload?.payment?.entity;
    const refund = event?.payload?.refund?.entity;
    switch (event?.event) {
      case 'payment.captured':
      case 'order.paid':
        if (!payment) throw new HttpError(400, 'Missing payment entity');
        return this.applyCapture(
          { orderId: payment.order_id, gatewayPaymentId: payment.id, amountPaise: payment.amount, method: payment.method },
          'WEBHOOK',
          ip,
        );
      case 'payment.failed':
        if (!payment) throw new HttpError(400, 'Missing payment entity');
        return this.applyFailure(payment.order_id, payment.error_description ?? 'Payment failed');
      case 'refund.processed':
      case 'payment.refunded': {
        const gatewayPaymentId = refund?.payment_id ?? payment?.id;
        return this.applyRefund(gatewayPaymentId, { gatewayRefundId: refund?.id ?? null, reason: 'Refund or chargeback reported by the gateway' });
      }
      default:
        return { ignored: true, event: event?.event ?? null };
    }
  }

  /**
   * Record a captured payment and activate (or extend) the subscription, all
   * in one transaction. Safe to call twice for the same payment.
   */
  async applyCapture({ orderId, gatewayPaymentId, amountPaise, method }, source, ip = null) {
    const today = this.today();
    const result = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT p.*, pl.amount_paise AS plan_amount, pl.duration_days, pl.plan_code
           FROM payments p JOIN subscription_plans pl ON pl.plan_id = p.plan_id
          WHERE p.gateway_order_id = $1 FOR UPDATE OF p`,
        [orderId],
      );
      const pay = rows[0];
      if (!pay) {
        await audit(tx, { action: 'WEBHOOK_UNKNOWN_ORDER', entity: 'payment', ip, detail: { orderId, gatewayPaymentId } });
        return { ignored: true, reason: 'unknown order' };
      }
      // The webhook arrives twice / is replayed: record once, charge once.
      if (pay.status === 'CAPTURED' || pay.status === 'REFUNDED' || pay.gateway_payment_id) {
        await audit(tx, { action: 'WEBHOOK_DUPLICATE', entity: 'payment', entityId: pay.payment_id, ip, detail: { gatewayPaymentId, source } });
        return { duplicate: true, paymentId: pay.payment_id };
      }
      // An order for Rs 1 must never activate a Rs 60 plan (doc 8.5).
      if (amountPaise !== pay.amount_paise || amountPaise !== pay.plan_amount) {
        await tx.query(`UPDATE payments SET status = 'FAILED', failure_reason = $2 WHERE payment_id = $1`, [
          pay.payment_id,
          `AMOUNT_MISMATCH: got ${amountPaise}, expected ${pay.plan_amount}`,
        ]);
        await audit(tx, { action: 'SECURITY_AMOUNT_MISMATCH', entity: 'payment', entityId: pay.payment_id, ip, detail: { amountPaise, expected: pay.plan_amount } });
        return { rejected: true, reason: 'AMOUNT_MISMATCH', paymentId: pay.payment_id };
      }

      // Paying again while still valid extends by another period (doc 8.5).
      const latest = await tx.query(
        `SELECT max(valid_to) AS valid_to FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'`,
        [pay.user_id],
      );
      const lastTo = asDate(latest.rows[0]?.valid_to);
      const validFrom = lastTo && lastTo >= today ? addDays(lastTo, 1) : today;
      const validTo = addDays(validFrom, pay.duration_days - 1);
      const sub = await tx.query(
        `INSERT INTO subscriptions (user_id, plan_id, status, valid_from, valid_to)
         VALUES ($1, $2, 'ACTIVE', $3, $4) RETURNING subscription_id`,
        [pay.user_id, pay.plan_id, validFrom, validTo],
      );
      const receiptNo = `${RECEIPT_PREFIX}-${today.slice(0, 7).replace('-', '')}-${String(pay.payment_id).padStart(6, '0')}`;
      await tx.query(
        `UPDATE payments SET status = 'CAPTURED', gateway_payment_id = $2, method = $3, signature_verified = $4,
                confirmed_by = $5, paid_at = now(), receipt_no = $6, subscription_id = $7
          WHERE payment_id = $1`,
        [pay.payment_id, gatewayPaymentId, normaliseMethod(method), source === 'WEBHOOK', source, receiptNo, sub.rows[0].subscription_id],
      );
      await audit(tx, { action: 'PAYMENT_CAPTURED', entity: 'payment', entityId: pay.payment_id, ip, detail: { gatewayPaymentId, amountPaise, source } });
      await audit(tx, { action: 'SUBSCRIPTION_ACTIVATED', entity: 'subscription', entityId: sub.rows[0].subscription_id, detail: { userId: pay.user_id, validFrom, validTo } });
      return { activated: true, paymentId: pay.payment_id, userId: pay.user_id, subscriptionId: sub.rows[0].subscription_id, validFrom, validTo, receiptNo };
    }).catch(async (err) => {
      // The same gateway payment id against another order: a replay, never a second period.
      if (err.code === '23505') return { duplicate: true };
      throw err;
    });
    if (result.activated) this.io?.to(`user:${result.userId}`).emit('subscription:updated', { receiptNo: result.receiptNo, validTo: result.validTo });
    return result;
  }

  async applyFailure(orderId, reason) {
    const { rows } = await this.db.query(
      `UPDATE payments SET status = 'FAILED', failure_reason = $2 WHERE gateway_order_id = $1 AND status = 'CREATED'
       RETURNING payment_id, user_id`,
      [orderId, String(reason).slice(0, 200)],
    );
    if (rows[0]) {
      await audit(this.db, { action: 'PAYMENT_FAILED', entity: 'payment', entityId: rows[0].payment_id, reason });
      this.io?.to(`user:${rows[0].user_id}`).emit('subscription:updated', { failed: true });
    }
    return { failed: Boolean(rows[0]) };
  }

  // ---- Refunds (doc 8.5, 8.8) -----------------------------------------------

  /** Finance officer refund: finance role + recorded reason, full amount, 7-day window. */
  async refund(paymentId, actor, reason, ip) {
    if (actor.role !== 'finance') throw new HttpError(403, 'Refunds require the finance role');
    if (typeof reason !== 'string' || reason.trim().length < 5) throw new HttpError(400, 'A refund reason is required');
    const { rows } = await this.db.query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    const pay = rows[0];
    if (!pay) throw new HttpError(404, 'Payment not found');
    if (pay.status === 'REFUNDED') throw new HttpError(409, 'Already refunded');
    if (pay.status !== 'CAPTURED') throw new HttpError(409, 'Only captured payments can be refunded');
    const ageDays = (Date.now() - new Date(pay.paid_at).getTime()) / 86400000;
    if (ageDays > this.config.subscription.refundWindowDays) {
      throw new HttpError(409, `Refund window of ${this.config.subscription.refundWindowDays} days has passed`);
    }
    const refund = await this.gateway.refund(pay.gateway_payment_id, pay.amount_paise, { reason: reason.trim() });
    return this.applyRefund(pay.gateway_payment_id, { gatewayRefundId: refund.id, reason: reason.trim(), actorId: actor.userId, ip });
  }

  /** Mark refunded and revoke the subscription from today. Idempotent. */
  async applyRefund(gatewayPaymentId, { gatewayRefundId, reason, actorId = null, ip = null }) {
    const result = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query('SELECT * FROM payments WHERE gateway_payment_id = $1 FOR UPDATE', [gatewayPaymentId]);
      const pay = rows[0];
      if (!pay) return { ignored: true, reason: 'unknown payment' };
      if (pay.status === 'REFUNDED') return { duplicate: true, paymentId: pay.payment_id };
      await tx.query(
        `UPDATE payments SET status = 'REFUNDED', refunded_at = now(), refund_reason = $2, gateway_refund_id = $3
          WHERE payment_id = $1`,
        [pay.payment_id, reason, gatewayRefundId],
      );
      if (pay.subscription_id) {
        await tx.query(`UPDATE subscriptions SET status = 'REFUNDED', ended_at = now() WHERE subscription_id = $1`, [pay.subscription_id]);
      }
      await audit(tx, { actorId, action: 'PAYMENT_REFUNDED', entity: 'payment', entityId: pay.payment_id, reason, ip, detail: { gatewayRefundId } });
      await audit(tx, { actorId, action: 'SUBSCRIPTION_REVOKED', entity: 'subscription', entityId: pay.subscription_id, reason });
      return { refunded: true, paymentId: pay.payment_id, userId: pay.user_id };
    });
    if (result.refunded) this.io?.to(`user:${result.userId}`).emit('subscription:updated', { refunded: true });
    return result;
  }

  async refundBySubscription(subscriptionId, actor, reason, ip) {
    const { rows } = await this.db.query('SELECT payment_id FROM payments WHERE subscription_id = $1', [subscriptionId]);
    if (!rows[0]) throw new HttpError(404, 'No payment for that subscription');
    return this.refund(rows[0].payment_id, actor, reason, ip);
  }

  // ---- Background jobs --------------------------------------------------------

  /** Doc 8.5: the webhook never arrived. Ask the gateway about unresolved orders. */
  async reconcilePending() {
    const { rows } = await this.db.query(
      `SELECT gateway_order_id FROM payments
        WHERE status = 'CREATED'
          AND created_at < now() - make_interval(mins => $1)
          AND created_at > now() - interval '3 days'`,
      [this.config.subscription.pendingOrderMinutes],
    );
    const repaired = [];
    for (const { gateway_order_id: orderId } of rows) {
      try {
        const payments = await this.gateway.fetchOrderPayments(orderId);
        const captured = payments.find((p) => p.status === 'captured');
        if (captured) {
          const r = await this.applyCapture(
            { orderId, gatewayPaymentId: captured.id, amountPaise: captured.amount, method: captured.method },
            'RECONCILIATION',
          );
          if (r.activated) repaired.push(orderId);
        } else if (payments.length && payments.every((p) => p.status === 'failed')) {
          await this.applyFailure(orderId, 'All attempts failed (reconciliation)');
        }
      } catch (err) {
        console.warn(`[billing] reconciliation of ${orderId} failed: ${err.message}`);
      }
    }
    return { checked: rows.length, repaired };
  }

  /** Mark subscriptions past their grace period as EXPIRED. */
  async expireSubscriptions() {
    const cutoff = addDays(this.today(), -this.config.subscription.graceDays);
    const { rows } = await this.db.query(
      `UPDATE subscriptions SET status = 'EXPIRED', ended_at = now()
        WHERE status = 'ACTIVE' AND valid_to < $1 RETURNING subscription_id`,
      [cutoff],
    );
    if (rows.length) await audit(this.db, { action: 'SUBSCRIPTIONS_EXPIRED', entity: 'subscription', detail: { count: rows.length } });
    return { expired: rows.length };
  }

  // ---- Student views ------------------------------------------------------------

  async myPayments(userId) {
    const { rows } = await this.db.query(
      `SELECT p.payment_id, p.receipt_no, p.amount_paise, p.method, p.status, p.paid_at, p.created_at,
              p.refunded_at, p.failure_reason, pl.display_name AS plan_name, s.valid_from, s.valid_to
         FROM payments p
         JOIN subscription_plans pl ON pl.plan_id = p.plan_id
         LEFT JOIN subscriptions s ON s.subscription_id = p.subscription_id
        WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({ ...r, valid_from: asDate(r.valid_from), valid_to: asDate(r.valid_to) }));
  }

  async receiptData(paymentId, auth) {
    const { rows } = await this.db.query(
      `SELECT p.*, pl.display_name, pl.plan_code, s.valid_from, s.valid_to,
              u.full_name, u.username, u.register_no, u.department
         FROM payments p
         JOIN subscription_plans pl ON pl.plan_id = p.plan_id
         JOIN users u ON u.id = p.user_id
         LEFT JOIN subscriptions s ON s.subscription_id = p.subscription_id
        WHERE p.payment_id = $1`,
      [paymentId],
    );
    const p = rows[0];
    if (!p || (auth.role === 'student' && p.user_id !== auth.userId)) throw new HttpError(404, 'Receipt not found');
    if (!p.receipt_no) throw new HttpError(409, 'This payment has no receipt (not captured)');
    const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: this.config.timeZone, dateStyle: 'medium', timeStyle: 'short' });
    return {
      merchant: this.config.payment.merchantName,
      receiptNo: p.receipt_no,
      studentName: p.full_name,
      username: p.username,
      registerNo: p.register_no,
      department: p.department,
      planName: p.display_name,
      planCode: p.plan_code,
      validFrom: asDate(p.valid_from),
      validTo: asDate(p.valid_to),
      amount: `Rs ${(p.amount_paise / 100).toFixed(2)}`,
      method: p.method,
      paidAt: fmt(p.paid_at),
      gatewayPaymentId: p.gateway_payment_id,
      gatewayOrderId: p.gateway_order_id,
      status: p.status,
      refundedAt: p.refunded_at ? fmt(p.refunded_at) : null,
    };
  }

  // ---- Finance reports (doc 4.4, 8.9) -----------------------------------------

  feeOf(amountPaise) {
    const fee = amountPaise * this.config.finance.gatewayFeeRate;
    return Math.round(fee * (1 + this.config.finance.gstOnFeeRate));
  }

  async collections(month) {
    const range = monthRange(month);
    if (!range) throw new HttpError(400, 'month must be YYYY-MM');
    const tz = this.config.timeZone;
    const { rows } = await this.db.query(
      `SELECT p.payment_id, p.amount_paise, p.status, p.method, u.department,
              r.code AS route_code, r.name AS route_name,
              to_char(p.paid_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
         FROM payments p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN routes r ON r.id = u.home_route_id
        WHERE p.status IN ('CAPTURED', 'REFUNDED')
          AND to_char(p.paid_at AT TIME ZONE $2, 'YYYY-MM') = $1`,
      [month, tz],
    );
    const refunds = await this.db.query(
      `SELECT count(*)::int AS n, coalesce(sum(amount_paise), 0)::int AS paise FROM payments
        WHERE status = 'REFUNDED' AND to_char(refunded_at AT TIME ZONE $2, 'YYYY-MM') = $1`,
      [month, tz],
    );
    const group = (key) => {
      const m = new Map();
      for (const r of rows) {
        const k = r[key] ?? 'Unassigned';
        const g = m.get(k) ?? { key: k, payments: 0, grossPaise: 0 };
        g.payments += 1;
        g.grossPaise += r.amount_paise;
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.grossPaise - a.grossPaise);
    };
    const gross = rows.reduce((s, r) => s + r.amount_paise, 0);
    const fees = rows.reduce((s, r) => s + this.feeOf(r.amount_paise), 0);
    const refundPaise = refunds.rows[0].paise;
    const running = this.config.finance.monthlyRunningCostPaise;
    const plan = await this.planByCode(this.config.subscription.defaultPlan);
    const netPerSubscriber = plan ? plan.amount_paise - this.feeOf(plan.amount_paise) : null;

    const active = await this.db.query(
      `SELECT count(DISTINCT user_id)::int AS n FROM subscriptions
        WHERE status = 'ACTIVE' AND valid_from <= $1 AND valid_to >= $2`,
      [range.to, range.from],
    );
    const students = await this.db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'student'`);
    return {
      month,
      payments: rows.length,
      grossPaise: gross,
      refundsPaise: refundPaise,
      refundCount: refunds.rows[0].n,
      gatewayFeesPaise: fees,
      netCollectionPaise: gross - refundPaise - fees,
      runningCostPaise: running,
      netAfterCostsPaise: gross - refundPaise - fees - running,
      subscribersInMonth: active.rows[0].n,
      registeredStudents: students.rows[0].n,
      studentsCarried: this.config.finance.studentsCarried,
      adoptionPct: Math.round((active.rows[0].n / this.config.finance.studentsCarried) * 1000) / 10,
      breakEvenSubscribers: netPerSubscriber ? Math.ceil(running / netPerSubscriber) : null,
      byRoute: group('route_code').map((g) => ({ ...g, routeName: rows.find((r) => r.route_code === g.key)?.route_name ?? null })),
      byDepartment: group('department'),
      byMethod: group('method'),
      byDay: group('day').sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  /** The system's own ledger for a month, for the accounts department. */
  async statement(month) {
    if (!monthRange(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const { rows } = await this.db.query(
      `SELECT p.receipt_no, p.payment_id, p.gateway_payment_id, p.gateway_order_id, u.username, u.full_name,
              u.register_no, u.department, r.code AS route, pl.plan_code, p.amount_paise, p.method, p.status,
              p.confirmed_by, p.signature_verified, p.paid_at, p.refunded_at, p.refund_reason
         FROM payments p
         JOIN users u ON u.id = p.user_id
         JOIN subscription_plans pl ON pl.plan_id = p.plan_id
         LEFT JOIN routes r ON r.id = u.home_route_id
        WHERE p.status IN ('CAPTURED', 'REFUNDED') AND to_char(p.paid_at AT TIME ZONE $2, 'YYYY-MM') = $1
        ORDER BY p.paid_at`,
      [month, this.config.timeZone],
    );
    return rows.map((r) => ({ ...r, amount_rupees: (r.amount_paise / 100).toFixed(2) }));
  }

  /**
   * Month-end reconciliation (doc 8.5): the gateway's settlement report against
   * our payments table, line by line. Every row present on one side only, or
   * with a different amount or state, is an exception to investigate.
   */
  async reconcile(month, settlementCsv) {
    const range = monthRange(month);
    if (!range) throw new HttpError(400, 'month must be YYYY-MM');
    const lines = parseCsv(settlementCsv);
    if (!lines.length) throw new HttpError(400, 'The settlement report is empty');
    if (!('payment_id' in lines[0] || 'entity_id' in lines[0])) throw new HttpError(400, 'Settlement report needs an entity_id or payment_id column');

    const gatewayPayments = new Map();
    const gatewayRefunds = new Set();
    for (const l of lines) {
      const type = (l.type || 'payment').toLowerCase();
      const pid = l.payment_id || l.entity_id;
      if (type === 'refund') gatewayRefunds.add(pid);
      else if (type === 'payment') gatewayPayments.set(pid, { amountPaise: Math.round(Number(l.amount) * 100), orderId: l.order_id || null });
    }

    const { rows } = await this.db.query(
      `SELECT payment_id, gateway_payment_id, gateway_order_id, amount_paise, status, receipt_no
         FROM payments
        WHERE (status IN ('CAPTURED', 'REFUNDED') AND to_char(paid_at AT TIME ZONE $2, 'YYYY-MM') = $1)
           OR gateway_payment_id = ANY($3)`,
      [month, this.config.timeZone, [...gatewayPayments.keys()]],
    );
    const ours = new Map(rows.filter((r) => r.gateway_payment_id).map((r) => [r.gateway_payment_id, r]));
    const exceptions = [];
    let matched = 0;
    for (const [pid, g] of gatewayPayments) {
      const o = ours.get(pid);
      if (!o) exceptions.push({ type: 'MISSING_IN_SYSTEM', gatewayPaymentId: pid, orderId: g.orderId, detail: 'Gateway settled a payment the system never recorded' });
      else if (o.amount_paise !== g.amountPaise) exceptions.push({ type: 'AMOUNT_MISMATCH', gatewayPaymentId: pid, receiptNo: o.receipt_no, detail: `system ${o.amount_paise} paise, gateway ${g.amountPaise} paise` });
      else if ((o.status === 'REFUNDED') !== gatewayRefunds.has(pid)) exceptions.push({ type: 'REFUND_MISMATCH', gatewayPaymentId: pid, receiptNo: o.receipt_no, detail: `system ${o.status}, gateway ${gatewayRefunds.has(pid) ? 'refunded' : 'not refunded'}` });
      else matched += 1;
    }
    for (const [pid, o] of ours) {
      if (!gatewayPayments.has(pid)) exceptions.push({ type: 'MISSING_AT_GATEWAY', gatewayPaymentId: pid, receiptNo: o.receipt_no, detail: 'System recorded a payment the gateway did not settle' });
    }
    return { month, gatewayRows: gatewayPayments.size, systemRows: ours.size, matched, exceptions };
  }
}
