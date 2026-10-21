import { useState } from 'react';
import { api } from '../lib/api.js';
import { rupees } from '../lib/format.js';
import { ErrorText, Modal } from './ui.jsx';

/**
 * The payment step (doc 8.3 step 4). With Razorpay keys configured this opens
 * Razorpay's hosted checkout; otherwise the built-in test gateway's checkout.
 * Either way the page never decides that a payment succeeded: it waits for the
 * server, which only believes the gateway's signed webhook.
 */
export default function Checkout({ order, onClose, onDone }) {
  const [method, setMethod] = useState('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [webhook, setWebhook] = useState('deliver');

  const payMock = async (outcome) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/mock-gateway/orders/${order.orderId}/pay`, { body: { method, outcome, webhook } });
      onDone(outcome);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const payRazorpay = () => {
    const open = () => {
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: 'INR',
        name: order.merchant,
        description: order.planName,
        prefill: order.prefill,
        // The handler's success is a claim: the app re-reads the entitlement,
        // which the server sets only from the verified webhook.
        handler: () => onDone('success'),
        modal: { ondismiss: onClose },
      });
      rzp.on('payment.failed', () => onDone('failure'));
      rzp.open();
    };
    if (window.Razorpay) return open();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = open;
    s.onerror = () => setError('Could not load the Razorpay checkout. Check the connection and try again.');
    document.body.appendChild(s);
  };

  if (order.gateway === 'razorpay') {
    return (
      <Modal title="Pay with Razorpay" onClose={onClose}>
        <p className="muted">{order.planName} · {rupees(order.amountPaise)}</p>
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" onClick={payRazorpay}>Continue to Razorpay</button>
      </Modal>
    );
  }

  return (
    <Modal title="Test payment gateway" onClose={busy ? undefined : onClose}>
      <div className="checkout-head">
        <span>{order.merchant}</span>
        <strong className="tabular">{rupees(order.amountPaise)}</strong>
      </div>
      <p className="muted">
        {order.planName}. This is the built-in <b>test-mode</b> gateway: no money moves. It signs its
        notification to the server exactly as Razorpay does.
      </p>
      <div className="method-row" role="radiogroup" aria-label="Payment method">
        {[['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Netbanking']].map(([v, label]) => (
          <button key={v} role="radio" aria-checked={method === v} className={`chip-btn ${method === v ? 'on' : ''}`} onClick={() => setMethod(v)}>{label}</button>
        ))}
      </div>
      <details className="test-options">
        <summary>Failure testing</summary>
        <label className="field">
          <span>Webhook delivery</span>
          <select value={webhook} onChange={(e) => setWebhook(e.target.value)}>
            <option value="deliver">Deliver normally</option>
            <option value="twice">Deliver twice (duplicate)</option>
            <option value="drop">Never arrives (reconciliation repairs it)</option>
          </select>
        </label>
      </details>
      <ErrorText>{error}</ErrorText>
      <button className="btn primary" disabled={busy} onClick={() => payMock('success')}>{busy ? 'Processing…' : `Pay ${rupees(order.amountPaise)}`}</button>
      <button className="btn ghost wide" disabled={busy} onClick={() => payMock('failure')}>Simulate a declined payment</button>
    </Modal>
  );
}
