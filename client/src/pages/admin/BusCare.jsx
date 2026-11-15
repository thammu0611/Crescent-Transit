import { useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { date, daysAgo, rupees, today } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { DetailView, Figure } from '../../components/adminkit.jsx';
import Icon from '../../components/Icon.jsx';
import { readDocument } from '../../../../shared/docscan.js';
import { Badge, Dropdown, Empty, ErrorText, Field, ListCard, Notice, Page, Panel, Segmented, Stat, Table } from '../../components/ui.jsx';

const DOC_TEXT = { INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PERMIT: 'Permit', PUC: 'PUC' };
const DOC_TONE = { OK: 'live', SOON: 'delayed', EXPIRED: 'danger', MISSING: 'offline' };
const SERVICE_TONE = { OK: 'live', SOON: 'delayed', DUE: 'danger', UNKNOWN: 'offline' };
/** The row's colour: its worst document or service state. */
const rowTone = (b) => {
  const tones = [...b.documents.map((d) => DOC_TONE[d.state]), SERVICE_TONE[b.serviceState]];
  return tones.includes('danger') ? 'danger' : tones.includes('delayed') ? 'delayed' : tones.every((x) => x === 'live') ? 'live' : 'offline';
};
const docLabel = (d) => (d.state === 'MISSING' ? 'Not added' : d.state === 'EXPIRED' ? `Expired ${date(d.expiresOn)}` : d.state === 'SOON' ? `${d.daysLeft} days left` : date(d.expiresOn));
const serviceLabel = (b) => (b.serviceState === 'UNKNOWN' ? 'Add readings' : b.kmLeft <= 0 ? `Overdue ${-b.kmLeft} km` : `${b.kmLeft} km left`);

const DOC_ICON = { INSURANCE: 'shield', FITNESS: 'check', PERMIT: 'card', PUC: 'signal' };
/** A paper's state from its expiry date: text for the tile and its tone. */
function docState(iso) {
  if (!iso) return { text: 'Not added', tone: '' };
  const days = Math.round((Date.parse(iso) - Date.parse(today())) / 86400000);
  if (Number.isNaN(days)) return { text: '—', tone: '' };
  if (days < 0) return { text: 'Expired', tone: 'danger' };
  if (days === 0) return { text: 'Today', tone: 'danger' };
  if (days <= 30) return { text: `${days} day${days === 1 ? '' : 's'}`, tone: 'delayed' };
  return { text: 'Valid', tone: 'live' };
}

const KIND_TEXT = { ...DOC_TEXT, SERVICE: 'Service bill' };
/** How an expiry date stands today, shown under its box. */
function expiryNote(iso) {
  if (!iso) return null;
  const days = Math.round((Date.parse(iso) - Date.parse(today())) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return <Badge tone="danger">Expired {-days} day{days === -1 ? '' : 's'} ago</Badge>;
  if (days === 0) return <Badge tone="danger">Expires today</Badge>;
  if (days <= 30) return <Badge tone="delayed">{days} day{days === 1 ? '' : 's'} left</Badge>;
  return <Badge tone="live">Valid · {days} days left</Badge>;
}

/**
 * Drop or pick documents (PDF or photo): each is read in the browser and the
 * boxes it can answer are filled in and highlighted, for the person to check.
 */
function DocumentDrop({ onRead }) {
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const update = (id, patch) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const readOne = async (file) => {
    const id = `${file.name}-${file.size}-${Date.now()}`;
    setFiles((list) => [...list, { id, name: file.name, status: 'reading', progress: 0 }]);
    try {
      const { documentText } = await import('../../lib/docText.js');
      const text = await documentText(file, (p) => update(id, { progress: p }));
      const result = readDocument(text);
      update(id, { status: result.kind ? 'done' : 'unknown', result, text });
      if (result.kind) onRead(result, file.name);
    } catch (err) {
      update(id, { status: 'error', message: err.message || 'That file could not be read' });
    }
  };
  const take = (list) => { for (const f of Array.from(list ?? [])) readOne(f); };
  const choose = (id, kind) => {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    const result = readDocument(f.text, kind);
    update(id, { status: 'done', result });
    onRead(result, f.name);
  };
  return (
    <div className="doc-drop-wrap">
      <button
        type="button"
        className={`doc-drop${over ? ' over' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      >
        <span className="doc-drop-icon" aria-hidden="true"><Icon name="upload" size={22} /></span>
        <span className="doc-drop-text">
          <b>Upload a document to fill this in</b>
          <small>Insurance, fitness certificate, permit, PUC or a service bill · PDF or photo · read on this computer, not stored</small>
        </span>
      </button>
      <input ref={input} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      {files.length > 0 && (
        <ul className="doc-files">
          {files.map((f) => (
            <li key={f.id} className={f.status}>
              <Icon name={f.status === 'done' ? 'tick' : f.status === 'reading' ? 'clock' : 'alert'} size={16} />
              <span className="doc-file-main">
                <b>{f.name}</b>
                {f.status === 'reading' && <><small>Reading… {Math.round((f.progress ?? 0) * 100)}%</small><i className="doc-meter"><s style={{ width: `${Math.max(6, (f.progress ?? 0) * 100)}%` }} /></i></>}
                {f.status === 'done' && (
                  <small>
                    {KIND_TEXT[f.result.kind]}
                    {f.result.number ? ` · No. ${f.result.number}` : ''}
                    {f.result.expiresOn ? ` · expires ${date(f.result.expiresOn)}` : ''}
                    {f.result.odometerKm ? ` · ${f.result.odometerKm.toLocaleString('en-IN')} km` : ''}
                    {f.result.serviceOn ? ` · serviced ${date(f.result.serviceOn)}` : ''}
                    {f.result.registration ? ` · vehicle ${f.result.registration}` : ''}
                    {f.result.confidence !== 'high' ? ' · check the boxes, some could not be read' : ''}
                  </small>
                )}
                {f.status === 'error' && <small>{f.message}</small>}
                {f.status === 'unknown' && (
                  <small className="doc-ask">
                    Which document is this?{' '}
                    <select defaultValue="" onChange={(e) => e.target.value && choose(f.id, e.target.value)} aria-label="Document kind">
                      <option value="">Choose…</option>
                      {Object.entries(KIND_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </small>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BusEditor({ token, bus, onClose, onSaved }) {
  const [docs, setDocs] = useState(() => Object.fromEntries(bus.documents.map((d) => [d.kind, { number: d.number ?? '', expiresOn: d.expiresOn ?? '' }])));
  const [service, setService] = useState({ odometerKm: bus.odometerKm ?? '', serviceIntervalKm: bus.serviceIntervalKm ?? 10000, lastServiceKm: bus.lastServiceKm ?? '', lastServiceOn: bus.lastServiceOn ?? '' });
  // Boxes filled from an uploaded document, highlighted until edited.
  const [filled, setFilled] = useState(() => new Set());
  const a = useAction();
  const unmark = (key) => setFilled((f) => { if (!f.has(key)) return f; const n = new Set(f); n.delete(key); return n; });
  const setDoc = (kind, k) => (e) => { unmark(`${kind}.${k}`); setDocs((d) => ({ ...d, [kind]: { ...d[kind], [k]: e.target.value } })); };
  const set = (k) => (e) => { unmark(k); setService((s) => ({ ...s, [k]: e.target.value })); };
  const hl = (key) => (filled.has(key) ? 'autofilled' : undefined);
  const nextKm = service.lastServiceKm !== '' && service.serviceIntervalKm ? Number(service.lastServiceKm) + Number(service.serviceIntervalKm) : null;
  const kmLeft = nextKm != null && service.odometerKm !== '' ? nextKm - Number(service.odometerKm) : null;
  const serviceNow = kmLeft == null ? { text: 'Add readings', tone: '' } : kmLeft <= 0 ? { text: `Overdue ${(-kmLeft).toLocaleString('en-IN')} km`, tone: 'danger' } : kmLeft <= 500 ? { text: `${kmLeft} km left`, tone: 'delayed' } : { text: `${kmLeft.toLocaleString('en-IN')} km left`, tone: 'live' };
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
        lastServiceKm: r.odometerKm ?? s.lastServiceKm,
        lastServiceOn: r.serviceOn ?? s.lastServiceOn,
        // The odometer never goes backwards: a newer bill moves it forward.
        odometerKm: r.odometerKm && (s.odometerKm === '' || r.odometerKm > Number(s.odometerKm)) ? r.odometerKm : s.odometerKm,
      }));
      if (r.odometerKm) keys.push('lastServiceKm', 'odometerKm');
      if (r.serviceOn) keys.push('lastServiceOn');
    } else if (r.odometerKm) {
      setService((s) => ({ ...s, odometerKm: s.odometerKm === '' || r.odometerKm > Number(s.odometerKm) ? r.odometerKm : s.odometerKm }));
      keys.push('odometerKm');
    }
    setFilled((f) => new Set([...f, ...keys]));
  };
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
    <DetailView
      title={bus.fleetCode}
      subtitle={`${bus.routeCode ? `Route ${bus.routeCode} · ` : ''}documents and service`}
      onClose={onClose}
      actions={<button type="submit" form="bus-care-form" className="btn primary" disabled={a.busy}><Icon name="tick" size={16} /> {a.busy ? 'Saving…' : 'Save'}</button>}
    >
      {/* At a glance: every paper and the service, as they stand with what is on this page. */}
      <div className="kit-stats care-stats">
        {bus.documents.map((d) => {
          const st = docState(docs[d.kind].expiresOn);
          return <Stat key={d.kind} icon={DOC_ICON[d.kind]} label={DOC_TEXT[d.kind]} value={st.text} tone={st.tone} color={st.tone ? undefined : 'slate'} />;
        })}
        <Stat icon="clock" label="Service" value={serviceNow.text} tone={serviceNow.tone} color={serviceNow.tone ? undefined : 'slate'} />
        <Stat icon="route" label="Odometer" value={service.odometerKm === '' ? '—' : `${Number(service.odometerKm).toLocaleString('en-IN')} km`} color="navy" />
      </div>

      <form id="bus-care-form" onSubmit={save} className="care-form">
        <Panel title="Fill in from a document" icon="upload">
          <DocumentDrop onRead={fromDocument} />
          {filled.size > 0 && <p className="autofill-note"><Icon name="sparkle" size={15} /> Filled from your document - check the highlighted boxes, then save.</p>}
        </Panel>

        <Panel title="Documents" icon="shield" summary="Reminders go out 30, 15, 7, 3 and 1 days before expiry, then every day once expired">
          {bus.documents.map((d) => (
            <div className="grid2 care-row" key={d.kind}>
              <Field label={`${DOC_TEXT[d.kind]} number`}><input className={hl(`${d.kind}.number`)} value={docs[d.kind].number} maxLength={40} onChange={setDoc(d.kind, 'number')} /></Field>
              <Field label="Expires on">
                <input className={hl(`${d.kind}.expiresOn`)} type="date" value={docs[d.kind].expiresOn} onChange={setDoc(d.kind, 'expiresOn')} />
                <span className="expiry-note">{expiryNote(docs[d.kind].expiresOn)}</span>
              </Field>
            </div>
          ))}
        </Panel>

        <Panel title="Service and odometer" icon="bus" summary="The odometer goes up by itself after each trip, from the bus GPS">
          <div className="grid2 care-row">
            <Field label="Odometer now (km)" hint={bus.odometerGpsKm ? `Includes ${bus.odometerGpsKm.toLocaleString('en-IN')} km added from GPS trips since the last reading` : undefined}>
              <input className={hl('odometerKm')} type="number" min="0" value={service.odometerKm} onChange={set('odometerKm')} />
            </Field>
            <Field label="Service every (km)"><input type="number" min="0" value={service.serviceIntervalKm} onChange={set('serviceIntervalKm')} /></Field>
          </div>
          <div className="grid2 care-row">
            <Field label="Reading at last service (km)"><input className={hl('lastServiceKm')} type="number" min="0" value={service.lastServiceKm} onChange={set('lastServiceKm')} /></Field>
            <Field label="Last serviced on"><input className={hl('lastServiceOn')} type="date" value={service.lastServiceOn} onChange={set('lastServiceOn')} /></Field>
          </div>
        </Panel>

        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary care-save" disabled={a.busy}><Icon name="tick" size={16} /> {a.busy ? 'Saving…' : 'Save documents and service'}</button>
      </form>
    </DetailView>
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
                tone={rowTone(b)}
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
