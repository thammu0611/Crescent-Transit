import { useState } from 'react';
import { View } from 'react-native';
import { Figure } from '../../components/adminkit.js';
import {
  Badge, Button, DateField, Empty, ErrorText, ListCard, Notice, PageHead, Panel, RouteCode, Screen, Segmented, Select, Sheet, Skeleton, Stat, StatGrid, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date, daysAgo, rupees, today } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G } from '../../theme.js';

const DOC_TEXT = { INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PERMIT: 'Permit', PUC: 'PUC' };
const DOC_SHORT = { INSURANCE: 'Ins', FITNESS: 'FC', PERMIT: 'Permit', PUC: 'PUC' };
const DOC_TONE = { OK: 'live', SOON: 'delayed', EXPIRED: 'danger', MISSING: 'offline' };
const SERVICE_TONE = { OK: 'live', SOON: 'delayed', DUE: 'danger', UNKNOWN: 'offline' };
const docLabel = (d) => (d.state === 'MISSING' ? 'Not added' : d.state === 'EXPIRED' ? 'Expired' : d.state === 'SOON' ? `${d.daysLeft} days` : date(d.expiresOn));
const serviceLabel = (b) => (b.serviceState === 'UNKNOWN' ? 'Add readings' : b.kmLeft <= 0 ? `Overdue ${-b.kmLeft} km` : `${b.kmLeft} km left`);
const scoreColor = (s) => (s >= 80 ? C.live : s >= 60 ? C.delayed : C.danger);

function BusEditor({ token, bus, onClose, onSaved }) {
  const [docs, setDocs] = useState(() => Object.fromEntries(bus.documents.map((d) => [d.kind, { number: d.number ?? '', expiresOn: d.expiresOn ?? '' }])));
  const [service, setService] = useState({ odometerKm: String(bus.odometerKm ?? ''), serviceIntervalKm: String(bus.serviceIntervalKm ?? 10000), lastServiceKm: String(bus.lastServiceKm ?? ''), lastServiceOn: bus.lastServiceOn ?? '' });
  const a = useAction();
  const setDoc = (kind, k) => (v) => setDocs((d) => ({ ...d, [kind]: { ...d[kind], [k]: v } }));
  const set = (k) => (v) => setService((s) => ({ ...s, [k]: v }));
  const save = () => a.run(async () => {
    for (const [kind, d] of Object.entries(docs)) {
      if (d.expiresOn) await api(`/api/admin/buses/${bus.id}/documents/${kind}`, { token, method: 'PUT', body: d });
    }
    const body = {};
    for (const k of ['odometerKm', 'serviceIntervalKm', 'lastServiceKm']) if (service[k] !== '') body[k] = Number(service[k]);
    if (service.lastServiceOn) body.lastServiceOn = service.lastServiceOn;
    if (Object.keys(body).length) await api(`/api/admin/buses/${bus.id}/service`, { token, method: 'PUT', body });
    return true;
  }).then((r) => r && onSaved());
  return (
    <Sheet title={bus.fleetCode} onClose={onClose}>
      <View style={{ gap: 10 }}>
        {bus.documents.map((d) => (
          <View key={d.kind} style={{ gap: 6 }}>
            <TextField label={`${DOC_TEXT[d.kind]} number`} value={docs[d.kind].number} maxLength={40} onChangeText={setDoc(d.kind, 'number')} />
            <DateField label="Expires on" value={docs[d.kind].expiresOn} onChange={setDoc(d.kind, 'expiresOn')} />
          </View>
        ))}
        <TextField label="Odometer now (km)" keyboardType="number-pad" value={service.odometerKm} onChangeText={set('odometerKm')} />
        <TextField label="Service every (km)" keyboardType="number-pad" value={service.serviceIntervalKm} onChangeText={set('serviceIntervalKm')} />
        <TextField label="Reading at last service (km)" keyboardType="number-pad" value={service.lastServiceKm} onChangeText={set('lastServiceKm')} />
        <DateField label="Last serviced on" value={service.lastServiceOn} onChange={set('lastServiceOn')} />
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save" busy={a.busy} onPress={save} />
      </View>
    </Sheet>
  );
}

function Documents({ token }) {
  const list = useAsync(() => api('/api/admin/fleet-care', { token }), [token]);
  const [open, setOpen] = useState(null);
  // Buses that need something first, the rest by fleet number.
  const urgency = (b) => (b.serviceState === 'DUE' || b.documents.some((d) => d.state === 'EXPIRED') ? 0 : b.serviceState === 'SOON' || b.documents.some((d) => d.state === 'SOON') ? 1 : b.documents.some((d) => d.state === 'OK') ? 2 : 3);
  const rows = [...(list.data ?? [])].sort((a, b) => urgency(a) - urgency(b));
  const alerting = rows.filter((b) => ['DUE', 'SOON'].includes(b.serviceState) || b.documents.some((d) => ['EXPIRED', 'SOON'].includes(d.state))).length;
  return (
    <>
      <StatGrid>
        <Stat icon="bus" label="Buses" value={list.data ? rows.length : null} />
        <Stat icon="alert" label="Need attention" value={list.data ? alerting : null} tone={alerting ? 'danger' : undefined} />
      </StatGrid>
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <Skeleton /> : rows.map((b) => (
        <ListCard
          key={b.id}
          lead={<RouteCode code={b.routeCode ?? '—'} small />}
          title={b.fleetCode}
          lines={[
            b.odometerKm != null ? `${b.odometerKm.toLocaleString('en-IN')} km · Service: ${serviceLabel(b)}` : `Service: ${serviceLabel(b)}`,
            b.documents.map((d) => `${DOC_SHORT[d.kind]}: ${docLabel(d)}`).join(' · '),
          ]}
          onPress={() => setOpen(b)}
          right={<Badge tone={SERVICE_TONE[b.serviceState] === 'danger' || b.documents.some((d) => d.state === 'EXPIRED') ? 'danger' : b.documents.some((d) => d.state === 'SOON') ? 'delayed' : b.documents.every((d) => d.state === 'OK') ? 'live' : 'offline'}>{b.documents.filter((d) => d.state === 'OK').length}/4</Badge>}
        />
      ))}
      {open ? <BusEditor token={token} bus={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : null}
    </>
  );
}

function Fuel({ token }) {
  const q = new URLSearchParams({ from: daysAgo(29), to: today() }).toString();
  const data = useAsync(() => api(`/api/admin/fuel?${q}`, { token }), [q, token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [form, setForm] = useState({ fleetCode: '', odometerKm: '', litres: '', costRupees: '' });
  const a = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const add = () => a.run(() => api('/api/fuel', { token, body: { ...form, odometerKm: Number(form.odometerKm), litres: Number(form.litres), costRupees: Number(form.costRupees) } }), 'Fuel saved.')
    .then((r) => { if (r) { setForm((f) => ({ ...f, odometerKm: '', litres: '', costRupees: '' })); data.reload(); } });
  const r = data.data?.report;
  return (
    <>
      <Panel title="Last 30 days" icon="chart">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Figure value={r ? `${r.total.km.toLocaleString('en-IN')} km` : '…'} label="Distance" />
          <Figure value={r ? rupees(r.total.costPaise) : '…'} label="Fuel cost" />
          <Figure value={r?.total.costPerKmPaise != null ? rupees(r.total.costPerKmPaise) : '—'} label="Cost per km" />
        </View>
      </Panel>
      {r == null ? <Skeleton /> : r.buses.length === 0 ? <Empty icon="bus">No fuel entered in this period.</Empty> : r.buses.map((b) => (
        <ListCard
          key={b.fleetCode}
          lead={<RouteCode code={b.routeCode ?? '—'} small />}
          title={b.fleetCode}
          lines={[`${b.km.toLocaleString('en-IN')} km · ${b.litres} litres${b.kmPerLitre ? ` · ${b.kmPerLitre} km/l` : ''}`]}
          right={<Txt bold>{b.costPerKmPaise == null ? '—' : `${rupees(b.costPerKmPaise)}/km`}</Txt>}
        />
      ))}
      <Panel title="Add a fuel entry" icon="plus">
        <Select label="Bus" value={form.fleetCode} onChange={set('fleetCode')} placeholder="Choose a bus" searchable options={(buses.data ?? []).map((b) => ({ value: b.fleet_code, label: b.fleet_code }))} />
        <TextField label="Odometer (km)" keyboardType="number-pad" value={form.odometerKm} onChangeText={set('odometerKm')} />
        <TextField label="Litres" keyboardType="decimal-pad" value={form.litres} onChangeText={set('litres')} />
        <TextField label="Amount paid (₹)" keyboardType="decimal-pad" value={form.costRupees} onChangeText={set('costRupees')} />
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save fuel" busy={a.busy} disabled={!form.fleetCode || !form.odometerKm || !form.litres || !form.costRupees} onPress={add} />
      </Panel>
    </>
  );
}

function Scorecards({ token }) {
  const list = useAsync(() => api('/api/admin/scorecards?days=30', { token }), [token]);
  const scored = (list.data ?? []).filter((d) => d.score != null);
  return (
    <Panel title="Driver scorecards" icon="users" summary="Punctuality 50%, ratings 30%, safety 20%">
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <Skeleton /> : scored.length === 0 ? <Empty icon="users">No completed trips in this period.</Empty> : scored.map((d) => (
        <ListCard
          key={d.id}
          lead={(
            <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: scoreColor(d.score), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: scoreColor(d.score), ...F[700], fontSize: 15 }}>{d.score}</Text>
            </View>
          )}
          title={d.name}
          lines={[`${d.fleetCode ?? 'No bus'} · ${d.trips} trips`, `On time ${d.onTimePct == null ? '—' : `${d.onTimePct}%`} · Rating ${d.rating ?? '—'} · Speeding ${d.speeding} · Failed checks ${d.failedChecks}`]}
        />
      ))}
    </Panel>
  );
}

function StopReview({ token }) {
  const list = useAsync(() => api('/api/admin/stop-suggestions', { token }), [token]);
  const rows = (list.data ?? []).filter((s) => s.mergeInto).slice(0, 40);
  return (
    <Panel title="Little-used stops" icon="pin" summary="No student lives here, and 2 or fewer boardings in 30 days">
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <Skeleton /> : rows.length === 0 ? <Empty icon="pin">Nothing to suggest.</Empty> : rows.map((s) => (
        <ListCard key={`${s.routeCode}:${s.stopName}`} lead={<RouteCode code={s.routeCode} small />} title={s.stopName} lines={[s.suggestion]} />
      ))}
      <Txt muted small>These are suggestions from attendance data. Check with the route before changing stops.</Txt>
    </Panel>
  );
}

/** Keeping the fleet in order: papers, service, fuel, drivers and stops. */
export default function BusCare() {
  const { token } = useSession();
  const [tab, setTab] = useState('docs');
  return (
    <Screen>
      <PageHead icon="shield" colors={G.navy} eyebrow="Transport office" title="Bus care" />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'docs', label: 'Papers' }, { value: 'fuel', label: 'Fuel' }, { value: 'drivers', label: 'Scorecards' }, { value: 'stops', label: 'Stops' }]} />
      {tab === 'docs' ? <Documents token={token} /> : null}
      {tab === 'fuel' ? <Fuel token={token} /> : null}
      {tab === 'drivers' ? <Scorecards token={token} /> : null}
      {tab === 'stops' ? <StopReview token={token} /> : null}
    </Screen>
  );
}
