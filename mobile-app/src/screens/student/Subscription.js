import { useState } from 'react';
import { View } from 'react-native';
import Checkout from '../../components/Checkout.js';
import { Badge, Button, DataList, ErrorText, ItemCard, LinkButton, Notice, PageHead, Panel, Screen, Txt } from '../../components/ui.js';
import { api, download } from '../../lib/api.js';
import { date, dateTime, rupees } from '../../lib/format.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, G } from '../../theme.js';

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
  const { refreshing, onRefresh } = useRefresh(sub, payments);

  const buy = async (planCode) => {
    setError(null);
    setMessage(null);
    try {
      // One key per purchase attempt: a retried request returns the same order.
      const key = `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="card" colors={G.violet} eyebrow="Student" title="Subscription" subtitle="₹60 a month buys live tracking, arrival estimates, alerts, automatic attendance and receipts." />
      <ErrorText>{sub.error?.message}</ErrorText>
      <Panel title="Your access" icon="shield" actions={e && <Badge tone={e.active ? (e.inGrace ? 'delayed' : 'live') : 'offline'}>{e.active ? (e.inGrace ? 'Grace period' : 'Active') : 'Free view'}</Badge>}>
        {e?.active ? (
          <Txt>
            {e.planName}: valid {date(e.validFrom)} – {date(e.validTo)}
            {e.paidUntil !== e.validTo ? <> · renewed until <Txt bold>{date(e.paidUntil)}</Txt></> : null}
            {e.inGrace ? <>{'\n'}<Txt bold>Expired.</Txt> Access continues until {date(e.graceEndsOn)} while you renew.</> : null}
          </Txt>
        ) : (
          <Txt muted>
            No active subscription{e?.lastStatus ? ` (last: ${e.lastStatus.toLowerCase()}${e.lastValidTo ? `, until ${date(e.lastValidTo)}` : ''})` : ''}.
            Routes, stops, timetable, notices and SOS stay free.
          </Txt>
        )}
        <Txt muted small>Not the bus fare: the ₹60 is an app-access subscription only. The transport fee is collected separately, as today.</Txt>
      </Panel>

      <Panel title="Plans" icon="card">
        {(sub.data?.plans ?? []).map((p) => (
          <View key={p.plan_code} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: C.surface }}>
            <View style={{ flex: 1 }}>
              <Txt bold>{p.display_name}</Txt>
              <Txt muted small>{p.duration_days} days of access{e?.active ? ' · added after your current period' : ''}</Txt>
            </View>
            <Button small title={`Pay ${rupees(p.amount_paise)}`} disabled={waiting} onPress={() => buy(p.plan_code)} />
          </View>
        ))}
        <Txt muted small>
          Pay by UPI, card or netbanking on the gateway's own page - no card or UPI detail ever reaches the university's servers.
          Full refund within {sub.data?.refundWindowDays ?? 7} days through the transport office. {sub.data?.graceDays ?? 5}-day grace period after expiry.
        </Txt>
        {waiting && <Notice>Waiting for the gateway's confirmation…</Notice>}
        <Notice>{message}</Notice>
        <ErrorText>{error}</ErrorText>
      </Panel>

      <Panel title="Payment history" icon="list">
        <DataList
          rows={payments.data}
          keyOf={(r) => r.payment_id}
          empty="No payments yet."
          render={(r) => (
            <ItemCard
              title={`${r.plan_name} · ${rupees(r.amount_paise)}`}
              subtitle={dateTime(r.paid_at ?? r.created_at)}
              right={<Badge tone={PAY_TONE[r.status]}>{r.status}</Badge>}
            >
              {r.receipt_no ? (
                <LinkButton icon="download" title={`Receipt ${r.receipt_no}`} onPress={() => download(`/api/payments/${r.payment_id}/receipt`, token, `${r.receipt_no}.pdf`).catch((err) => setError(err.message))} />
              ) : r.failure_reason ? <Txt muted small>{r.failure_reason}</Txt> : null}
            </ItemCard>
          )}
        />
      </Panel>
      {order && <Checkout order={order} onClose={() => setOrder(null)} onDone={afterCheckout} />}
    </Screen>
  );
}
