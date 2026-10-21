// Subscription and online fee payment (doc section 8), end to end against the
// built-in test gateway. Covers every failure case of doc 8.5 and the
// entitlement cases of doc 11.1.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook } from '../server/billing/gateway.js';
import { addDays, localDate } from '../server/clock.js';
import { startTestServer } from './helpers.js';

let t;
before(async () => {
  // Orders older than 0 minutes count as pending, so reconciliation can be tested at once.
  t = await startTestServer({ subscription: { pendingOrderMinutes: 0 } });
});
after(() => t.stop());

const today = () => localDate(new Date(), 'Asia/Kolkata');
const webhook = (event, secret = t.config.payment.webhookSecret) => {
  const raw = JSON.stringify(event);
  return t.call('/api/webhooks/payment', { raw, headers: { 'x-razorpay-signature': signWebhook(raw, secret) } });
};
const captured = (orderId, paymentId, amount) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, method: 'upi', status: 'captured' } } },
});

test('without a subscription, protected endpoints answer 402 with the plan; free view still works', async () => {
  const s = await t.newStudent();
  const live = await t.call('/api/live', { token: s.token });
  assert.equal(live.status, 402);
  assert.equal(live.body.code, 'SUBSCRIPTION_REQUIRED');
  assert.equal(live.body.plan, 'MONTHLY_60');
  assert.equal(live.body.amountPaise, 6000);
  assert.equal((await t.call('/api/eta?route=118&stop=3', { token: s.token })).status, 402);
  assert.equal((await t.call('/api/attendance/me', { token: s.token })).status, 402);
  assert.equal((await t.call('/api/routes')).status, 200, 'route list is free');
  assert.equal((await t.call('/api/notices')).status, 200, 'notice board is free');
  assert.equal((await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'help' } })).status, 201, 'SOS is free');
});

test('pay -> signed webhook -> 30 days of access, a receipt and a PDF', async () => {
  const s = await t.newStudent('119');
  const { order, paid } = await t.subscribe(s.token);
  assert.equal(order.amountPaise, 6000, 'the server sets the amount, never the client');
  assert.equal(paid.status, 'captured');
  assert.equal(paid.deliveries[0].body.activated, true);

  const me = (await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement;
  assert.equal(me.active, true);
  assert.equal(me.validFrom, today());
  assert.equal(me.validTo, addDays(today(), 29));
  assert.equal((await t.call('/api/live', { token: s.token })).status, 200);

  const [payment] = (await t.call('/api/payments/me', { token: s.token })).body;
  assert.equal(payment.status, 'CAPTURED');
  assert.match(payment.receipt_no, /^UBTS-\d{6}-\d{6}$/);
  const pdf = await t.call(`/api/payments/${payment.payment_id}/receipt`, { token: s.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  const other = await t.newStudent();
  assert.equal((await t.call(`/api/payments/${payment.payment_id}/receipt`, { token: other.token })).status, 404, 'not someone else\'s receipt');
});

test('a double tap returns the same order instead of creating two', async () => {
  const s = await t.newStudent();
  const a = await t.call('/api/subscriptions/order', { token: s.token, body: {}, headers: { 'idempotency-key': 'same-key-123' } });
  const b = await t.call('/api/subscriptions/order', { token: s.token, body: {}, headers: { 'idempotency-key': 'same-key-123' } });
  assert.equal(a.body.orderId, b.body.orderId);
  assert.equal(b.body.reused, true);
});

test('the webhook arrives twice / is replayed: recorded once, no second period', async () => {
  const s = await t.newStudent();
  const { order, paid } = await t.subscribe(s.token, { webhook: 'twice' });
  assert.equal(paid.deliveries[0].body.activated, true);
  assert.equal(paid.deliveries[1].body.duplicate, true);
  // An attacker replays the captured, validly signed body later.
  const replay = await webhook(captured(order.orderId, paid.paymentId, 6000));
  assert.equal(replay.body.duplicate, true);
  const subs = await t.db.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1', [s.user.id]);
  assert.equal(subs.rows[0].n, 1);
});

test('a forged signature is rejected, logged as a security event, and grants nothing', async () => {
  const s = await t.newStudent();
  const order = (await t.call('/api/subscriptions/order', { token: s.token, body: {} })).body;
  const forged = await webhook(captured(order.orderId, 'pay_forged', 6000), 'not-the-secret');
  assert.equal(forged.status, 401);
  const missing = await t.call('/api/webhooks/payment', { body: captured(order.orderId, 'pay_forged2', 6000) });
  assert.equal(missing.status, 401, 'a "payment successful" claim from the app has no signature');
  const logged = await t.db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'SECURITY_WEBHOOK_BAD_SIGNATURE'`);
  assert.ok(logged.rows[0].n >= 2);
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, false);
});

test('an amount that does not match the plan never activates it', async () => {
  const s = await t.newStudent();
  const order = (await t.call('/api/subscriptions/order', { token: s.token, body: {} })).body;
  const r = await webhook(captured(order.orderId, 'pay_one_rupee', 100));
  assert.equal(r.body.rejected, true);
  assert.equal(r.body.reason, 'AMOUNT_MISMATCH');
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, false);
});

test('paying twice in a month extends validity by another 30 days', async () => {
  const s = await t.newStudent();
  await t.subscribe(s.token);
  await t.subscribe(s.token);
  const me = (await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement;
  assert.equal(me.validTo, addDays(today(), 29), 'the current period is unchanged');
  assert.equal(me.paidUntil, addDays(today(), 59), 'the second payment starts the day after');
});

test('the exclusion constraint makes overlapping active periods impossible in the database', async () => {
  const s = await t.newStudent();
  await t.subscribe(s.token);
  await assert.rejects(
    t.db.query(`INSERT INTO subscriptions (user_id, plan_id, status, valid_from, valid_to) SELECT $1, plan_id, 'ACTIVE', $2, $3 FROM subscription_plans WHERE plan_code = 'MONTHLY_60'`, [s.user.id, addDays(today(), 5), addDays(today(), 34)]),
    /one_active_per_user/,
  );
});

test('money taken but the webhook never arrived: the reconciliation job repairs it', async () => {
  const s = await t.newStudent();
  const { paid } = await t.subscribe(s.token, { webhook: 'drop' });
  assert.equal(paid.deliveries.length, 0);
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, false);
  const run = await t.jobs.run('reconcile');
  assert.ok(run.repaired.length >= 1);
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, true);
  const pay = (await t.db.query('SELECT confirmed_by, signature_verified FROM payments WHERE user_id = $1', [s.user.id])).rows[0];
  assert.equal(pay.confirmed_by, 'RECONCILIATION');
});

test('a failed payment grants nothing and is recorded as FAILED', async () => {
  const s = await t.newStudent();
  const order = (await t.call('/api/subscriptions/order', { token: s.token, body: {} })).body;
  await t.call(`/api/mock-gateway/orders/${order.orderId}/pay`, { body: { outcome: 'failure' } });
  const [p] = (await t.call('/api/payments/me', { token: s.token })).body;
  assert.equal(p.status, 'FAILED');
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, false);
});

test('grace period: 5 days after expiry access continues; after that, 402; the job marks EXPIRED', async () => {
  const s = await t.newStudent();
  await t.subscribe(s.token);
  const setValidTo = (d) => t.db.query(`UPDATE subscriptions SET valid_from = $2, valid_to = $3 WHERE user_id = $1`, [s.user.id, addDays(d, -29), d]);

  await setValidTo(addDays(today(), -3));
  const grace = (await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement;
  assert.equal(grace.active, true);
  assert.equal(grace.inGrace, true);
  assert.equal((await t.call('/api/live', { token: s.token })).status, 200);

  await setValidTo(addDays(today(), -6));
  assert.equal((await t.call('/api/live', { token: s.token })).status, 402);
  await t.jobs.run('expire');
  const st = await t.db.query('SELECT status FROM subscriptions WHERE user_id = $1', [s.user.id]);
  assert.equal(st.rows[0].status, 'EXPIRED');
});

test('refunds: finance role plus a reason; the student cannot refund; access is revoked', async () => {
  const s = await t.newStudent();
  await t.subscribe(s.token);
  const sub = (await t.db.query('SELECT subscription_id FROM subscriptions WHERE user_id = $1', [s.user.id])).rows[0];
  const finance = await t.login('finance');
  const admin = await t.login('admin');

  assert.equal((await t.call(`/api/admin/subscriptions/${sub.subscription_id}/refund`, { token: s.token, body: { reason: 'please' } })).status, 403);
  assert.equal((await t.call(`/api/admin/subscriptions/${sub.subscription_id}/refund`, { token: admin, body: { reason: 'please' } })).status, 403, 'the transport admin does not handle money');
  assert.equal((await t.call(`/api/admin/subscriptions/${sub.subscription_id}/refund`, { token: finance, body: {} })).status, 400, 'a reason is required');

  const r = await t.call(`/api/admin/subscriptions/${sub.subscription_id}/refund`, { token: finance, body: { reason: 'Paid by mistake' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.refunded, true);
  assert.equal((await t.call('/api/live', { token: s.token })).status, 402, 'back to the free view');
  assert.equal((await t.call(`/api/admin/subscriptions/${sub.subscription_id}/refund`, { token: finance, body: { reason: 'again' } })).status, 409);
  const gw = await t.db.query(`SELECT p.status FROM mock_gateway_payments p JOIN payments q ON q.gateway_payment_id = p.id WHERE q.user_id = $1`, [s.user.id]);
  assert.equal(gw.rows[0].status, 'refunded', 'the refund went through the gateway');
});

test('a chargeback reported by the gateway revokes the subscription', async () => {
  const s = await t.newStudent();
  const { paid } = await t.subscribe(s.token);
  // The chargeback happens at the gateway, which then notifies us.
  await t.gateway.refund(paid.paymentId, 6000);
  const r = await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_cb', payment_id: paid.paymentId, amount: 6000 } } } });
  assert.equal(r.body.refunded, true);
  assert.equal((await t.call('/api/subscriptions/me', { token: s.token })).body.entitlement.active, false);
});

test('month-end reconciliation matches the gateway settlement report line by line', async () => {
  const finance = await t.login('finance');
  const month = today().slice(0, 7);
  const csv = (await t.call(`/api/finance/gateway-settlement?month=${month}`, { token: finance })).body.toString();
  const clean = await t.call('/api/finance/reconcile', { token: finance, body: { month, csv } });
  assert.equal(clean.status, 200);
  assert.equal(clean.body.exceptions.length, 0, JSON.stringify(clean.body.exceptions));
  assert.ok(clean.body.matched >= 5);

  // A settled payment the system never recorded, and an amount that differs.
  const lines = csv.trim().split('\r\n');
  const tampered = [...lines, 'pay_ghost,payment,pay_ghost,order_ghost,60.00,1.42,0.22,upi,2026-10-01T00:00:00.000Z'];
  tampered[1] = tampered[1].replace(',60.00,', ',1.00,');
  const bad = await t.call('/api/finance/reconcile', { token: finance, body: { month, csv: tampered.join('\r\n') } });
  const types = bad.body.exceptions.map((e) => e.type).sort();
  assert.deepEqual(types, ['AMOUNT_MISMATCH', 'MISSING_IN_SYSTEM']);
});

test('collections report, statement CSV, and least privilege between finance and transport admin', async () => {
  const finance = await t.login('finance');
  const admin = await t.login('admin');
  const month = today().slice(0, 7);
  const c = (await t.call(`/api/reports/collections?month=${month}`, { token: finance })).body;
  assert.ok(c.payments >= 5);
  assert.equal(c.breakEvenSubscribers, 217, 'Rs 12,700 / Rs 58.58 = 217 (doc 8.9)');
  assert.ok(c.byRoute.length >= 1 && c.byDepartment.length >= 1);
  const statement = await t.call(`/api/finance/statement?month=${month}&format=csv`, { token: finance });
  assert.match(statement.body.toString(), /^receipt_no,/);

  assert.equal((await t.call(`/api/reports/collections?month=${month}`, { token: admin })).status, 403);
  assert.equal((await t.call('/api/live', { token: finance })).status, 403, 'finance never sees live locations');
});

test('a suspended account cannot sign in or use its old token', async () => {
  const s = await t.newStudent();
  const finance = await t.login('finance');
  assert.equal((await t.call(`/api/finance/users/${s.user.id}/suspend`, { token: finance, body: { reason: 'Unpaid dues' } })).status, 200);
  assert.equal((await t.call('/api/me', { token: s.token })).status, 403);
  assert.equal((await t.call('/api/auth/login', { body: { username: s.username, password: 'password123' } })).status, 403);
  await t.call(`/api/finance/users/${s.user.id}/unsuspend`, { token: finance, body: { reason: 'Cleared' } });
  assert.equal((await t.call('/api/me', { token: s.token })).status, 200);
});
