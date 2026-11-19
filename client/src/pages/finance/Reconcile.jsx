import { useRef, useState } from 'react';
import { api, download } from '../../lib/api.js';
import { dateTime, thisMonth, words } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { ErrorText, Page } from '../../components/ui.jsx';

const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
// How many payment lines a settlement report holds (its first line names the columns).
const reportRows = (csv) => Math.max(0, csv.trim().split(/\r?\n/).filter((l) => l.trim()).length - 1);

// What each kind of difference means, in words the office can act on.
const EXCEPTION = {
  MISSING_IN_SYSTEM: ['Missing in our records', 'The gateway settled a payment we never recorded.'],
  MISSING_AT_GATEWAY: ['Missing at the gateway', 'We recorded a payment the gateway did not settle.'],
  AMOUNT_MISMATCH: ['Amount differs', 'The two sides disagree on how much was paid.'],
  REFUND_MISMATCH: ['Refund differs', 'One side shows a refund the other does not.'],
};

// The audit log's icon and colour by what happened.
const auditLook = (action) => (action.startsWith('SECURITY') ? ['alert', 'danger']
  : action.includes('REFUND') ? ['swap', 'delayed']
    : action.includes('CAPTURED') || action.includes('REINSTATED') ? ['check', 'live']
      : action.includes('SUSPENDED') ? ['lock', 'danger']
        : ['clock', 'offline']);

function Step({ n, title, done, active, children }) {
  return (
    <section className={`panel rec-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}>
      <header className="rec-step-head">
        <span className="rec-step-n">{done ? <Icon name="check" size={15} /> : n}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

/**
 * Month-end reconciliation (doc 8.5): the gateway's settlement report against
 * the system's own payments table, line by line. Every difference is an
 * exception to investigate - the control that makes the collection auditable.
 */
export default function Reconcile() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState(null); // where the report came from, for the summary line
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const file = useRef(null);
  const health = useAsync(() => api('/api/health'), []);
  const audit = useAsync(() => api('/api/finance/audit', { token }), [token]);
  const a = useAction();
  const mock = health.data?.paymentGateway === 'mock';
  const loaded = csv.trim().length > 0;

  const chooseMonth = (m) => { if (m) { setMonth(m); setResult(null); } };
  const take = (text, from) => { setCsv(text); setSource(from); setResult(null); a.setError(null); };
  const readFile = (f) => f && f.text().then((t) => take(t, f.name));
  const loadMockReport = async () => {
    const res = await fetch(`/api/finance/gateway-settlement?month=${month}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    take(await res.text(), 'Test gateway report');
  };
  const compare = () => a.run(() => api('/api/finance/reconcile', { token, body: { month, csv } })).then((r) => { if (r) { setResult(r); audit.reload(); } });

  const events = audit.data ?? null;
  const shownEvents = showAll ? events : events?.slice(0, 8);

  return (
    <Page
      eyebrow="Finance office"
      title="Reconciliation"
      subtitle="Check the payment gateway's settlement report against our own payments, line by line."
      wide
      actions={(
        <label className="rec-month">
          <input type="month" value={month} onChange={(e) => chooseMonth(e.target.value)} aria-label="Month" />
        </label>
      )}
    >
      <div className="rec-layout">
        <div className="rec-main">
          <Step n={1} title={`Get the gateway's report for ${monthName(month)}`} done={loaded} active={!loaded}>
            <p className="muted rec-lead">
              {mock
                ? 'Test mode: use the built-in gateway\'s own ledger, or upload a report.'
                : 'Download the settlement report for this month from the Razorpay dashboard, then upload it here.'}
            </p>
            <div className={`rec-sources${mock ? '' : ' one'}`}>
              {mock && (
                <button type="button" className="rec-source" disabled={a.busy} onClick={() => a.run(loadMockReport)}>
                  <span className="rec-source-icon"><Icon name="download" size={20} /></span>
                  <span><b>Use the test gateway's report</b><small>Loads this month's ledger from the built-in gateway</small></span>
                </button>
              )}
              <label
                className={`rec-source rec-drop${dragging ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
              >
                <span className="rec-source-icon"><Icon name="upload" size={20} /></span>
                <span><b>Upload the CSV file</b><small>Choose a file or drop it here</small></span>
                <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { readFile(e.target.files[0]); e.target.value = ''; }} />
              </label>
            </div>

            {loaded && (
              <div className="rec-loaded" role="status">
                <Icon name="check" size={16} />
                <span><b>{source ?? 'Pasted report'}</b><small>{reportRows(csv)} payment line{reportRows(csv) === 1 ? '' : 's'} ready to compare</small></span>
                <button type="button" className="link" onClick={() => { setCsv(''); setSource(null); setResult(null); }}>Clear</button>
              </div>
            )}

            <div className="rec-more">
              <button type="button" className="link" onClick={() => setPasting((v) => !v)}>
                <Icon name={pasting ? 'up' : 'down'} size={14} /> {pasting ? 'Hide the text box' : 'Or paste the report as text'}
              </button>
              {mock && <button type="button" className="link" onClick={() => download(`/api/finance/gateway-settlement?month=${month}`, token, `gateway-settlement-${month}.csv`).catch((e) => a.setError(e.message))}>Download the test report</button>}
            </div>
            {pasting && (
              <textarea
                className="full mono rec-paste"
                rows={6}
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setSource(e.target.value.trim() ? 'Pasted report' : null); setResult(null); }}
                placeholder="entity_id,type,payment_id,order_id,amount,fee,tax,method,created_at"
                aria-label="Settlement CSV"
              />
            )}
          </Step>

          <Step n={2} title="Compare with our payments" done={Boolean(result)} active={loaded && !result}>
            <p className="muted rec-lead">Every line is matched by payment ID: amount, refunds, and lines found on only one side.</p>
            <button type="button" className="btn primary rec-compare" disabled={!loaded || a.busy} onClick={compare}>
              <Icon name="shield" size={17} /> {a.busy ? 'Comparing…' : `Compare ${monthName(month)}`}
            </button>
            <ErrorText>{a.error}</ErrorText>
          </Step>

          {result && (
            <Step n={3} title="Review the result" done={!result.exceptions.length} active={result.exceptions.length > 0}>
              <div className={`rec-verdict ${result.exceptions.length ? 'bad' : 'good'}`} role="status">
                <span className="rec-verdict-icon"><Icon name={result.exceptions.length ? 'alert' : 'check'} size={22} /></span>
                <span>
                  <b>{result.exceptions.length ? `${result.exceptions.length} difference${result.exceptions.length === 1 ? '' : 's'} to look into` : `${monthName(result.month)} reconciles`}</b>
                  <small>{result.exceptions.length ? 'Each line below is on one side only, or disagrees between the two.' : 'Every line matches between the gateway and our records.'}</small>
                </span>
              </div>
              <div className="rec-figures">
                <span><b className="tabular">{result.gatewayRows}</b><small>Gateway lines</small></span>
                <span><b className="tabular">{result.systemRows}</b><small>Our payments</small></span>
                <span className="good"><b className="tabular">{result.matched}</b><small>Matched</small></span>
                <span className={result.exceptions.length ? 'bad' : ''}><b className="tabular">{result.exceptions.length}</b><small>Differences</small></span>
              </div>
              {result.exceptions.length > 0 && (
                <ul className="rec-exceptions">
                  {result.exceptions.map((x, i) => {
                    const [name, meaning] = EXCEPTION[x.type] ?? [words(x.type), ''];
                    return (
                      <li key={i}>
                        <span className="rec-ex-icon"><Icon name="alert" size={16} /></span>
                        <span className="rec-ex-text">
                          <b>{name}</b>
                          <small>{meaning}{x.detail && !meaning ? x.detail : ''}</small>
                          <small className="mono">{[x.gatewayPaymentId && `Payment ${x.gatewayPaymentId}`, x.receiptNo && `Receipt ${x.receiptNo}`, x.type === 'AMOUNT_MISMATCH' || x.type === 'REFUND_MISMATCH' ? x.detail : null].filter(Boolean).join(' · ')}</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Step>
          )}
        </div>

        <aside className="panel rec-audit">
          <header className="rec-step-head">
            <span className="rec-step-n plain"><Icon name="list" size={15} /></span>
            <h3>Payment audit log</h3>
          </header>
          <p className="muted rec-lead">Every payment, refund and account change, newest first.</p>
          {events == null ? <div className="skeleton-block short" /> : events.length === 0 ? <p className="muted">No payment events yet.</p> : (
            <ol className="rec-timeline">
              {shownEvents.map((e, i) => {
                const [icon, tone] = auditLook(e.action);
                return (
                  <li key={`${e.created_at}-${i}`} className={`tone-${tone}`}>
                    <span className="rec-dot"><Icon name={icon} size={13} /></span>
                    <span className="rec-ev">
                      <b>{words(e.action)}</b>
                      <small>{dateTime(e.created_at)} · {e.actor ?? (e.ip ? 'payment gateway' : 'system')}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {events && events.length > 8 && (
            <button type="button" className="btn ghost small rec-show" onClick={() => setShowAll((v) => !v)}>
              <Icon name={showAll ? 'up' : 'down'} size={14} /> {showAll ? 'Show fewer' : `Show all ${events.length}`}
            </button>
          )}
        </aside>
      </div>
    </Page>
  );
}
