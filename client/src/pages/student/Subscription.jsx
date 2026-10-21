import { useState } from 'react';
import { api, download } from '../../lib/api.js';
import { date, dateTime, rupees } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import Checkout from '../../components/Checkout.jsx';
import { Badge, ErrorText, Notice, Page, Panel, Table } from '../../components/ui.jsx';

const PAY_TONE = { CAPTURED: 'live', CREATED: 'delayed', FAILED: 'danger', REFUNDED: 'offline', AUTHORISED: 'delayed' };

/** Pay the ₹60, see validity, payment history and receipts (doc 4.3, 8.1-8.3). */
export default function Subscription() {
  const { token, refresh } = useSession();
  const sub = useAsync(() => api('/api/subscriptions/me', { token }), [token]);
  const payments = useAsync(() => api('/api/payments/me', { token }), [token]);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [waiting, setWaiting] = useState(false);

  const buy = async (planCode) => {
    setError(null);
    setMessage(null);
    try {
      // One key per purchase attempt: a retried request returns the same order.
      const key = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setOrder(await api('/api/subscriptions/order', { token, body: { planCode }, headers: { 'idempotency-key': key } }));
    } catch (err) {
      setError(err.message);
    }
  };

  /** After checkout, ask the server - which believes only the gateway's webhook. */
  const afterCheckout = async (outcome) => {
    setOrder(null);
    setWaiting(true);
    let active = false;
    for (let i = 0; i < 5 && !active; i++) {
      const s = await api('/api/subscriptions/me', { token }).catch(() => null);
      active = Boolean(s?.entitlement?.active && s.entitlement.paidUntil !== sub.data?.entitlement?.paidUntil);
      if (!active) await new Promise((r) => setTimeout(r, 1200));
    }
    setWaiting(false);
    await Promise.all([sub.reload(), payments.reload(), refresh()]);
    if (outcome === 'failure') setError('The payment was declined. No money was taken; you can try again.');
    else if (active) setMessage('Payment confirmed by the gateway. Your receipt is below.');
    else setMessage('Payment received by the gateway; confirmation is on its way. If access does not appear within 15 minutes, the reconciliation job will complete it automatically.');
  };

  const e = sub.data?.entitlement;
  return (
    <Page eyebrow="Student" title="Subscription" subtitle="₹60 a month buys live tracking, arrival estimates, alerts, automatic attendance and receipts.">
      <div className="cols">
        <div className="col">
          <Panel title="Your access" icon="shield" actions={e && <Badge tone={e.active ? (e.inGrace ? 'delayed' : 'live') : 'offline'}>{e.active ? (e.inGrace ? 'Grace period' : 'Active') : 'Free view'}</Badge>}>
            {e?.active ? (
              <p>
                {e.planName}: valid {date(e.validFrom)} – {date(e.validTo)}
                {e.paidUntil !== e.validTo && <> · renewed until <b>{date(e.paidUntil)}</b></>}
                {e.inGrace && <><br /><b>Expired.</b> Access continues until {date(e.graceEndsOn)} while you renew.</>}
              </p>
            ) : (
              <p className="muted">
                No active subscription{e?.lastStatus ? ` (last: ${e.lastStatus.toLowerCase()}${e.lastValidTo ? `, until ${date(e.lastValidTo)}` : ''})` : ''}.
                Routes, stops, timetable, notices and SOS stay free.
              </p>
            )}
            <p className="fine-print">
              Not the bus fare: the ₹60 is an app-access subscription only. The transport fee is collected separately, as today.
            </p>
          </Panel>

          <Panel title="Plans" icon="card">
            <ul className="plans">
              {(sub.data?.plans ?? []).map((p) => (
                <li key={p.plan_code}>
                  <div>
                    <b>{p.display_name}</b>
                    <small>{p.duration_days} days of access{e?.active ? ' · added after your current period' : ''}</small>
                  </div>
                  <button className="btn primary inline" disabled={waiting} onClick={() => buy(p.plan_code)}>Pay {rupees(p.amount_paise)}</button>
                </li>
              ))}
            </ul>
            <p className="fine-print">
              Pay by UPI, card or netbanking on the gateway's own page - no card or UPI detail ever reaches the university's servers.
              Full refund within {sub.data?.refundWindowDays ?? 7} days through the transport office. {sub.data?.graceDays ?? 5}-day grace period after expiry.
            </p>
            {waiting && <Notice>Waiting for the gateway's confirmation…</Notice>}
            <Notice>{message}</Notice>
            <ErrorText>{error}</ErrorText>
          </Panel>
        </div>
        <div className="col">
          <Panel title="Payment history" icon="list">
            <Table
              rows={payments.data}
              rowKey={(r) => r.payment_id}
              empty="No payments yet."
              columns={[
                { key: 'created_at', label: 'Date', render: (r) => dateTime(r.paid_at ?? r.created_at) },
                { key: 'plan_name', label: 'Plan' },
                { key: 'amount_paise', label: 'Amount', align: 'right', render: (r) => rupees(r.amount_paise) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={PAY_TONE[r.status]}>{r.status}</Badge> },
                {
                  key: 'receipt', label: 'Receipt',
                  render: (r) => (r.receipt_no ? (
                    <button className="link" onClick={() => download(`/api/payments/${r.payment_id}/receipt`, token, `${r.receipt_no}.pdf`).catch((err) => setError(err.message))}>
                      {r.receipt_no}
                    </button>
                  ) : r.failure_reason ?? '—'),
                },
              ]}
            />
          </Panel>
        </div>
      </div>
      {order && <Checkout order={order} onClose={() => setOrder(null)} onDone={afterCheckout} />}
    </Page>
  );
}
