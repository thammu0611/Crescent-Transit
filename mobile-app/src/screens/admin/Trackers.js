// GPS trackers fitted in the buses - the web Fleet page's "GPS trackers" tab,
// for the phone: a technician fitting a tracker can register it on the spot
// with the IMEI from its label. Full setup steps: docs/GPS_TRACKERS.md.
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { Badge, Button, confirm, DataList, ErrorText, ItemCard, KV, LinkButton, Notice, Row, Select, Sheet, TextField, Txt } from '../../components/ui.js';
import { apiBase } from '../../config.js';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const PROTOCOLS = [
  { value: 'auto', label: 'Not sure yet' },
  { value: 'gt06', label: 'GT06 / Concox (TCP)' },
  { value: 'teltonika', label: 'Teltonika FMB/FMC (TCP)' },
  { value: 'osmand', label: 'OsmAnd / HTTP (Traccar Client)' },
  { value: 'webhook', label: 'Via Traccar or a vendor platform' },
];
const PROTOCOL_LABEL = Object.fromEntries(PROTOCOLS.map((p) => [p.value, p.label]));
const OUTCOME = {
  LIVE: ['live', 'Live on the map'],
  WAITING: ['delayed', 'Waiting'],
  REJECTED: ['danger', 'Position rejected'],
  NO_GPS_FIX: ['delayed', 'No GPS fix'],
  NO_BUS: ['offline', 'No bus assigned'],
  DISABLED: ['offline', 'Switched off'],
  UNSUPPORTED: ['danger', 'Wrong settings'],
};

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return dateTime(iso);
}

/** Where to point the tracker, for its protocol. */
function SetupSheet({ tracker, keyValue, setup, onClose }) {
  const base = apiBase() || 'https://your-server';
  const host = base.replace(/^https?:\/\//, '').split(/[:/]/)[0];
  const p = tracker.protocol;
  const show = (x) => p === x || p === 'auto';
  const url = `${base}${setup.osmandPath}/${keyValue || '<tracker key>'}`;
  const lines = [
    show('gt06') && (setup.gt06Port ? `GT06: server ${host}, TCP port ${setup.gt06Port}. SMS: SERVER,${/^\d+(\.\d+){3}$/.test(host) ? 0 : 1},${host},${setup.gt06Port},0#` : 'GT06: the server is not listening (set GPS_GT06_PORT).'),
    show('teltonika') && (setup.teltonikaPort ? `Teltonika: domain ${host}, port ${setup.teltonikaPort}, TCP. SMS:   setparam 2004:${host};2005:${setup.teltonikaPort};2006:0` : 'Teltonika: the server is not listening (set GPS_TELTONIKA_PORT).'),
    show('osmand') && `OsmAnd / Traccar Client: server URL ${url}, device identifier ${tracker.uniqueId}`,
    show('webhook') && (setup.webhookEnabled ? `Traccar forwarding: forward.url ${base}${setup.webhookPath}?secret=<GPS_WEBHOOK_SECRET>, forward.type json` : 'Webhook: off (set GPS_WEBHOOK_SECRET on the server).'),
  ].filter(Boolean);
  return (
    <Sheet title={`Connect ${tracker.label || tracker.uniqueId}`} onClose={onClose}>
      <View style={{ gap: 10 }}>
        {keyValue && show('osmand') ? <Notice>Tracker key (shown once, needed for HTTP senders): {keyValue}</Notice> : null}
        {lines.map((l) => <Txt key={l} small selectable>{l}</Txt>)}
        <Txt muted small>Full steps for each tracker type: the web dashboard's Setup button, or docs/GPS_TRACKERS.md.</Txt>
        <Button variant="ghost" title="Share these settings" onPress={() => Share.share({ message: [keyValue ? `Tracker key: ${keyValue}` : null, ...lines].filter(Boolean).join('\n\n') })} />
        <Button title="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

function TrackerSheet({ token, tracker, buses, prefill, onClose, onSaved }) {
  const [f, setF] = useState({
    uniqueId: tracker?.uniqueId ?? prefill?.uniqueId ?? '',
    protocol: tracker?.protocol ?? prefill?.protocol ?? 'auto',
    fleetCode: tracker?.fleetCode ?? '',
    label: tracker?.label ?? '',
    active: tracker ? (tracker.active ? 'on' : 'off') : 'on',
  });
  const a = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const free = buses.filter((b) => !b.tracker_id || b.fleet_code === tracker?.fleetCode);
  const save = () => {
    if (!tracker && !/^[A-Za-z0-9._-]{3,40}$/.test(f.uniqueId.trim())) return a.setError('Tracker ID: the IMEI on the tracker\'s label (3-40 letters or digits).');
    const body = tracker
      ? { protocol: f.protocol, fleetCode: f.fleetCode || null, label: f.label, active: f.active === 'on' }
      : { uniqueId: f.uniqueId.trim(), protocol: f.protocol, fleetCode: f.fleetCode || null, label: f.label };
    a.run(() => api(tracker ? `/api/admin/trackers/${tracker.id}` : '/api/admin/trackers', { token, method: tracker ? 'PATCH' : 'POST', body })).then((r) => r && onSaved(r));
  };
  return (
    <Sheet title={tracker ? `Edit tracker ${tracker.uniqueId}` : 'Add a GPS tracker'} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <TextField label="Tracker ID (IMEI)" value={f.uniqueId} onChangeText={set('uniqueId')} editable={!tracker} autoCapitalize="none" keyboardType="default" hint="15 digits on the tracker's label" />
        <Select label="Protocol" value={f.protocol} onChange={set('protocol')} options={PROTOCOLS} />
        <Select label="Fitted in bus" value={f.fleetCode} onChange={set('fleetCode')} searchable options={[{ value: '', label: 'Not fitted yet' }, ...free.map((b) => ({ value: b.fleet_code, label: `${b.fleet_code}${b.route_code ? ` · route ${b.route_code}` : ''}` }))]} />
        <TextField label="Label" value={f.label} onChangeText={set('label')} placeholder="e.g. Concox X3, dashboard" />
        {tracker ? <Select label="Status" value={f.active} onChange={set('active')} options={[{ value: 'on', label: 'Switched on' }, { value: 'off', label: 'Switched off (refuses its data)' }]} /> : null}
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save" busy={a.busy} onPress={save} />
      </View>
    </Sheet>
  );
}

/** The "GPS" tab of the Fleet screen. */
export default function TrackersTab({ token, buses, onChanged }) {
  const list = useAsync(() => api('/api/admin/trackers', { token }), [token]);
  const [edit, setEdit] = useState(null); // 'new' | tracker
  const [prefill, setPrefill] = useState(null);
  const [setupFor, setSetupFor] = useState(null); // { tracker, key }
  const a = useAction();

  useEffect(() => {
    const id = setInterval(() => list.reload(), 10000);
    return () => clearInterval(id);
  }, [list.reload]);

  const refresh = () => { list.reload(); onChanged?.(); };
  const remove = async (t) => {
    if (!(await confirm(`Remove tracker ${t.uniqueId}?`, 'It will be refused if it connects again.', 'Remove', true))) return;
    a.run(() => api(`/api/admin/trackers/${t.id}`, { token, method: 'DELETE' }), `Tracker ${t.uniqueId} removed.`).then(refresh);
  };
  const newKey = async (t) => {
    if (!(await confirm(`New key for ${t.uniqueId}?`, 'HTTP senders using the old key stop working.', 'Make new key'))) return;
    a.run(() => api(`/api/admin/trackers/${t.id}/key`, { token, method: 'POST' })).then((r) => r && setSetupFor({ tracker: t, key: r.key }));
  };

  const setup = list.data?.setup;
  const unknown = list.data?.unknown ?? [];
  return (
    <View style={{ gap: 10 }}>
      <Txt muted small>
        {setup ? `Automatic trips ${setup.autoTrips ? `on, ${setup.tripWindows}` : 'off'} · GT06 ${setup.gt06Port ? `TCP ${setup.gt06Port}` : 'off'} · Teltonika ${setup.teltonikaPort ? `TCP ${setup.teltonikaPort}` : 'off'}` : 'Loading…'}
      </Txt>
      <Button small variant="ghost" icon="plus" title="Add tracker" onPress={() => { setPrefill(null); setEdit('new'); }} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      {unknown.map((u) => (
        <ItemCard key={u.uniqueId} title={u.uniqueId} subtitle={`Not registered · ${PROTOCOL_LABEL[u.protocol] ?? u.protocol}`} right={<Badge tone="delayed">trying</Badge>}>
          <KV k="Last attempt" v={`${ago(u.lastSeenAt)} (${u.attempts}x)`} />
          <LinkButton icon="plus" title="Register" onPress={() => { setPrefill(u); setEdit('new'); }} />
        </ItemCard>
      ))}
      <DataList
        rows={list.data?.trackers}
        empty="No GPS trackers yet. Until one is added, each bus is tracked by its driver's phone."
        render={(t) => {
          const [tone, text] = OUTCOME[t.outcome] ?? ['offline', 'No data yet'];
          return (
            <ItemCard
              title={t.label || t.uniqueId}
              subtitle={`${t.label ? `${t.uniqueId} · ` : ''}${PROTOCOL_LABEL[t.protocol]}`}
              right={<View style={{ gap: 4, alignItems: 'flex-end' }}><Badge tone={!t.active ? 'offline' : t.online ? 'live' : 'offline'}>{!t.active ? 'off' : t.online ? 'online' : 'offline'}</Badge>{t.outcome ? <Badge tone={tone}>{text}</Badge> : null}</View>}
            >
              <KV k="Bus" v={t.fleetCode ? `${t.fleetCode}${t.routeCode ? ` · route ${t.routeCode}` : ''}` : 'Not fitted'} />
              <KV k="Status" v={t.detail ?? (t.sourceOfLive === 'tracker' ? 'The live map uses this tracker' : `Last heard ${ago(t.lastSeenAt)}`)} />
              {t.lastFix ? <KV k="Last position" v={`${Math.round(t.lastFix.speedKmh ?? 0)} km/h · ${ago(t.lastFix.recordedAt)}${t.info.ignition !== undefined ? ` · ignition ${t.info.ignition ? 'on' : 'off'}` : ''}`} /> : null}
              <KV k="Positions" v={`${t.accepted} taken${t.rejected ? `, ${t.rejected} rejected` : ''}`} />
              <Row gap={16}>
                <LinkButton icon="settings" title="Setup" onPress={() => setSetupFor({ tracker: t, key: null })} />
                <LinkButton icon="edit" title="Edit" onPress={() => { setPrefill(null); setEdit(t); }} />
                {t.protocol === 'osmand' || t.protocol === 'auto' ? <LinkButton title="New key" onPress={() => newKey(t)} /> : null}
                <LinkButton icon="trash" danger title="Remove" onPress={() => remove(t)} />
              </Row>
            </ItemCard>
          );
        }}
      />
      {edit ? (
        <TrackerSheet
          token={token}
          tracker={edit === 'new' ? null : edit}
          buses={buses}
          prefill={prefill}
          onClose={() => setEdit(null)}
          onSaved={(r) => { setEdit(null); refresh(); if (r.key) setSetupFor({ tracker: r.tracker, key: r.key }); }}
        />
      ) : null}
      {setupFor && setup ? <SetupSheet tracker={setupFor.tracker} keyValue={setupFor.key} setup={setup} onClose={() => setSetupFor(null)} /> : null}
    </View>
  );
}
