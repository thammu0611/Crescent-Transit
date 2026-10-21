import { useState } from 'react';

import {
  Badge, Button, DataList, Empty, ErrorText, ItemCard, MonthPicker, PageHead, Panel, Row, Screen, Stat, StatGrid,
  Text, TextField, Txt,
} from '../../components/ui.js';
import { api, apiText, download, pickTextFile } from '../../lib/api.js';
import { dateTime, thisMonth } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G } from '../../theme.js';

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
  const { refreshing, onRefresh } = useRefresh(audit);
  const mock = health.data?.paymentGateway === 'mock';

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="shield" colors={G.emerald} eyebrow="Finance office" title="Reconciliation" subtitle="Compare the gateway's settlement report with the system's payments, line by line." />
      <Panel title="1. The gateway's settlement report" icon="download">
        <MonthPicker value={month} onChange={(m) => { setMonth(m); setResult(null); }} />
        <Txt muted small>
          {mock
            ? "Test mode: load the built-in gateway's own ledger for this month, or paste a report."
            : 'Download the settlement recon report for this month from the Razorpay dashboard, then choose or paste it here.'}
        </Txt>
        <Row wrap>
          {mock && <Button small variant="ghost" title="Load test gateway report" onPress={() => a.run(async () => setCsv(await apiText(`/api/finance/gateway-settlement?month=${month}`, token)))} />}
          {mock && <Button small variant="ghost" title="Download it" onPress={() => download(`/api/finance/gateway-settlement?month=${month}`, token, `gateway-settlement-${month}.csv`).catch((e) => a.setError(e.message))} />}
          <Button small variant="ghost" title="Choose CSV file" onPress={() => pickTextFile().then((t) => t != null && setCsv(t)).catch((e) => a.setError(e.message))} />
        </Row>
        <TextField
          value={csv}
          onChangeText={setCsv}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="entity_id,type,payment_id,order_id,amount,fee,tax,method,created_at"
          accessibilityLabel="Settlement CSV"
          style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 150 }}
        />
        <Button title="2. Compare with our payments" disabled={!csv.trim()} busy={a.busy} onPress={() => a.run(() => api('/api/finance/reconcile', { token, body: { month, csv } })).then((r) => r && setResult(r))} />
        <ErrorText>{a.error}</ErrorText>
      </Panel>
      {result && (
        <Panel title={`Result for ${result.month}`} icon="shield">
          <StatGrid>
            <Stat label="Gateway rows" value={result.gatewayRows} />
            <Stat label="Our rows" value={result.systemRows} />
            <Stat label="Matched" value={result.matched} tone="live" />
            <Stat label="Exceptions" value={result.exceptions.length} tone={result.exceptions.length ? 'danger' : 'live'} />
          </StatGrid>
          {result.exceptions.length === 0 ? <Empty>Every line matches. The collection for this month reconciles.</Empty> : (
            <DataList
              rows={result.exceptions}
              keyOf={(r, i) => i}
              render={(r) => (
                <ItemCard title={r.gatewayPaymentId ?? r.receiptNo ?? '—'} subtitle={r.receiptNo ? `Receipt ${r.receiptNo}` : undefined} right={<Badge tone="danger">{r.type.replaceAll('_', ' ')}</Badge>}>
                  <Txt small>{r.detail}</Txt>
                </ItemCard>
              )}
            />
          )}
        </Panel>
      )}
      <Panel title="Payment audit log" icon="list">
        <DataList
          rows={audit.data?.slice(0, 40)}
          render={(r) => (
            <ItemCard
              title={<Text style={{ ...F[700], color: r.action.startsWith('SECURITY') ? C.danger : C.ink }}>{r.action}</Text>}
              subtitle={`${dateTime(r.created_at)} · ${r.actor ?? (r.ip ? `gateway ${r.ip}` : 'system')}`}
            />
          )}
        />
      </Panel>
    </Screen>
  );
}
