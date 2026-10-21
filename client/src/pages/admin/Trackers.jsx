import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, ErrorText, Field, Modal, Notice, RowActions, Table } from '../../components/ui.jsx';

export const PROTOCOLS = [
  ['auto', 'Not sure yet'],
  ['gt06', 'GT06 / Concox (TCP)'],
  ['teltonika', 'Teltonika FMB/FMC (TCP)'],
  ['osmand', 'OsmAnd / HTTP (Traccar Client)'],
  ['webhook', 'Via Traccar or a vendor platform'],
];
const PROTOCOL_LABEL = Object.fromEntries(PROTOCOLS);

// What the server last did with the tracker's data, in words.
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

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="link" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

const Line = ({ label, value }) => (
  <p><b>{label}:</b> <code className="mono">{value}</code> <Copy text={value} /></p>
);

/** How to point this tracker at the server, for its protocol. */
function SetupModal({ tracker, keyValue, setup, onClose }) {
  const host = window.location.hostname;
  const origin = window.location.origin;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const p = tracker.protocol;
  const show = (x) => p === x || p === 'auto';
  return (
    <Modal title={`Connect ${tracker.label || tracker.uniqueId}`} onClose={onClose} width={620}>
      {local && <Notice>This page is open on a local address ({host}). Trackers on mobile data need the server's public address or domain instead.</Notice>}
      {keyValue && show('osmand') && (
        <div className="notice">
          <p><b>Tracker key (shown once):</b> <code className="mono">{keyValue}</code> <Copy text={keyValue} /></p>
          <small>Needed only for HTTP (OsmAnd) senders. Lost it? Use "New key".</small>
        </div>
      )}
      {show('gt06') && (
        <>
          <h4>GT06 / Concox trackers</h4>
          {setup.gt06Port ? (
            <>
              <Line label="Server" value={host} />
              <Line label="Port (TCP)" value={String(setup.gt06Port)} />
              <p>Send these SMS commands to the tracker's SIM (check your model's manual; most GT06-family units accept them):</p>
              <Line label="Server" value={`SERVER,${/^\d+(\.\d+){3}$/.test(host) ? 0 : 1},${host},${setup.gt06Port},0#`} />
              <Line label="Time zone UTC" value="GMT,E,0,0#" />
              <Line label="Every 10 s" value="TIMER,10,60#" />
              <small>Also set the SIM's APN, e.g. <code>APN,airtelgprs.com#</code> or <code>APN,jionet#</code>. The tracker id is its 15-digit IMEI.</small>
            </>
          ) : <ErrorText>The server is not listening for GT06 trackers. Start it with GPS_GT06_PORT=5023 (and open that port in the firewall).</ErrorText>}
        </>
      )}
      {show('teltonika') && (
        <>
          <h4>Teltonika FMB / FMC</h4>
          {setup.teltonikaPort ? (
            <>
              <p>In Teltonika Configurator, GPRS → Server settings: domain <b>{host}</b>, port <b>{setup.teltonikaPort}</b>, protocol <b>TCP</b>, Codec 8 or 8 Extended. Or by SMS (two spaces first):</p>
              <Line label="SMS" value={`  setparam 2004:${host};2005:${setup.teltonikaPort};2006:0`} />
              <small>Data acquisition → "On moving": period 10 s. The tracker id is its IMEI.</small>
            </>
          ) : <ErrorText>The server is not listening for Teltonika trackers. Start it with GPS_TELTONIKA_PORT=5027 (and open that port in the firewall).</ErrorText>}
        </>
      )}
      {show('osmand') && (
        <>
          <h4>OsmAnd / HTTP (Traccar Client, trackers with an HTTP mode)</h4>
          <Line label="Server URL" value={`${origin}${setup.osmandPath}/${keyValue || '<tracker key>'}`} />
          <Line label="Device identifier" value={tracker.uniqueId} />
          <small>Positions are sent as ?id=…&amp;lat=…&amp;lon=…&amp;timestamp=…&amp;speed=(knots)&amp;bearing=…</small>
        </>
      )}
      {show('webhook') && (
        <>
          <h4>Through a Traccar server or a vendor platform</h4>
          {setup.webhookEnabled ? (
            <>
              <p>In Traccar's <code>traccar.xml</code> (position forwarding, JSON):</p>
              <Line label="forward.url" value={`${origin}${setup.webhookPath}?secret=<GPS_WEBHOOK_SECRET>`} />
              <small>Also set <code>forward.enable</code> to true and <code>forward.type</code> to json. The device's unique id in Traccar must be <code>{tracker.uniqueId}</code>.</small>
            </>
          ) : <ErrorText>The webhook is off. Set GPS_WEBHOOK_SECRET on the server to turn it on.</ErrorText>}
        </>
      )}
      <p className="muted">Full guide: docs/GPS_TRACKERS.md</p>
      <button className="btn primary" onClick={onClose}>Done</button>
    </Modal>
  );
}

function TrackerForm({ token, tracker, buses, prefill, onClose, onSaved }) {
  const [f, setF] = useState({
    uniqueId: tracker?.uniqueId ?? prefill?.uniqueId ?? '',
    protocol: tracker?.protocol ?? prefill?.protocol ?? 'auto',
    fleetCode: tracker?.fleetCode ?? '',
    label: tracker?.label ?? '',
    active: tracker?.active ?? true,
  });
  const a = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const free = buses.filter((b) => !b.tracker_id || b.fleet_code === tracker?.fleetCode);
  const save = (e) => {
    e.preventDefault();
    const body = tracker
      ? { protocol: f.protocol, fleetCode: f.fleetCode || null, label: f.label, active: f.active }
      : { uniqueId: f.uniqueId.trim(), protocol: f.protocol, fleetCode: f.fleetCode || null, label: f.label };
    a.run(() => api(tracker ? `/api/admin/trackers/${tracker.id}` : '/api/admin/trackers', { token, method: tracker ? 'PATCH' : 'POST', body })).then((r) => r && onSaved(r));
  };
  return (
    <Modal title={tracker ? `Edit tracker ${tracker.uniqueId}` : 'Add a GPS tracker'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid2">
          <Field label="Tracker ID (IMEI)" hint="15 digits on the tracker's label, or the id an HTTP sender reports">
            <input value={f.uniqueId} onChange={set('uniqueId')} disabled={Boolean(tracker)} required pattern="[A-Za-z0-9._\-]{3,40}" />
          </Field>
          <Field label="Protocol">
            <select value={f.protocol} onChange={set('protocol')}>{PROTOCOLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label="Fitted in bus">
            <select value={f.fleetCode} onChange={set('fleetCode')}>
              <option value="">Not fitted yet</option>
              {free.map((b) => <option key={b.id} value={b.fleet_code}>{b.fleet_code}{b.route_code ? ` · route ${b.route_code}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Label"><input value={f.label} onChange={set('label')} placeholder="e.g. Concox X3, dashboard" /></Field>
        </div>
        {tracker && <label className="field check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Switched on (off refuses its data)</label>}
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>Save</button>
      </form>
    </Modal>
  );
}

/** The "GPS trackers" tab of the Fleet page. */
export default function TrackersTab({ token, buses, onChanged }) {
  const list = useAsync(() => api('/api/admin/trackers', { token }), [token]);
  const [edit, setEdit] = useState(null); // 'new' | tracker
  const [prefill, setPrefill] = useState(null);
  const [setupFor, setSetupFor] = useState(null); // { tracker, key }
  const a = useAction();

  // Status is live: refresh while the tab is open.
  useEffect(() => {
    const id = setInterval(() => list.reload(), 10000);
    return () => clearInterval(id);
  }, [list.reload]);

  const refresh = () => { list.reload(); onChanged?.(); };
  const remove = (t) => {
    if (!window.confirm(`Remove tracker ${t.uniqueId}? It will be refused if it connects again.`)) return;
    a.run(() => api(`/api/admin/trackers/${t.id}`, { token, method: 'DELETE' }), `Tracker ${t.uniqueId} removed.`).then(refresh);
  };
  const newKey = (t) => {
    if (!window.confirm(`Make a new key for ${t.uniqueId}? HTTP senders using the old key stop working.`)) return;
    a.run(() => api(`/api/admin/trackers/${t.id}/key`, { token, method: 'POST' })).then((r) => r && setSetupFor({ tracker: t, key: r.key }));
  };

  const setup = list.data?.setup;
  const unknown = list.data?.unknown ?? [];
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {setup ? <>Automatic trips {setup.autoTrips ? <>on, {setup.tripWindows}</> : 'off'} · GT06 {setup.gt06Port ? `TCP ${setup.gt06Port}` : 'off'} · Teltonika {setup.teltonikaPort ? `TCP ${setup.teltonikaPort}` : 'off'} · webhook {setup.webhookEnabled ? 'on' : 'off'}</> : 'Loading…'}
        </span>
        <button className="btn ghost" onClick={() => { setPrefill(null); setEdit('new'); }}><Icon name="plus" size={14} />Add tracker</button>
      </div>
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      {unknown.length > 0 && (
        <div className="notice">
          <b>Trackers trying to connect that are not registered:</b>
          {unknown.map((u) => (
            <p key={u.uniqueId}>
              <code className="mono">{u.uniqueId}</code> · {PROTOCOL_LABEL[u.protocol] ?? u.protocol} · {u.attempts} attempt{u.attempts === 1 ? '' : 's'}, last {ago(u.lastSeenAt)}{' '}
              <button className="link" onClick={() => { setPrefill(u); setEdit('new'); }}>Register</button>
            </p>
          ))}
        </div>
      )}
      <Table
        rows={list.data?.trackers}
        empty="No GPS trackers yet. Add one with its IMEI; until then each bus is tracked by its driver's phone."
        columns={[
          { key: 'uniqueId', label: 'Tracker', render: (t) => <><b>{t.label || t.uniqueId}</b><small className="mono">{t.label ? `${t.uniqueId} · ` : ''}{PROTOCOL_LABEL[t.protocol]}</small></> },
          { key: 'fleetCode', label: 'Bus', render: (t) => (t.fleetCode ? <><b>{t.fleetCode}</b>{t.routeCode && <small>Route {t.routeCode}</small>}</> : <span className="muted">Not fitted</span>) },
          {
            key: 'status', label: 'Status', wrap: true, render: (t) => {
              const [tone, text] = OUTCOME[t.outcome] ?? ['offline', 'No data yet'];
              return (
                <>
                  <Badge tone={!t.active ? 'offline' : t.online ? 'live' : 'offline'}>{!t.active ? 'off' : t.online ? 'online' : 'offline'}</Badge>{' '}
                  {t.outcome && <Badge tone={tone}>{text}</Badge>}
                  <small>{t.detail ?? (t.sourceOfLive === 'tracker' ? 'The live map uses this tracker' : t.sourceOfLive === 'phone' ? 'The live map uses the driver\'s phone' : `Last heard ${ago(t.lastSeenAt)}`)}</small>
                </>
              );
            },
          },
          {
            key: 'lastFix', label: 'Last position', render: (t) => (t.lastFix ? (
              <>
                <b>{Math.round(t.lastFix.speedKmh ?? 0)} km/h</b>
                <small>{ago(t.lastFix.recordedAt)}{t.info.satellites !== undefined ? ` · ${t.info.satellites} sat` : ''}{t.info.ignition !== undefined ? ` · ignition ${t.info.ignition ? 'on' : 'off'}` : ''}</small>
              </>
            ) : <span className="muted">—</span>),
          },
          { key: 'accepted', label: 'Positions', align: 'right', render: (t) => <>{t.accepted}<small>{t.rejected ? `${t.rejected} rejected` : ''}</small></> },
          {
            key: 'x', label: '', render: (t) => (
              <RowActions>
                <button className="link" onClick={() => setSetupFor({ tracker: t, key: null })}><Icon name="settings" size={13} />Setup</button>
                <button className="link" onClick={() => { setPrefill(null); setEdit(t); }}><Icon name="edit" size={13} />Edit</button>
                {(t.protocol === 'osmand' || t.protocol === 'auto') && <button className="link" onClick={() => newKey(t)}>New key</button>}
                <button className="link danger" onClick={() => remove(t)}><Icon name="trash" size={13} />Remove</button>
              </RowActions>
            ),
          },
        ]}
      />
      {edit && (
        <TrackerForm
          token={token}
          tracker={edit === 'new' ? null : edit}
          buses={buses}
          prefill={prefill}
          onClose={() => setEdit(null)}
          onSaved={(r) => { setEdit(null); refresh(); if (r.key) setSetupFor({ tracker: r.tracker, key: r.key }); }}
        />
      )}
      {setupFor && setup && <SetupModal tracker={setupFor.tracker} keyValue={setupFor.key} setup={setup} onClose={() => setSetupFor(null)} />}
    </>
  );
}
