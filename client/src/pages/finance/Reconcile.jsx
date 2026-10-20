import { useState } from 'react';
import { api, download } from '../../lib/api.js';
import { dateTime, thisMonth } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { Badge, Empty, ErrorText, Page, Panel, Stat, Table } from '../../components/ui.jsx';

/**
 * Month-end reconciliation (doc 8.5): the gateway's settlement report against
 * the system's own payments table, line by line. Every difference is an
 * exception to investigate - the control that makes the collection auditable.
 */
export default function Reconcile() {
  const { token } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const health = useAsync(() => api('/api/health'), []);
  const audit = useAsync(() => api('/api/finance/audit', { token }), [token]);
  const a = useAction();
  const mock = health.data?.paymentGateway === 'mock';

  const loadMockReport = async () => {
    const res = await fetch(`/api/finance/gateway-settlement?month=${month}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    setCsv(await res.text());
  };

  return (
    <Page eyebrow="Finance office" title="Reconciliation" subtitle="Compare the gateway's settlement report with the system's payments, line by line." wide actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}>
      <div className="cols">
        <div className="col wide">
          <Panel title="1. The gateway's settlement report" icon="download">
            <p className="muted">
              {mock
                ? 'Test mode: load the built-in gateway\'s own ledger for this month, or paste a report.'
                : 'Download the settlement recon report for this month from the Razorpay dashboard, then upload or paste it here.'}
            </p>
            <div className="btn-row">
              {mock && <button className="btn ghost" onClick={() => a.run(loadMockReport)}>Load test gateway report</button>}
              {mock && <button className="btn ghost" onClick={() => download(`/api/finance/gateway-settlement?month=${month}`, token, `gateway-settlement-${month}.csv`).catch((e) => a.setError(e.message))}>Download it</button>}
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0]?.text().then(setCsv)} aria-label="Upload settlement CSV" />
            </div>
            <textarea className="full mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="entity_id,type,payment_id,order_id,amount,fee,tax,method,created_at" aria-label="Settlement CSV" />
            <button className="btn primary" disabled={!csv.trim() || a.busy} onClick={() => a.run(() => api('/api/finance/reconcile', { token, body: { month, csv } })).then((r) => r && setResult(r))}>2. Compare with our payments</button>
            <ErrorText>{a.error}</ErrorText>
          </Panel>
          {result && (
            <Panel title={`Result for ${result.month}`} icon="shield">
              <div className="stat-row">
                <Stat label="Gateway rows" value={result.gatewayRows} />
                <Stat label="Our rows" value={result.systemRows} />
                <Stat label="Matched" value={result.matched} tone="live" />
                <Stat label="Exceptions" value={result.exceptions.length} tone={result.exceptions.length ? 'danger' : 'live'} />
              </div>
              {result.exceptions.length === 0 ? <Empty>Every line matches. The collection for this month reconciles.</Empty> : (
                <Table
                  rows={result.exceptions}
                  rowKey={(r, i) => i}
                  columns={[
                    { key: 'type', label: 'Exception', render: (r) => <Badge tone="danger">{r.type.replaceAll('_', ' ')}</Badge> },
                    { key: 'gatewayPaymentId', label: 'Gateway payment' },
                    { key: 'receiptNo', label: 'Receipt' },
                    { key: 'detail', label: 'Detail' },
                  ]}
                />
              )}
            </Panel>
          )}
        </div>
        <div className="col">
          <Panel title="Payment audit log" icon="list">
            <Table
              rows={audit.data?.slice(0, 40)}
              columns={[
                { key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) },
                { key: 'action', label: 'Action', render: (r) => <span className={r.action.startsWith('SECURITY') ? 'error-text' : ''}>{r.action}</span> },
                { key: 'actor', label: 'By', render: (r) => r.actor ?? (r.ip ? `gateway ${r.ip}` : 'system') },
              ]}
            />
          </Panel>
        </div>
      </div>
    </Page>
  );
}
