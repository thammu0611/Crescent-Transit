import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from '../../components/Icon.js';
import {
  Button, ErrorText, GradientCard, HeaderIconButton, MonthPicker, RouteCode, Row, Screen, Skeleton, Stat, StatGrid,
  Text, Txt,
} from '../../components/ui.js';
import { api, download } from '../../lib/api.js';
import { dateTime, monthName, rupees, thisMonth } from '../../lib/format.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G, shadow } from '../../theme.js';
import { Card, GreetHeader } from '../admin/Dashboard.js';

/** A ranked bar list: route, department or method by money collected. */
function Breakdown({ title, icon, rows, label = (r) => <Txt small>{r.key}</Txt> }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.grossPaise));
  return (
    <Card title={title} icon={icon}>
      {rows == null ? <Skeleton /> : rows.length === 0 ? <Txt muted>No payments in this month.</Txt> : rows.slice(0, 8).map((r) => (
        <View key={r.key} style={{ gap: 4 }}>
          <Row>
            <View style={{ flex: 1 }}>{label(r)}<Txt muted small>{r.payments} payment{r.payments === 1 ? '' : 's'}</Txt></View>
            <Txt bold>{rupees(r.grossPaise)}</Txt>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line2 }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.emerald, width: `${Math.max(2, (r.grossPaise / max) * 100)}%` }} />
          </View>
        </View>
      ))}
    </Card>
  );
}

/** The finance office's home: the month's collection, break-even, and where money came from (doc 4.4, 8.9). */
export default function Collections({ navigation }) {
  const { token, user } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [error, setError] = useState(null);
  const coll = useAsync(() => api(`/api/finance/collections?month=${month}`, { token }), [month, token]);
  const recent = useAsync(() => api(`/api/finance/payments?month=${month}`, { token }), [month, token]);
  const { refreshing, onRefresh } = useRefresh(coll, recent);
  const c = coll.data;
  const pct = c ? Math.min(100, Math.round((c.subscribersInMonth / c.breakEvenSubscribers) * 100)) : 0;
  const statement = () => download(`/api/finance/statement?month=${month}&format=csv`, token, `collection-statement-${month}.csv`).catch((e) => setError(e.message));

  return (
    <Screen
      header={<GreetHeader title="Finance office" name={user?.name} right={<HeaderIconButton icon="card" label="Payments" onPress={() => navigation.navigate('Payments')} />} />}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <ErrorText>{coll.error?.message ?? error}</ErrorText>

      <GradientCard colors={G.emerald}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, ...F[700] }}>NET COLLECTION</Text>
          <MonthPicker value={month} onChange={setMonth} light />
        </Row>
        <Text style={{ color: '#fff', fontSize: 36, ...F.display }}>{c ? rupees(c.netCollectionPaise) : '—'}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)' }}>{monthName(month)} · after refunds and gateway fees</Text>
        {[
          [`Gross collected · ${c?.payments ?? '—'} payment${c?.payments === 1 ? '' : 's'}`, c ? rupees(c.grossPaise) : '—'],
          ['Gateway fees (2% + 18% GST, est.)', c ? `− ${rupees(c.gatewayFeesPaise)}` : '—'],
          [`Refunds · ${c?.refundCount ?? '—'}`, c ? `− ${rupees(c.refundsPaise)}` : '—'],
        ].map(([l, v]) => (
          <Row key={l} style={{ justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.12)', padding: 10, borderRadius: 12 }}>
            <Text style={{ color: '#fff', flex: 1 }}>{l}</Text><Text style={{ color: '#fff', ...F[800] }}>{v}</Text>
          </Row>
        ))}
        <Row style={{ backgroundColor: 'rgba(0,0,0,0.12)', padding: 10, borderRadius: 12 }}>
          <Icon name="chart" size={15} color="#fff" />
          <Text style={{ color: '#fff', flex: 1 }}>After {c ? rupees(c.runningCostPaise) : '…'} monthly running cost: <Text style={{ ...F[800] }}>{c ? rupees(c.netAfterCostsPaise) : '—'}</Text></Text>
        </Row>
      </GradientCard>

      <Row>
        <Button title="Reconcile" variant="indigo" icon="shield" onPress={() => navigation.navigate('Reconcile')} style={{ flex: 1 }} />
        <Button title="Statement" variant="dark" icon="download" onPress={statement} style={{ flex: 1 }} />
      </Row>

      <Card title="Break-even" icon="users" right={c ? <Txt small muted>{c.adoptionPct}% adoption</Txt> : null}>
        <Row gap={12}>
          <Text style={{ fontSize: 34, ...F.display, color: C.ink }}>{c?.subscribersInMonth ?? '—'}</Text>
          <View style={{ flex: 1 }}>
            <Txt small>of <Txt small bold>{c?.breakEvenSubscribers ?? '—'}</Txt> subscribers needed to cover the running cost</Txt>
            <Txt muted small>₹12,700 ÷ ₹58.58 per subscriber after fees (doc 8.9)</Txt>
          </View>
        </Row>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: C.line2 }}>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: C.emerald, width: `${pct}%` }} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}><Txt muted small>0</Txt><Txt muted small>{pct}%</Txt><Txt muted small>{c?.breakEvenSubscribers ?? ''}</Txt></Row>
      </Card>

      <Card title="Recent payments" icon="card" onSeeAll={() => navigation.navigate('Payments')}>
        {recent.data == null ? <Skeleton /> : recent.data.length === 0 ? <Txt muted>No payments this month.</Txt> : recent.data.slice(0, 5).map((p, i) => (
          <View key={p.payment_id} style={{ flexDirection: 'row', gap: 10, padding: 10, borderRadius: 12, backgroundColor: i === 0 && p.status === 'CAPTURED' ? C.emerald50 : p.status === 'FAILED' || p.status === 'REFUNDED' ? C.delayed50 : C.surface }}>
            <Icon name={p.status === 'CAPTURED' ? 'check' : p.status === 'REFUNDED' ? 'swap' : 'clock'} size={15} color={C.navy} />
            <View style={{ flex: 1 }}>
              <Txt bold>{p.full_name} · {rupees(p.amount_paise)}</Txt>
              <Txt small>{p.plan_code} · {p.method ?? 'pending'} · {p.status.toLowerCase()}{p.receipt_no ? ` · ${p.receipt_no}` : ''}</Txt>
              <Txt small muted>{dateTime(p.paid_at ?? p.created_at)}</Txt>
            </View>
          </View>
        ))}
      </Card>

      <StatGrid>
        <Stat icon="users" label="Subscribers this month" value={c?.subscribersInMonth} tone="live" />
        <Stat icon="signal" label={c ? `Adoption of ${c.studentsCarried} carried` : 'Adoption'} value={c ? `${c.adoptionPct}%` : null} />
        <Stat icon="swap" label="Refunds" value={c ? c.refundCount : null} tone={c?.refundCount ? 'delayed' : undefined} />
        <Stat icon="wallet" label="Registered students" value={c?.registeredStudents} />
      </StatGrid>
      <Breakdown title="By route" icon="route" rows={c?.byRoute} label={(r) => <Row gap={6}><RouteCode code={r.key} small /><Txt small style={{ flex: 1 }} numberOfLines={1}>{r.routeName ?? ''}</Txt></Row>} />
      <Breakdown title="By department" icon="users" rows={c?.byDepartment} />
      <Breakdown title="By payment method" icon="card" rows={c?.byMethod} />
    </Screen>
  );
}
