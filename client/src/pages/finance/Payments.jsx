import { useMemo, useState } from 'react';
import { api, download } from '../../lib/api.js';
import { PAY_STATUS, dateTime, rupees, thisMonth, words } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, Empty, ErrorText, Field, Modal, Notice, Page, SearchBox } from '../../components/ui.jsx';

const TONE = { CAPTURED: 'live', CREATED: 'delayed', FAILED: 'danger', REFUNDED: 'offline' };
// The four states, each a tile that also filters the list.
const STATES = [
  ['CAPTURED', 'Paid', 'check'],
  ['CREATED', 'Pending', 'clock'],
  ['FAILED', 'Failed', 'alert'],
  ['REFUNDED', 'Refunded', 'swap'],
];
const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
// A plan code as a name: MONTHLY_60 -> Monthly pass.
const planName = (code) => (code ? `${words(code).replace(/\s*\d+$/, '')} pass` : '—');
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function RefundDialog({ token, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  const send = (e) => {
    e.preventDefault();
    a.run(() => api(`/api/finance/payments/${payment.payment_id}/refund`, { token, body: { reason: reason.trim() } })).then((r) => r && onDone());
  };
  return (
    <Modal title={`Refund ${rupees(payment.amount_paise)} to ${payment.full_name}?`} onClose={onClose}>
      <p className="muted">
        Receipt {payment.receipt_no} · paid {dateTime(payment.paid_at)}. The full amount goes back through the payment gateway,
        and the bus pass stops working from today.
      </p>
      <form onSubmit={send}>
        <Field label="Reason (kept in the audit log)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus placeholder="e.g. Paid twice by mistake" /></Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="btn-row confirm-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={a.busy || reason.trim().length < 5}>Refund {rupees(payment.amount_paise)}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Everything about one payment, with its receipt and the refund action. */
function PaymentDetail({ payment: p, onClose, onReceipt, onRefund }) {
  const rows = [
    ['Student', `${p.full_name} · ${p.username}${p.register_no ? ` · ${p.register_no}` : ''}`],
    ['Department', p.department ?? '—'],
    ['Plan', planName(p.plan_code)],
    ['Amount', rupees(p.amount_paise)],
    ['Method', words(p.method)],
    ['Started', dateTime(p.created_at)],
    ['Paid', p.paid_at ? dateTime(p.paid_at) : '—'],
    ['Receipt', p.receipt_no ?? '—'],
    ['Confirmed by', p.confirmed_by ? `${words(p.confirmed_by)}${p.signature_verified ? ' · signature checked' : ''}` : '—'],
    ['Gateway payment', p.gateway_payment_id ?? '—'],
    ['Gateway order', p.gateway_order_id ?? '—'],
    ...(p.failure_reason ? [['Why it failed', p.failure_reason]] : []),
    ...(p.refunded_at ? [['Refunded', `${dateTime(p.refunded_at)}${p.refund_reason ? ` · ${p.refund_reason}` : ''}`]] : []),
  ];
  return (
    <Modal title={`${rupees(p.amount_paise)} · ${PAY_STATUS[p.status] ?? words(p.status)}`} onClose={onClose} width={520}>
      <dl className="pay-detail">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={/Gateway/.test(k) ? 'mono' : undefined}>{v}</dd></div>)}
      </dl>
      <div className="btn-row confirm-actions">
        {p.receipt_no && <button type="button" className="btn ghost" onClick={onReceipt}><Icon name="download" size={15} /> Receipt PDF</button>}
        {p.refundable && <button type="button" className="btn danger" onClick={onRefund}><Icon name="swap" size={15} /> Refund</button>}
      </div>
    </Modal>
  );
}

/** Every payment attempt in a month: totals by state, a searchable list, and each payment's details. */
export default function Payments() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [refunding, setRefunding] = useState(null);
  // All of the month's payments; the tiles and the search filter them here.
  const list = useAsync(() => api(`/api/finance/payments?month=${month}`, { token }), [month, token]);
  const a = useAction();
  const all = list.data ?? null;

  const totals = useMemo(() => Object.fromEntries(STATES.map(([s]) => {
    const rows = (all ?? []).filter((p) => p.status === s);
    return [s, { count: rows.length, paise: rows.reduce((n, p) => n + p.amount_paise, 0) }];
  })), [all]);
  const needle = q.trim().toLowerCase();
  const shown = all?.filter((p) => (!status || p.status === status)
    && (!needle || [p.full_name, p.username, p.register_no, p.receipt_no, p.department].some((v) => v && String(v).toLowerCase().includes(needle))));
  const receipt = (p) => download(`/api/payments/${p.payment_id}/receipt`, token, `${p.receipt_no}.pdf`).catch((e) => a.setError(e.message));

  return (
    <Page
      eyebrow="Finance office"
      title="Payments"
      subtitle="Every payment attempt in the month, how it was confirmed, its receipt and refunds."
      wide
      actions={(
        <>
          <label className="rec-month">
            <input type="month" value={month} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setStatus(''); } }} aria-label="Month" />
          </label>
          <button type="button" className="btn ghost" disabled={a.busy} onClick={() => a.run(() => api('/api/finance/reconcile-pending', { token, method: 'POST' }), (r) => `Checked ${r.checked} pending order${r.checked === 1 ? '' : 's'} with the gateway; ${r.repaired?.length ?? 0} fixed.`).then(list.reload)}>
            <Icon name="signal" size={15} /> Check pending orders
          </button>
        </>
      )}
    >
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>

      <div className="pay-tiles" role="tablist" aria-label="Payments by state">
        {STATES.map(([s, label, icon]) => {
          const on = status === s;
          return (
            <button key={s} type="button" role="tab" aria-selected={on} className={`pay-tile tone-${TONE[s]}${on ? ' on' : ''}`} onClick={() => setStatus(on ? '' : s)}>
              <span className="pay-tile-icon"><Icon name={icon} size={18} /></span>
              <span className="pay-tile-text">
                <small>{label}</small>
                <b className="tabular">{all ? totals[s].count : '—'}</b>
                <em className="tabular">{all ? rupees(totals[s].paise) : ''}</em>
              </span>
            </button>
          );
        })}
      </div>

      <section className="panel pay-list-card">
        <header className="pay-list-head">
          <h3>{status ? `${PAY_STATUS[status]} payments` : 'All payments'} · {monthName(month)}</h3>
          {status && <button type="button" className="link" onClick={() => setStatus('')}>Show all</button>}
        </header>
        <SearchBox value={q} onChange={setQ} placeholder="Search name, username, receipt or department" />
        {shown == null ? <div className="skeleton-block" /> : shown.length === 0 ? (
          <Empty>{needle || status ? 'No payments match.' : `No payments in ${monthName(month)}.`}</Empty>
        ) : (
          <ul className="pay-list">
            {shown.map((p) => (
              <li key={p.payment_id}>
                <button type="button" className="pay-row" onClick={() => setOpen(p)}>
                  <span className="pay-avatar" aria-hidden="true">{initials(p.full_name)}</span>
                  <span className="pay-who">
                    <b>{p.full_name}</b>
                    <small>{[p.username, p.department].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="pay-what">
                    <b>{planName(p.plan_code)}</b>
                    <small>{words(p.method ?? 'pending')} · {dateTime(p.paid_at ?? p.created_at)}</small>
                  </span>
                  <span className="pay-amount tabular">{rupees(p.amount_paise)}</span>
                  <Badge tone={TONE[p.status]}>{PAY_STATUS[p.status] ?? words(p.status)}</Badge>
                  <Icon name="arrow" size={15} className="kit-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && !refunding && (
        <PaymentDetail payment={open} onClose={() => setOpen(null)} onReceipt={() => receipt(open)} onRefund={() => setRefunding(open)} />
      )}
      {refunding && (
        <RefundDialog
          token={token}
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => { setRefunding(null); setOpen(null); list.reload(); a.setMessage('Refunded. The student is back on the free view.'); }}
        />
      )}
    </Page>
  );
}
