import { useState } from 'react';
import { api, download } from '../../lib/api.js';
import { dateTime, rupees, thisMonth } from '../../lib/format.js';
import { greeting, longDate } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { ErrorText, Stat } from '../../components/ui.jsx';

const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/** A ranked bar list: route, department or method by money collected. */
function Breakdown({ title, icon, rows, label = (r) => r.key }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.grossPaise));
  return (
    <section className="soft-card">
      <div className="soft-card-head"><h3><Icon name={icon} size={17} /> {title}</h3></div>
      {rows == null ? <div className="skeleton-block short" /> : rows.length === 0 ? <p className="muted">No payments in this month.</p> : (
        <ul className="money-bars">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}>
              <span className="mb-label"><span className="mb-name">{label(r)}</span><small>{r.payments} payment{r.payments === 1 ? '' : 's'}</small></span>
              <span className="mb-bar"><i style={{ width: `${(r.grossPaise / max) * 100}%` }} /></span>
              <b className="tabular">{rupees(r.grossPaise)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The finance office's home: the month's collection, break-even, and where money came from (doc 4.4, 8.9). */
export default function Collections() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [error, setError] = useState(null);
  const { data: c, error: loadError } = useAsync(() => api(`/api/finance/collections?month=${month}`, { token }), [month, token]);
  const recent = useAsync(() => api(`/api/finance/payments?month=${month}`, { token }), [month, token]);
  const pct = c ? Math.min(100, Math.round((c.subscribersInMonth / c.breakEvenSubscribers) * 100)) : 0;
  const statement = () => download(`/api/finance/statement?month=${month}&format=csv`, token, `collection-statement-${month}.csv`).catch((e) => setError(e.message));

  return (
    <main className="page app-page wide-app">
      <header className="app-greet">
        <div>
          <span className="greet-sub">{greeting()},</span>
          <h1>Finance office</h1>
          <span className="greet-meta"><Icon name="clock" size={14} /> {longDate()}</span>
        </div>
        <a className="bell" href="#/payments" aria-label="Payments"><Icon name="card" size={20} /></a>
      </header>
      <ErrorText>{loadError?.message ?? error}</ErrorText>

      <div className="app-grid">
        <div className="app-col">
          <section className="route-card money-card">
            <div className="money-top">
              <span className="route-card-label">Net collection</span>
              <label className="route-pill light">
                <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              </label>
            </div>
            <div className="money-big">
              <b className="tabular">{c ? rupees(c.netCollectionPaise) : '—'}</b>
              <span>{monthName(month)} · after refunds and gateway fees</span>
            </div>
            <ul className="runs">
              <li><span>Gross collected · {c?.payments ?? '—'} payment{c?.payments === 1 ? '' : 's'}</span><b className="tabular">{c ? rupees(c.grossPaise) : '—'}</b></li>
              <li><span>Gateway fees (2% + 18% GST, est.)</span><b className="tabular">{c ? `− ${rupees(c.gatewayFeesPaise)}` : '—'}</b></li>
              <li><span>Refunds · {c?.refundCount ?? '—'}</span><b className="tabular">{c ? `− ${rupees(c.refundsPaise)}` : '—'}</b></li>
            </ul>
            <div className="route-live">
              <Icon name="chart" size={15} />
              <span>After {c ? rupees(c.runningCostPaise) : '…'} monthly running cost: <b>{c ? rupees(c.netAfterCostsPaise) : '—'}</b></span>
            </div>
          </section>

          <div className="action-row">
            <a className="btn indigo" href="#/reconcile"><Icon name="shield" size={17} /> Reconcile month</a>
            <button className="btn dark" onClick={statement}><Icon name="download" size={17} /> Statement CSV</button>
          </div>

          <section className="soft-card">
            <div className="soft-card-head">
              <h3><Icon name="users" size={17} /> Break-even</h3>
              <span className="pill-note">{c ? `${c.adoptionPct}% adoption` : ''}</span>
            </div>
            <div className="be-figures">
              <b className="tabular">{c?.subscribersInMonth ?? '—'}</b>
              <span>
                <span>of <b>{c?.breakEvenSubscribers ?? '—'}</b> subscribers needed to cover the running cost</span>
                <small>₹12,700 ÷ ₹58.58 per subscriber after fees (doc 8.9)</small>
              </span>
            </div>
            <div className="be-track"><i style={{ width: `${pct}%` }} /></div>
            <div className="be-scale"><span>0</span><span>{pct}%</span><span>{c?.breakEvenSubscribers ?? ''}</span></div>
          </section>

          <section className="soft-card">
            <div className="soft-card-head">
              <h3><Icon name="card" size={17} /> Recent payments</h3>
              <a href="#/payments">See all</a>
            </div>
            {recent.data == null ? <div className="skeleton-block short" /> : recent.data.length === 0 ? <p className="muted">No payments this month.</p> : (
              <ul className="feed">
                {recent.data.slice(0, 5).map((p, i) => (
                  <li key={p.payment_id} className={i === 0 && p.status === 'CAPTURED' ? 'hot' : p.status === 'FAILED' || p.status === 'REFUNDED' ? 'warn' : ''}>
                    <span className="feed-icon"><Icon name={p.status === 'CAPTURED' ? 'check' : p.status === 'REFUNDED' ? 'swap' : 'clock'} size={15} /></span>
                    <span>
                      <b>{p.full_name} · {rupees(p.amount_paise)}</b>
                      <small>{p.plan_code} · {p.method ?? 'pending'} · {p.status.toLowerCase()}{p.receipt_no ? ` · ${p.receipt_no}` : ''}</small>
                      <time>{dateTime(p.paid_at ?? p.created_at)}</time>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="app-col">
          <div className="kpi-grid">
            <Stat icon="users" label="Subscribers this month" value={c?.subscribersInMonth} tone="live" />
            <Stat icon="signal" label="Adoption" value={c ? `${c.adoptionPct}%` : null} hint={c ? `of ${c.studentsCarried} students carried` : undefined} />
            <Stat icon="swap" label="Refunds" value={c ? c.refundCount : null} tone={c?.refundCount ? 'delayed' : ''} />
            <Stat icon="wallet" label="Registered students" value={c?.registeredStudents} />
          </div>
          <Breakdown title="By route" icon="route" rows={c?.byRoute} label={(r) => <><span className="route-code sm">{r.key}</span>{r.routeName ?? ''}</>} />
          <Breakdown title="By department" icon="users" rows={c?.byDepartment} />
          <Breakdown title="By payment method" icon="card" rows={c?.byMethod} />
        </div>
      </div>
    </main>
  );
}
