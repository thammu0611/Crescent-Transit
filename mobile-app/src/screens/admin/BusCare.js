import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { DetailModal, Figure } from '../../components/adminkit.js';
import {
  alpha, Badge, Button, DateField, IconBubble, Empty, ErrorText, ListCard, Notice, PageHead, Panel, RouteCode, Screen, Segmented, Select, Skeleton, Stat, StatGrid, Text, TextField, Txt,
} from '../../components/ui.js';
import { api, pickDocumentFile } from '../../lib/api.js';
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
/** The papers in a few words: none yet, all valid, or only the ones that need attention. */
const papersLine = (documents) => {
  if (documents.every((d) => d.state === 'MISSING')) return 'No papers added yet';
  const due = documents.filter((d) => d.state !== 'OK');
  if (!due.length) return 'All papers valid';
  return due.map((d) => `${DOC_SHORT[d.kind]}: ${docLabel(d)}`).join(' · ');
};
const scoreColor = (s) => (s >= 80 ? C.live : s >= 60 ? C.delayed : C.danger);

const KIND_TEXT = { ...DOC_TEXT, SERVICE: 'Service bill' };
const DOC_ICON = { INSURANCE: 'shield', FITNESS: 'check', PERMIT: 'card', PUC: 'signal' };
const daysTo = (iso) => Math.round((Date.parse(iso) - Date.parse(today())) / 86400000);
/** A paper's state from its expiry date: text for its tile and badge, and its tone. */
function docState(iso) {
  if (!iso) return { text: 'Not added', tone: 'offline', badge: null };
  const days = daysTo(iso);
  if (Number.isNaN(days)) return { text: '—', tone: 'offline', badge: null };
  if (days < 0) return { text: 'Expired', tone: 'danger', badge: `Expired ${-days} day${days === -1 ? '' : 's'} ago` };
  if (days === 0) return { text: 'Today', tone: 'danger', badge: 'Expires today' };
  if (days <= 30) return { text: `${days} day${days === 1 ? '' : 's'}`, tone: 'delayed', badge: `${days} day${days === 1 ? '' : 's'} left` };
  return { text: 'Valid', tone: 'live', badge: `Valid · ${days} days left` };
}

/** One bus on its own page: where its papers and service stand, a document to fill it in, and the boxes. */
function BusEditor({ token, bus, onClose, onSaved }) {
  const [docs, setDocs] = useState(() => Object.fromEntries(bus.documents.map((d) => [d.kind, { number: d.number ?? '', expiresOn: d.expiresOn ?? '' }])));
  const [service, setService] = useState({ odometerKm: String(bus.odometerKm ?? ''), serviceIntervalKm: String(bus.serviceIntervalKm ?? 10000), lastServiceKm: String(bus.lastServiceKm ?? ''), lastServiceOn: bus.lastServiceOn ?? '' });
  const [filled, setFilled] = useState(() => new Set());
  const [files, setFiles] = useState([]);
  const a = useAction();
  const unmark = (key) => setFilled((f) => { if (!f.has(key)) return f; const n = new Set(f); n.delete(key); return n; });
  const setDoc = (kind, k) => (v) => { unmark(`${kind}.${k}`); setDocs((d) => ({ ...d, [kind]: { ...d[kind], [k]: v } })); };
  const set = (k) => (v) => { unmark(k); setService((s) => ({ ...s, [k]: v })); };
  const hl = (key) => filled.has(key);

  const nextKm = service.lastServiceKm !== '' && service.serviceIntervalKm ? Number(service.lastServiceKm) + Number(service.serviceIntervalKm) : null;
  const kmLeft = nextKm != null && service.odometerKm !== '' ? nextKm - Number(service.odometerKm) : null;
  const serviceNow = kmLeft == null ? { text: 'No readings', tone: 'offline' } : kmLeft <= 0 ? { text: `Overdue ${(-kmLeft).toLocaleString('en-IN')} km`, tone: 'danger' } : kmLeft <= 500 ? { text: `${kmLeft} km left`, tone: 'delayed' } : { text: `${kmLeft.toLocaleString('en-IN')} km`, tone: 'live' };

  const fromDocument = (r) => {
    const keys = [];
    if (DOC_TEXT[r.kind]) {
      setDocs((d) => ({ ...d, [r.kind]: { number: r.number ?? d[r.kind].number, expiresOn: r.expiresOn ?? d[r.kind].expiresOn } }));
      if (r.number) keys.push(`${r.kind}.number`);
      if (r.expiresOn) keys.push(`${r.kind}.expiresOn`);
    }
    if (r.kind === 'SERVICE') {
      setService((s) => ({
        ...s,
        lastServiceKm: r.odometerKm ? String(r.odometerKm) : s.lastServiceKm,
        lastServiceOn: r.serviceOn ?? s.lastServiceOn,
        odometerKm: r.odometerKm && (s.odometerKm === '' || r.odometerKm > Number(s.odometerKm)) ? String(r.odometerKm) : s.odometerKm,
      }));
      if (r.odometerKm) keys.push('lastServiceKm', 'odometerKm');
      if (r.serviceOn) keys.push('lastServiceOn');
    } else if (r.odometerKm) {
      setService((s) => ({ ...s, odometerKm: s.odometerKm === '' || r.odometerKm > Number(s.odometerKm) ? String(r.odometerKm) : s.odometerKm }));
      keys.push('odometerKm');
    }
    setFilled((f) => new Set([...f, ...keys]));
  };

  // Pick a PDF or photo; the server reads it (server/docreader.js) and the boxes fill in.
  const upload = async (kind = null, again = null) => {
    let file = again;
    try {
      if (!file) file = await pickDocumentFile();
    } catch (err) {
      setFiles((l) => [...l, { id: Date.now(), name: 'Document', status: 'error', message: err.message }]);
      return;
    }
    if (!file) return;
    const id = again?.id ?? Date.now();
    setFiles((l) => (again ? l.map((f) => (f.id === id ? { ...f, status: 'reading' } : f)) : [...l, { id, name: file.name, status: 'reading', file }]));
    try {
      const r = await api('/api/admin/documents/read', { token, body: { data: file.data, mimeType: file.mimeType, name: file.name, kind } });
      const status = r.kind ? 'done' : r.scanned ? 'error' : 'unknown';
      setFiles((l) => l.map((f) => (f.id === id ? { ...f, status, result: r, message: r.message } : f)));
      if (r.kind) fromDocument(r);
    } catch (err) {
      setFiles((l) => l.map((f) => (f.id === id ? { ...f, status: 'error', message: err.message } : f)));
    }
  };

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
    <DetailModal title={bus.fleetCode} subtitle={`${bus.routeCode ? `Route ${bus.routeCode} · ` : ''}documents and service`} onClose={onClose}>
      {/* At a glance, from what is on this page. */}
      <StatGrid>
        {bus.documents.map((d) => {
          const st = docState(docs[d.kind].expiresOn);
          return <Stat small key={d.kind} icon={DOC_ICON[d.kind]} label={DOC_TEXT[d.kind]} value={st.text} tone={st.tone} />;
        })}
        <Stat small icon="clock" label="Service" value={serviceNow.text} tone={serviceNow.tone} />
        <Stat small icon="route" label="Odometer" value={service.odometerKm === '' ? '—' : `${Number(service.odometerKm).toLocaleString('en-IN')} km`} />
      </StatGrid>

      <Panel title="Fill in from a document" icon="upload">
        <Pressable accessibilityRole="button" onPress={() => upload()} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(196,138,10,0.6)', backgroundColor: 'rgba(247,188,49,0.12)' }, pressed && { opacity: 0.8 }]}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={22} color="#1C315E" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt bold>Upload a document</Txt>
            <Txt muted small>Insurance, fitness, permit, PUC or a service bill · PDF or photo. The boxes below fill in for you to check.</Txt>
          </View>
        </Pressable>
        {files.map((f) => (
          <View key={f.id} style={{ flexDirection: 'row', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: f.status === 'done' ? alpha(C.live, 0.4) : f.status === 'reading' ? C.line2 : alpha(C.delayed, 0.4), backgroundColor: f.status === 'done' ? alpha(C.live, 0.07) : f.status === 'reading' ? 'transparent' : alpha(C.delayed, 0.07) }}>
            <Icon name={f.status === 'done' ? 'check' : f.status === 'reading' ? 'clock' : 'alert'} size={16} color={f.status === 'done' ? C.live : f.status === 'reading' ? C.muted : C.delayed} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt bold small numberOfLines={1}>{f.name}</Txt>
              {f.status === 'reading' ? <Txt muted small>Reading the document…</Txt> : null}
              {f.status === 'done' ? (
                <Txt muted small>
                  {[KIND_TEXT[f.result.kind], f.result.number && `No. ${f.result.number}`, f.result.expiresOn && `expires ${date(f.result.expiresOn)}`, f.result.odometerKm && `${f.result.odometerKm.toLocaleString('en-IN')} km`, f.result.serviceOn && `serviced ${date(f.result.serviceOn)}`, f.result.registration && `vehicle ${f.result.registration}`].filter(Boolean).join(' · ')}
                  {f.result.confidence !== 'high' ? ' · check the boxes, some could not be read' : ''}
                </Txt>
              ) : null}
              {f.status === 'error' ? <Txt small style={{ color: C.delayed }}>{f.message}</Txt> : null}
              {f.status === 'unknown' ? (
                <View style={{ gap: 6 }}>
                  <Txt small style={{ color: C.delayed }}>Which document is this?</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(KIND_TEXT).map(([k, v]) => <Button key={k} small variant="ghost" title={v} onPress={() => upload(k, f.file && { ...f.file, id: f.id })} />)}
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {filled.size > 0 ? <Txt small style={{ color: C.dark ? C.gold : '#7A5600' }}>Filled from your document - check the highlighted boxes, then save.</Txt> : null}
      </Panel>

      <Panel title="Documents" icon="shield" summary="Reminders 30, 15, 7, 3 and 1 days before expiry, then every day once expired">
        {bus.documents.map((d) => {
          const st = docState(docs[d.kind].expiresOn);
          return (
            // One card per paper: its name and state on top, then its number and expiry.
            <View key={d.kind} style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line2, backgroundColor: C.dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.55)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconBubble name={DOC_ICON[d.kind]} accent={st.tone === 'danger' ? 'danger' : st.tone === 'delayed' ? 'amber' : st.tone === 'live' ? 'emerald' : 'navy'} size={34} iconSize={17} />
                <Txt bold style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{DOC_TEXT[d.kind]}</Txt>
                <Badge tone={st.tone}>{st.badge ?? 'Not added'}</Badge>
              </View>
              <TextField label="Number" highlight={hl(`${d.kind}.number`)} value={docs[d.kind].number} maxLength={40} onChangeText={setDoc(d.kind, 'number')} />
              <DateField label="Expires on" highlight={hl(`${d.kind}.expiresOn`)} value={docs[d.kind].expiresOn} onChange={setDoc(d.kind, 'expiresOn')} />
            </View>
          );
        })}
      </Panel>

      <Panel title="Service and odometer" icon="bus" summary="The odometer goes up by itself after each trip, from the bus GPS">
        <TextField label="Odometer now (km)" highlight={hl('odometerKm')} hint={bus.odometerGpsKm ? `Includes ${bus.odometerGpsKm.toLocaleString('en-IN')} km from GPS trips since the last reading` : undefined} keyboardType="number-pad" value={service.odometerKm} onChangeText={set('odometerKm')} />
        <TextField label="Service every (km)" keyboardType="number-pad" value={service.serviceIntervalKm} onChangeText={set('serviceIntervalKm')} />
        <TextField label="Reading at last service (km)" highlight={hl('lastServiceKm')} keyboardType="number-pad" value={service.lastServiceKm} onChangeText={set('lastServiceKm')} />
        <DateField label="Last serviced on" highlight={hl('lastServiceOn')} value={service.lastServiceOn} onChange={set('lastServiceOn')} />
      </Panel>

      <ErrorText>{a.error}</ErrorText>
      <Button title="Save documents and service" icon="check" busy={a.busy} onPress={save} />
    </DetailModal>
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
            papersLine(b.documents),
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
