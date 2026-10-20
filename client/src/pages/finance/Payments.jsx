import { useState } from 'react';
import { api, download } from '../../lib/api.js';
import { dateTime, rupees, thisMonth } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { Badge, ErrorText, Field, Modal, Notice, Page, Panel, Table } from '../../components/ui.jsx';

const TONE = { CAPTURED: 'live', CREATED: 'delayed', FAILED: 'danger', REFUNDED: 'offline' };

function RefundDialog({ token, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <Modal title={`Refund ${payment.receipt_no}`} onClose={onClose}>
      <p className="muted">
        {payment.full_name} ({payment.username}) · {rupees(payment.amount_paise)} · paid {dateTime(payment.paid_at)}.
        A full refund is sent through the gateway and the subscription is revoked from today.
      </p>
      <Field label="Reason (recorded in the audit log)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></Field>
      <ErrorText>{a.error}</ErrorText>
      <button className="btn danger" disabled={a.busy || reason.trim().length < 5} onClick={() => a.run(() => api(`/api/finance/payments/${payment.payment_id}/refund`, { token, body: { reason } })).then((r) => r && onDone())}>
        Refund {rupees(payment.amount_paise)}
      </button>
    </Modal>
  );
}

export default function Payments() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [refunding, setRefunding] = useState(null);
  const list = useAsync(() => api(`/api/finance/payments?month=${month}${status ? `&status=${status}` : ''}`, { token }), [month, status, token]);
  const a = useAction();

  return (
    <Page
      eyebrow="Finance office"
      title="Payments"
      subtitle="Every payment attempt with its gateway identifiers and how it was confirmed."
      wide
      actions={<>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="CAPTURED">Captured</option><option value="CREATED">Pending</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option>
        </select>
        <button className="btn ghost" onClick={() => a.run(() => api('/api/finance/reconcile-pending', { token, method: 'POST' }), (r) => `Checked ${r.checked} pending orders with the gateway; repaired ${r.repaired?.length ?? 0}.`).then(list.reload)}>Check pending orders</button>
      </>}
    >
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      <Panel title="All payments this month" icon="card">
        <Table
          rows={list.data}
          rowKey={(r) => r.payment_id}
          columns={[
            { key: 'created_at', label: 'Created', render: (r) => dateTime(r.created_at) },
            { key: 'student', label: 'Student', render: (r) => <>{r.full_name}<br /><small className="muted">{r.username} · {r.department ?? '—'}</small></> },
            { key: 'plan_code', label: 'Plan' },
            { key: 'amount_paise', label: 'Amount', align: 'right', render: (r) => rupees(r.amount_paise) },
            { key: 'method', label: 'Method', render: (r) => r.method ?? '—' },
            { key: 'status', label: 'Status', render: (r) => <><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.failure_reason && <><br /><small className="muted">{r.failure_reason}</small></>}</> },
            { key: 'confirmed_by', label: 'Confirmed by', render: (r) => (r.confirmed_by ? `${r.confirmed_by}${r.signature_verified ? ' ✓ signed' : ''}` : '—') },
            { key: 'gateway_payment_id', label: 'Gateway ID', render: (r) => <small className="mono">{r.gateway_payment_id ?? r.gateway_order_id}</small> },
            {
              key: 'x', label: '',
              render: (r) => (
                <span className="btn-row">
                  {r.receipt_no && <button className="link" onClick={() => download(`/api/payments/${r.payment_id}/receipt`, token, `${r.receipt_no}.pdf`).catch((e) => a.setError(e.message))}>Receipt</button>}
                  {r.refundable && <button className="link danger" onClick={() => setRefunding(r)}>Refund</button>}
                </span>
              ),
            },
          ]}
        />
      </Panel>
      {refunding && <RefundDialog token={token} payment={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); list.reload(); a.setMessage('Refunded. The student is back on the free view.'); }} />}
    </Page>
  );
}
