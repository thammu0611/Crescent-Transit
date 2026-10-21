// Payment gateways behind one interface:
//
//   createOrder({ amountPaise, receipt, notes }) -> { id, amount }
//   fetchOrderPayments(orderId)                  -> [{ id, order_id, amount, method, status }]
//   refund(paymentId, amountPaise, notes)        -> { id }
//
// RazorpayGateway talks to the real Razorpay API (test keys first, doc Phase 8).
// MockGateway is a self-contained stand-in with the same contract: its hosted
// checkout is a page in this app, it keeps its own ledger, and it notifies the
// server through the same HMAC-signed webhook, so the payment path under test
// is the one that will run in production.
import crypto from 'node:crypto';

/** HMAC-SHA256 of the raw body, hex, exactly as Razorpay signs webhooks. */
export const signWebhook = (rawBody, secret) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

/** Constant-time signature check. */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature) || !rawBody) return false;
  const expected = Buffer.from(signWebhook(rawBody, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const METHODS = { upi: 'UPI', card: 'CARD', netbanking: 'NETBANKING', wallet: 'WALLET' };
export const normaliseMethod = (m) => METHODS[String(m ?? '').toLowerCase()] ?? (m ? String(m).toUpperCase().slice(0, 20) : null);

const randomId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

export class RazorpayGateway {
  constructor(options) {
    this.mode = 'razorpay';
    this.keyId = options.keyId;
    this.auth = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`;
    this.base = 'https://api.razorpay.com/v1';
  }

  async call(path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: this.auth, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Razorpay ${path}: ${res.status} ${data?.error?.description ?? ''}`);
    return data;
  }

  createOrder({ amountPaise, receipt, notes }) {
    return this.call('/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
  }

  async fetchOrderPayments(orderId) {
    const data = await this.call(`/orders/${encodeURIComponent(orderId)}/payments`);
    return data.items ?? [];
  }

  refund(paymentId, amountPaise, notes) {
    return this.call(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, notes });
  }
}

export class MockGateway {
  constructor(db, options) {
    this.mode = 'mock';
    this.db = db;
    this.keyId = options.keyId;
    this.webhookSecret = options.webhookSecret;
    this.webhookUrl = null; // set once the HTTP server is listening
  }

  async createOrder({ amountPaise, receipt }) {
    const id = randomId('order_mock');
    await this.db.query('INSERT INTO mock_gateway_orders (id, amount_paise, receipt) VALUES ($1, $2, $3)', [id, amountPaise, receipt]);
    return { id, amount: amountPaise, currency: 'INR', receipt, status: 'created' };
  }

  async getOrder(orderId) {
    const { rows } = await this.db.query('SELECT * FROM mock_gateway_orders WHERE id = $1', [orderId]);
    return rows[0] ?? null;
  }

  async fetchOrderPayments(orderId) {
    const { rows } = await this.db.query(
      'SELECT id, order_id, amount_paise, method, status FROM mock_gateway_payments WHERE order_id = $1 ORDER BY created_at',
      [orderId],
    );
    return rows.map((p) => ({ id: p.id, order_id: p.order_id, amount: p.amount_paise, method: p.method, status: p.status }));
  }

  async refund(paymentId, amountPaise) {
    const refundId = randomId('rfnd_mock');
    const { rows } = await this.db.query(
      `UPDATE mock_gateway_payments SET status = 'refunded', refund_id = $2, refunded_at = now()
        WHERE id = $1 AND status = 'captured' AND amount_paise = $3 RETURNING id`,
      [paymentId, refundId, amountPaise],
    );
    if (!rows[0]) throw new Error('Gateway: payment not refundable');
    return { id: refundId, payment_id: paymentId, amount: amountPaise, status: 'processed' };
  }

  /**
   * The student completes the hosted checkout. `outcome` is 'success' or 'failure';
   * `webhook` can be 'deliver' (default), 'drop' (the webhook never arrives,
   * for the reconciliation job) or 'twice' (a duplicated delivery).
   */
  async pay(orderId, { method = 'upi', outcome = 'success', webhook = 'deliver' } = {}) {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error('Unknown order');
    if (order.status === 'paid') throw new Error('Order already paid');
    const id = randomId('pay_mock');
    const status = outcome === 'success' ? 'captured' : 'failed';
    await this.db.query(
      'INSERT INTO mock_gateway_payments (id, order_id, amount_paise, method, status) VALUES ($1, $2, $3, $4, $5)',
      [id, orderId, order.amount_paise, method, status],
    );
    await this.db.query('UPDATE mock_gateway_orders SET status = $2 WHERE id = $1', [orderId, status === 'captured' ? 'paid' : 'attempted']);

    const payment = { id, entity: 'payment', amount: order.amount_paise, currency: 'INR', status, order_id: orderId, method };
    const event = {
      entity: 'event',
      event: status === 'captured' ? 'payment.captured' : 'payment.failed',
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: status === 'failed' ? { ...payment, error_description: 'Payment declined by the bank' } : payment } },
    };
    const deliveries = [];
    if (webhook !== 'drop') deliveries.push(await this.deliver(event));
    if (webhook === 'twice') deliveries.push(await this.deliver(event));
    return { paymentId: id, status, deliveries };
  }

  /** POST a signed event to the server's webhook, exactly as the real gateway would. */
  async deliver(event) {
    if (!this.webhookUrl) return { delivered: false, reason: 'no webhook url' };
    const raw = JSON.stringify(event);
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(raw, this.webhookSecret) },
      body: raw,
    });
    return { delivered: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }

  /**
   * The gateway's settlement report for a month, in the column layout of a
   * Razorpay settlement recon export. Amounts in rupees, fee = 2% + 18% GST.
   */
  async settlementReport(fromIso, toIso) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.order_id, p.amount_paise, p.method, p.status, p.refund_id, p.created_at, p.refunded_at
         FROM mock_gateway_payments p
        WHERE p.status IN ('captured', 'refunded') AND p.created_at >= $1 AND p.created_at < $2
        ORDER BY p.created_at`,
      [fromIso, toIso],
    );
    const out = [];
    for (const p of rows) {
      const fee = Math.round(p.amount_paise * 0.02);
      const tax = Math.round(fee * 0.18);
      out.push({
        entity_id: p.id, type: 'payment', payment_id: p.id, order_id: p.order_id,
        amount: (p.amount_paise / 100).toFixed(2), fee: ((fee + tax) / 100).toFixed(2), tax: (tax / 100).toFixed(2),
        method: p.method, created_at: p.created_at.toISOString(),
      });
      if (p.status === 'refunded') {
        out.push({
          entity_id: p.refund_id, type: 'refund', payment_id: p.id, order_id: p.order_id,
          amount: (p.amount_paise / 100).toFixed(2), fee: '0.00', tax: '0.00',
          method: p.method, created_at: p.refunded_at.toISOString(),
        });
      }
    }
    return out;
  }
}

export function createGateway(db, paymentConfig) {
  if (paymentConfig.mode === 'razorpay') return new RazorpayGateway(paymentConfig);
  return new MockGateway(db, paymentConfig);
}
