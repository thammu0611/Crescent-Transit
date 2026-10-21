import { useState } from 'react';
import { View } from 'react-native';
import {
  Badge, Button, DataList, ErrorText, ItemCard, KV, LinkButton, MonthPicker, Notice, PageHead, Panel, Row, Screen,
  Select, Sheet, TextField, Txt,
} from '../../components/ui.js';
import { api, download } from '../../lib/api.js';
import { dateTime, rupees, thisMonth } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';

const TONE = { CAPTURED: 'live', CREATED: 'delayed', FAILED: 'danger', REFUNDED: 'offline' };

function RefundDialog({ token, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <Sheet title={`Refund ${payment.receipt_no}`} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <Txt muted small>
          {payment.full_name} ({payment.username}) · {rupees(payment.amount_paise)} · paid {dateTime(payment.paid_at)}.
          A full refund is sent through the gateway and the subscription is revoked from today.
        </Txt>
        <TextField label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} />
        <ErrorText>{a.error}</ErrorText>
        <Button
          title={`Refund ${rupees(payment.amount_paise)}`}
          variant="danger"
          disabled={reason.trim().length < 5}
          busy={a.busy}
          onPress={() => a.run(() => api(`/api/finance/payments/${payment.payment_id}/refund`, { token, body: { reason } })).then((r) => r && onDone())}
        />
      </View>
    </Sheet>
  );
}

export default function Payments() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [refunding, setRefunding] = useState(null);
  const list = useAsync(() => api(`/api/finance/payments?month=${month}${status ? `&status=${status}` : ''}`, { token }), [month, status, token]);
  const a = useAction();
  const { refreshing, onRefresh } = useRefresh(list);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="card" colors={G.indigo} eyebrow="Finance office" title="Payments" subtitle="Every payment attempt with its gateway identifiers and how it was confirmed." />
      <Panel>
        <MonthPicker value={month} onChange={setMonth} />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: '', label: 'All statuses' }, { value: 'CAPTURED', label: 'Captured' }, { value: 'CREATED', label: 'Pending' }, { value: 'FAILED', label: 'Failed' }, { value: 'REFUNDED', label: 'Refunded' }]}
        />
        <Button
          small
          variant="ghost"
          title="Check pending orders"
          busy={a.busy}
          onPress={() => a.run(() => api('/api/finance/reconcile-pending', { token, method: 'POST' }), (r) => `Checked ${r.checked} pending orders with the gateway; repaired ${r.repaired?.length ?? 0}.`).then(list.reload)}
        />
      </Panel>
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      <Panel title="All payments this month" icon="card">
        <DataList
          rows={list.data}
          keyOf={(r) => r.payment_id}
          render={(r) => (
            <ItemCard title={`${r.full_name} · ${rupees(r.amount_paise)}`} subtitle={`${r.username} · ${r.department ?? '—'}`} right={<Badge tone={TONE[r.status]}>{r.status}</Badge>}>
              <KV k="Created" v={dateTime(r.created_at)} />
              <KV k="Plan" v={r.plan_code} />
              <KV k="Method" v={r.method ?? '—'} />
              {r.failure_reason ? <KV k="Reason" v={r.failure_reason} /> : null}
              <KV k="Confirmed by" v={r.confirmed_by ? `${r.confirmed_by}${r.signature_verified ? ' ✓ signed' : ''}` : '—'} />
              <KV k="Gateway ID" v={r.gateway_payment_id ?? r.gateway_order_id} />
              <Row gap={16}>
                {r.receipt_no ? <LinkButton icon="download" title="Receipt" onPress={() => download(`/api/payments/${r.payment_id}/receipt`, token, `${r.receipt_no}.pdf`).catch((e) => a.setError(e.message))} /> : null}
                {r.refundable ? <LinkButton danger title="Refund" onPress={() => setRefunding(r)} /> : null}
              </Row>
            </ItemCard>
          )}
        />
      </Panel>
      {refunding && <RefundDialog token={token} payment={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); list.reload(); a.setMessage('Refunded. The student is back on the free view.'); }} />}
    </Screen>
  );
}
