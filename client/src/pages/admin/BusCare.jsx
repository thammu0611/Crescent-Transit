import { useState } from 'react';
import { api } from '../../lib/api.js';
import { date, daysAgo, rupees, today } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { Figure } from '../../components/adminkit.jsx';
import { Badge, Dropdown, Empty, ErrorText, Field, ListCard, Modal, Notice, Page, Panel, Segmented, Stat, Table } from '../../components/ui.jsx';

const DOC_TEXT = { INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PERMIT: 'Permit', PUC: 'PUC' };
const DOC_TONE = { OK: 'live', SOON: 'delayed', EXPIRED: 'danger', MISSING: 'offline' };
const SERVICE_TONE = { OK: 'live', SOON: 'delayed', DUE: 'danger', UNKNOWN: 'offline' };
const docLabel = (d) => (d.state === 'MISSING' ? 'Not added' : d.state === 'EXPIRED' ? `Expired ${date(d.expiresOn)}` : d.state === 'SOON' ? `${d.daysLeft} days left` : date(d.expiresOn));
const serviceLabel = (b) => (b.serviceState === 'UNKNOWN' ? 'Add readings' : b.kmLeft <= 0 ? `Overdue ${-b.kmLeft} km` : `${b.kmLeft} km left`);

function BusEditor({ token, bus, onClose, onSaved }) {
  const [docs, setDocs] = useState(() => Object.fromEntries(bus.documents.map((d) => [d.kind, { number: d.number ?? '', expiresOn: d.expiresOn ?? '' }])));
  const [service, setService] = useState({ odometerKm: bus.odometerKm ?? '', serviceIntervalKm: bus.serviceIntervalKm ?? 10000, lastServiceKm: bus.lastServiceKm ?? '', lastServiceOn: bus.lastServiceOn ?? '' });
  const a = useAction();
  const setDoc = (kind, k) => (e) => setDocs((d) => ({ ...d, [kind]: { ...d[kind], [k]: e.target.value } }));
  const set = (k) => (e) => setService((s) => ({ ...s, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      for (const [kind, d] of Object.entries(docs)) {
        if (d.expiresOn) await api(`/api/admin/buses/${bus.id}/documents/${kind}`, { token, method: 'PUT', body: d });
      }
      const body = {};
      for (const k of ['odometerKm', 'serviceIntervalKm', 'lastServiceKm']) if (service[k] !== '') body[k] = Number(service[k]);
      if (service.lastServiceOn) body.lastServiceOn = service.lastServiceOn;
      if (Object.keys(body).length) await api(`/api/admin/buses/${bus.id}/service`, { token, method: 'PUT', body });
      return true;
    }).then((r) => r && onSaved());
  };
  return (
    <Modal title={`${bus.fleetCode} documents and service`} onClose={onClose} width={620}>
      <form onSubmit={save}>
        {bus.documents.map((d) => (
          <div className="grid2" key={d.kind}>
            <Field label={`${DOC_TEXT[d.kind]} number`}><input value={docs[d.kind].number} maxLength={40} onChange={setDoc(d.kind, 'number')} /></Field>
            <Field label="Expires on"><input type="date" value={docs[d.kind].expiresOn} onChange={setDoc(d.kind, 'expiresOn')} /></Field>
          </div>
        ))}
        <div className="grid2">
          <Field label="Odometer now (km)"><input type="number" min="0" value={service.odometerKm} onChange={set('odometerKm')} /></Field>
          <Field label="Service every (km)"><input type="number" min="0" value={service.serviceIntervalKm} onChange={set('serviceIntervalKm')} /></Field>
        </div>
        <div className="grid2">
          <Field label="Reading at last service (km)"><input type="number" min="0" value={service.lastServiceKm} onChange={set('lastServiceKm')} /></Field>
          <Field label="Last serviced on"><input type="date" value={service.lastServiceOn} onChange={set('lastServiceOn')} /></Field>
        </div>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>Save</button>
      </form>
    </Modal>
  );
}

function Documents({ token }) {
  const list = useAsync(() => api('/api/admin/fleet-care', { token }), [token]);
  const [open, setOpen] = useState(null);
  // Buses that need something first, the rest by fleet number.
  const urgency = (b) => (b.serviceState === 'DUE' || b.documents.some((d) => d.state === 'EXPIRED') ? 0 : b.serviceState === 'SOON' || b.documents.some((d) => d.state === 'SOON') ? 1 : b.documents.some((d) => d.state === 'OK') ? 2 : 3);
  const rows = [...(list.data ?? [])].sort((a, b) => urgency(a) - urgency(b));
  const alerting = rows.filter((b) => b.serviceState === 'DUE' || b.serviceState === 'SOON' || b.documents.some((d) => d.state === 'EXPIRED' || d.state === 'SOON')).length;
  const missing = rows.filter((b) => b.documents.some((d) => d.state === 'MISSING')).length;
  return (
    <>
      <div className="kit-stats three">
        <Stat icon="bus" label="Buses" value={list.data ? rows.length : null} />
        <Stat icon="alert" label="Need attention" value={list.data ? alerting : null} tone={alerting ? 'danger' : ''} />
        <Stat icon="list" label="Documents missing" value={list.data ? missing : null} tone={missing ? 'delayed' : ''} />
      </div>
      <Panel title="Documents and service" icon="shield" summary="Reminders go out 30 and 7 days before expiry">
        <ErrorText>{list.error?.message}</ErrorText>
        {list.data == null ? <div className="skeleton-block" /> : (
          <div className="kit-list">
            {rows.map((b) => (
              <ListCard
                key={b.id}
                lead={<span className="route-code sm">{b.routeCode ?? '—'}</span>}
                title={b.fleetCode}
                lines={[b.odometerKm != null ? `${b.odometerKm.toLocaleString('en-IN')} km` : 'Odometer not entered']}
                onClick={() => setOpen(b)}
                side={(
                  <span className="care-badges">
                    {b.documents.map((d) => <Badge key={d.kind} tone={DOC_TONE[d.state]}>{d.kind === 'FITNESS' ? 'FC' : d.kind === 'INSURANCE' ? 'Ins' : d.kind === 'PERMIT' ? 'Permit' : d.kind}: {docLabel(d)}</Badge>)}
                    <Badge tone={SERVICE_TONE[b.serviceState]}>Service: {serviceLabel(b)}</Badge>
                  </span>
                )}
              />
            ))}
          </div>
        )}
      </Panel>
      {open && <BusEditor token={token} bus={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function Fuel({ token }) {
  const [period, setPeriod] = useState('30');
  const q = new URLSearchParams({ from: daysAgo(Number(period) - 1), to: today() }).toString();
  const data = useAsync(() => api(`/api/admin/fuel?${q}`, { token }), [q, token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [form, setForm] = useState({ fleetCode: '', odometerKm: '', litres: '', costRupees: '' });
  const a = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = (e) => {
    e.preventDefault();
    a.run(() => api('/api/fuel', { token, body: { ...form, odometerKm: Number(form.odometerKm), litres: Number(form.litres), costRupees: Number(form.costRupees) } }), 'Fuel saved.')
      .then((r) => { if (r) { setForm((f) => ({ ...f, odometerKm: '', litres: '', costRupees: '' })); data.reload(); } });
  };
  const r = data.data?.report;
  return (
    <>
      <div className="att-filters narrow">
        <Dropdown label="Period" icon="clock" value={period} onChange={setPeriod} resting="30" options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
      </div>
      <section className="kit-profile">
        <div className="kit-figures">
          <Figure value={r ? `${r.total.km.toLocaleString('en-IN')} km` : '…'} label="Distance" />
          <Figure value={r ? rupees(r.total.costPaise) : '…'} label="Fuel cost" />
          <Figure value={r?.total.costPerKmPaise != null ? rupees(r.total.costPerKmPaise) : '—'} label="Cost per km" />
          <Figure value={r ? rupees(r.plannedMonthlyPaise) : '…'} label="Planned monthly cost" />
        </div>
      </section>
      <Panel title="Cost per km by bus" icon="chart" summary="Each fill pays for the distance since the last one, so a bus needs two fills">
        <Table
          rows={r?.buses}
          rowKey={(b) => b.fleetCode}
          empty="No fuel entered in this period."
          columns={[
            { key: 'fleetCode', label: 'Bus', render: (b) => <><b>{b.fleetCode}</b><small>{b.routeCode ? `Route ${b.routeCode}` : ''}</small></> },
            { key: 'km', label: 'Distance', align: 'right', render: (b) => `${b.km.toLocaleString('en-IN')} km` },
            { key: 'litres', label: 'Litres', align: 'right' },
            { key: 'kmPerLitre', label: 'km per litre', align: 'right', render: (b) => b.kmPerLitre ?? '—' },
            { key: 'cost', label: 'Fuel cost', align: 'right', render: (b) => rupees(b.costPaise) },
            { key: 'perKm', label: 'Cost per km', align: 'right', render: (b) => (b.costPerKmPaise == null ? '—' : <b>{rupees(b.costPerKmPaise)}</b>) },
          ]}
        />
      </Panel>
      <Panel title="Add a fuel entry" icon="plus">
        <form className="form-row" onSubmit={add}>
          <Field label="Bus">
            <select value={form.fleetCode} onChange={set('fleetCode')} required>
              <option value="">Choose a bus</option>
              {(buses.data ?? []).map((b) => <option key={b.id} value={b.fleet_code}>{b.fleet_code}</option>)}
            </select>
          </Field>
          <Field label="Odometer (km)"><input type="number" min="0" value={form.odometerKm} onChange={set('odometerKm')} required /></Field>
          <Field label="Litres"><input type="number" min="0" step="0.01" value={form.litres} onChange={set('litres')} required /></Field>
          <Field label="Amount paid (₹)"><input type="number" min="0" step="0.01" value={form.costRupees} onChange={set('costRupees')} required /></Field>
          <button className="btn primary inline" disabled={a.busy}>Save fuel</button>
        </form>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
      </Panel>
    </>
  );
}

const scoreTone = (s) => (s == null ? 'offline' : s >= 80 ? 'live' : s >= 60 ? 'delayed' : 'danger');

function Scorecards({ token }) {
  const [days, setDays] = useState('30');
  const list = useAsync(() => api(`/api/admin/scorecards?days=${days}`, { token }), [days, token]);
  const rows = list.data ?? [];
  const scored = rows.filter((d) => d.score != null);
  return (
    <Panel title="Driver scorecards" icon="users" summary="Punctuality 50%, trip ratings 30%, safety 20%">
      <div className="att-filters narrow">
        <Dropdown label="Period" icon="clock" value={days} onChange={setDays} resting="30" options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
      </div>
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <div className="skeleton-block" /> : scored.length === 0 ? <Empty>No completed trips in this period.</Empty> : (
        <div className="kit-list">
          {scored.map((d) => (
            <ListCard
              key={d.id}
              lead={<span className={`score-ring ${scoreTone(d.score)}`}>{d.score}</span>}
              title={d.name}
              lines={[
                `${d.fleetCode ?? 'No bus'} · ${d.trips} trip${d.trips === 1 ? '' : 's'}`,
                `On time ${d.onTimePct == null ? '—' : `${d.onTimePct}%`} · Rating ${d.rating == null ? '—' : `${d.rating}/5`} · Speeding ${d.speeding} · Failed checks ${d.failedChecks}`,
              ]}
            />
          ))}
        </div>
      )}
      {list.data && rows.length > scored.length && <p className="fine-print">{rows.length - scored.length} driver{rows.length - scored.length === 1 ? ' has' : 's have'} no trips in this period.</p>}
    </Panel>
  );
}

function StopReview({ token }) {
  const list = useAsync(() => api('/api/admin/stop-suggestions', { token }), [token]);
  const rows = list.data ?? [];
  const [q, setQ] = useState('merge');
  const shown = rows.filter((s) => q === 'all' || s.mergeInto);
  return (
    <Panel title="Little-used stops" icon="pin" summary="No student lives here and 2 or fewer boardings in 30 days">
      <div className="att-filters narrow">
        <Dropdown label="Show" icon="list" value={q} onChange={setQ} options={[{ value: 'merge', label: 'Can be merged', count: rows.filter((s) => s.mergeInto).length }, { value: 'all', label: 'All little-used', count: rows.length }]} />
      </div>
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <div className="skeleton-block" /> : shown.length === 0 ? <Empty>Nothing to suggest.</Empty> : (
        <div className="kit-list">
          {shown.slice(0, 60).map((s) => (
            <ListCard
              key={`${s.routeCode}:${s.stopName}`}
              lead={<span className="route-code sm">{s.routeCode}</span>}
              title={s.stopName}
              lines={[s.suggestion]}
              side={<small>{s.boardings} boarding{s.boardings === 1 ? '' : 's'}</small>}
            />
          ))}
        </div>
      )}
      <p className="fine-print">These are suggestions from attendance data. Check with the route before changing stops.</p>
    </Panel>
  );
}

/** Keeping the fleet in order: papers, service, fuel, drivers and stops. */
export default function BusCare() {
  const { token } = useSession();
  const [tab, setTab] = useState('docs');
  return (
    <Page eyebrow="Transport office" title="Bus care" wide>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'docs', label: 'Documents and service' }, { value: 'fuel', label: 'Fuel' }, { value: 'drivers', label: 'Scorecards' }, { value: 'stops', label: 'Stops' }]} />
      {tab === 'docs' && <Documents token={token} />}
      {tab === 'fuel' && <Fuel token={token} />}
      {tab === 'drivers' && <Scorecards token={token} />}
      {tab === 'stops' && <StopReview token={token} />}
    </Page>
  );
}
