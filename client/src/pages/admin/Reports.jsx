import { useMemo, useState } from 'react';
import { api, download } from '../../lib/api.js';
import { METHOD_TEXT, daysAgo, thisMonth, today } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Block, Chips, ColumnChart, HBars, dayLabel } from '../../components/adminkit.jsx';
import { Badge, ErrorText, Field, FoldPanel, Modal, Page, Stat, Table, YesNo } from '../../components/ui.jsx';

const STATUS_TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'offline', REJECTED: 'offline', VOID: 'danger' };
const statusText = (s) => s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Bars({ rows, value, label, max, unit = '' }) {
  return <HBars rows={rows} value={value} label={label} max={max} unit={unit} />;
}

/** ETA mean absolute error (doc 7.3): target under 3 minutes. */
function EtaAccuracy({ token, q }) {
  const { data, error } = useAsync(() => api(`/api/reports/eta-accuracy?${q}`, { token }), [q, token]);
  if (error) return <ErrorText>{error.message}</ErrorText>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="kit-stats">
        <Stat label="Overall MAE" value={data.overall.maeMin == null ? '—' : `${data.overall.maeMin} min`} tone={data.overall.maeMin != null && data.overall.maeMin <= data.targetMin ? 'live' : 'delayed'} />
        <Stat label="Predictions scored" value={data.overall.n} />
        <Stat label="Target" value={`< ${data.targetMin} min`} />
      </div>
      <p className="muted">Each minute the server logs its prediction for the next three stops; when the bus reaches the stop the error is |actual − predicted|.</p>
      <div className="cols">
        <div className="col"><h4>By route</h4><Bars rows={data.byRoute} label={(r) => `${r.key} (${r.n})`} value={(r) => r.maeMin} unit=" min" /></div>
        <div className="col">
          <h4>By method</h4><Bars rows={data.byMethod} label={(r) => `${r.key} (${r.n})`} value={(r) => r.maeMin} unit=" min" />
          <h4>By how far ahead</h4><Bars rows={data.byLead} label={(r) => `${r.key} (${r.n})`} value={(r) => r.maeMin} unit=" min" />
          <h4>By hour</h4><Bars rows={data.byHour} label={(r) => `${r.key} (${r.n})`} value={(r) => r.maeMin} unit=" min" />
        </div>
      </div>
    </>
  );
}

/** Precision and recall against a hand-taken register (doc 9.9). */
function AccuracyUpload({ token }) {
  const [csv, setCsv] = useState('trip_id,username\n');
  const a = useAction();
  const [result, setResult] = useState(null);
  return (
    <>
      <p className="muted">Paste the manual register taken on the same trips: one row per student seen on the bus.</p>
      <textarea className="full mono" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="Manual register CSV" />
      <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0]?.text().then(setCsv)} aria-label="Upload CSV" />
      <button className="btn primary" disabled={a.busy} onClick={() => a.run(() => api('/api/reports/attendance-accuracy', { token, body: { csv } })).then((r) => r && setResult(r))}>Compare</button>
      <ErrorText>{a.error}</ErrorText>
      {result && (
        <>
          <div className="kit-stats">
            <Stat label={`Precision (≥ ${result.targets.precisionPct}%)`} value={result.precisionPct == null ? '—' : `${result.precisionPct}%`} tone={result.precisionPct >= result.targets.precisionPct ? 'live' : 'delayed'} />
            <Stat label={`Recall (≥ ${result.targets.recallPct}%)`} value={result.recallPct == null ? '—' : `${result.recallPct}%`} tone={result.recallPct >= result.targets.recallPct ? 'live' : 'delayed'} />
            <Stat label="Prompt response" value={result.promptResponsePct == null ? '—' : `${result.promptResponsePct}%`} />
            <Stat label="Provisional share" value={result.provisionalSharePct == null ? '—' : `${result.provisionalSharePct}%`} />
          </div>
          <p className="muted">
            {result.trips} trips · TP {result.truePositives} · FP {result.falsePositives} · FN {result.falseNegatives} · false prompts (answered No) {result.falsePrompts}
          </p>
          {result.falsePositiveList.length > 0 && <p className="muted">Marked but not seen: {result.falsePositiveList.join(', ')}</p>}
          {result.falseNegativeList.length > 0 && <p className="muted">Seen but not marked: {result.falseNegativeList.join(', ')}</p>}
        </>
      )}
    </>
  );
}


const SECTIONS = [
  { value: 'register', label: 'Attendance register' },
  { value: 'demand', label: 'Stop demand' },
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'exceptions', label: 'Exceptions' },
  { value: 'leakage', label: 'Leakage' },
  { value: 'eta', label: 'ETA accuracy' },
  { value: 'accuracy', label: 'Attendance accuracy' },
];
const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];
const loading = <div className="skeleton-block" />;

/** Register rows grouped by bus, each with a per-student summary. */
function byBus(rows) {
  const buses = new Map();
  for (const r of rows) {
    if (!buses.has(r.bus)) buses.set(r.bus, { bus: r.bus, route: r.route, rows: [], students: new Map() });
    const b = buses.get(r.bus);
    b.rows.push(r);
    const st = b.students.get(r.username) ?? { username: r.username, name: r.full_name, reg: r.register_no, dept: r.department, trips: 0, present: 0, last: null };
    st.trips += 1;
    if (r.present) st.present += 1;
    const when = `${r.date} ${r.boarded ?? ''}`;
    if (!st.last || when > st.last) st.last = when;
    b.students.set(r.username, st);
  }
  return [...buses.values()]
    .map((b) => ({ ...b, students: [...b.students.values()].sort((x, y) => x.name.localeCompare(y.name)), present: b.rows.filter((r) => r.present).length }))
    .sort((x, y) => x.bus.localeCompare(y.bus, undefined, { numeric: true }));
}

/** One bus's attendance report: its students, then every record. */
function BusRegister({ group, onRow, onCsv }) {
  return (
    <FoldPanel
      icon="bus"
      title={`${group.bus} · Route ${group.route}`}
      summary={`${group.students.length} student${group.students.length === 1 ? '' : 's'} · ${group.rows.length} record${group.rows.length === 1 ? '' : 's'} · ${group.present} present`}
      badge={<Badge tone="live">{group.present}/{group.rows.length}</Badge>}
    >
      <div className="bus-register-bar">
        <span className="muted">Students on this bus and every record in the period. Click a record for details.</span>
        <button type="button" className="btn ghost inline" onClick={onCsv}><Icon name="download" size={14} />CSV for {group.bus}</button>
      </div>
      <Table
        rows={group.students}
        rowKey={(st) => st.username}
        columns={[
          { key: 'name', label: 'Student', render: (st) => <><b>{st.name}</b><small>{[st.reg ?? st.username, st.dept].filter(Boolean).join(' · ')}</small></> },
          { key: 'present', label: 'Present', align: 'right', render: (st) => `${st.present} of ${st.trips}` },
          { key: 'rate', label: 'Rate', align: 'right', render: (st) => <Badge tone={st.present === st.trips ? 'live' : st.present ? 'delayed' : 'danger'}>{Math.round((st.present / st.trips) * 100)}%</Badge> },
          { key: 'last', label: 'Last boarded', render: (st) => st.last },
        ]}
      />
      <Table
        rows={group.rows}
        rowKey={(r) => `${r.trip_id}:${r.username}`}
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'full_name', label: 'Student', render: (r) => <button type="button" className="kit-name-btn" onClick={() => onRow(r)}><b>{r.full_name}</b><small>{r.register_no ?? r.username}</small></button> },
          { key: 'boarded', label: 'Boarded', render: (r) => <>{r.boarded ?? '—'}<small>{r.boarding_stop ?? ''}</small></> },
          { key: 'alighted', label: 'Alighted', render: (r) => <>{r.alighted ?? '—'}<small>{r.alighting_stop ?? ''}</small></> },
          { key: 'method', label: 'Method', render: (r) => METHOD_TEXT[r.method] ?? r.method },
          { key: 'status', label: 'Status', render: (r) => <><Badge tone={STATUS_TONE[r.status] ?? 'offline'}>{statusText(r.status)}{r.auto_confirmed ? ' (auto)' : ''}</Badge>{r.flagged && <> <Badge tone="danger">flag</Badge></>}</> },
          { key: 'present', label: 'Present', render: (r) => <YesNo value={r.present} /> },
        ]}
      />
    </FoldPanel>
  );
}
const CsvButton = ({ title = 'Export CSV', onClick }) => <button className="btn ghost inline" onClick={onClick}><Icon name="download" size={14} />{title}</button>;

export default function Reports() {
  const { token } = useSession();
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState({ from: daysAgo(29), to: today(), route: '' });
  const [tab, setTab] = useState('register');
  const [row, setRow] = useState(null);
  const q = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
  const [error, setError] = useState(null);
  const routes = useAsync(() => api('/api/routes'), []);
  const get = (path) => () => api(`${path}?${q}`, { token });
  const register = useAsync(tab === 'register' ? get('/api/reports/attendance') : async () => null, [tab, q]);
  const demand = useAsync(tab === 'demand' ? get('/api/reports/demand') : async () => null, [tab, q]);
  const occupancy = useAsync(tab === 'occupancy' ? get('/api/reports/occupancy') : async () => null, [tab, q]);
  const exceptions = useAsync(tab === 'exceptions' ? get('/api/reports/exceptions') : async () => null, [tab, q]);
  const leakage = useAsync(tab === 'leakage' ? get('/api/reports/leakage') : async () => null, [tab, q]);
  const csv = (path, name, extra = '') => download(`${path}?${q}&format=csv${extra}`, token, `${name}.csv`).catch((e) => setError(e.message));
  const loadError = [register, demand, occupancy, exceptions, leakage].find((x) => x.error)?.error?.message;

  const choosePreset = (p) => {
    setPreset(p);
    if (p === '7') setRange((r) => ({ ...r, from: daysAgo(6), to: today() }));
    if (p === '30') setRange((r) => ({ ...r, from: daysAgo(29), to: today() }));
    if (p === 'month') setRange((r) => ({ ...r, from: `${thisMonth()}-01`, to: today() }));
  };

  const reg = register.data;
  const regStats = useMemo(() => {
    if (!reg) return null;
    const byDay = {};
    for (const r of reg) if (r.present) byDay[r.date] = (byDay[r.date] ?? 0) + 1;
    return {
      present: reg.filter((r) => r.present).length,
      pending: reg.filter((r) => ['PROVISIONAL', 'DISPUTED'].includes(r.status)).length,
      flagged: reg.filter((r) => r.flagged).length,
      students: new Set(reg.map((r) => r.username)).size,
      days: Object.keys(byDay).sort().slice(-14).map((d) => ({ label: dayLabel(d), value: byDay[d] })),
    };
  }, [reg]);

  const regBuses = useMemo(() => (reg ? byBus(reg) : []), [reg]);

  const demandByStop = useMemo(() => Object.values((demand.data ?? []).reduce((m, r) => {
    const k = `${r.route}:${r.seq}`;
    m[k] = m[k] ?? { label: `${r.route} · ${r.stop}`, n: 0 };
    m[k].n += r.boardings;
    return m;
  }, {})).sort((a, b) => b.n - a.n).slice(0, 15), [demand.data]);
  const demandByHour = useMemo(() => Object.values((demand.data ?? []).reduce((m, r) => {
    m[r.hour] = m[r.hour] ?? { hour: r.hour, label: `${String(r.hour).padStart(2, '0')}:00`, value: 0 };
    m[r.hour].value += r.boardings;
    return m;
  }, {})).sort((a, b) => a.hour - b.hour), [demand.data]);
  const demandTotal = demandByHour.reduce((n, h) => n + h.value, 0);
  const peak = demandByHour.reduce((best, h) => (!best || h.value > best.value ? h : best), null);
  const busiest = demandByStop[0];

  const occ = occupancy.data;
  const occLoads = (occ ?? []).filter((r) => r.load_pct != null);
  const ex = exceptions.data;
  const leak = leakage.data;

  return (
    <Page eyebrow="Transport office" title="Reports" subtitle="Registers, demand, occupancy, exceptions and accuracy for any period and route." wide>
      <div className="kit-stack">
        <Block title="Filters" caption={`${range.from} to ${range.to}${range.route ? ` · route ${range.route}` : ' · all routes'}`}>
          <Chips value={preset} onChange={choosePreset} options={PRESETS} />
          <div className="form-row">
            {preset === 'custom' && <Field label="From"><input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>}
            {preset === 'custom' && <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>}
            <Field label="Route">
              <select value={range.route} onChange={(e) => setRange((r) => ({ ...r, route: e.target.value }))}>
                <option value="">All routes</option>
                {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
              </select>
            </Field>
          </div>
        </Block>

        <h2 className="kit-section-title">Report</h2>
        <Chips value={tab} onChange={setTab} options={SECTIONS} />
        <ErrorText>{error ?? loadError}</ErrorText>

        {tab === 'register' && (reg == null ? loading : (
          <>
            <div className="kit-stats">
              <Stat icon="list" label="Records" value={reg.length} />
              <Stat icon="check" label="Present" value={regStats.present} tone="live" />
              <Stat icon="users" label="Students" value={regStats.students} />
              <Stat icon="alert" label="Pending / flagged" value={`${regStats.pending} / ${regStats.flagged}`} tone={regStats.pending || regStats.flagged ? 'delayed' : ''} />
            </div>
            <Block title="Students present per day" caption="Most recent 14 days with boardings"><ColumnChart data={regStats.days} /></Block>
            <Block
              title="Attendance register by bus"
              caption={`${regBuses.length} bus${regBuses.length === 1 ? '' : 'es'} · ${reg.length} records · open a bus for its students and records`}
              actions={<><CsvButton title="CSV per trip" onClick={() => csv('/api/reports/attendance', 'attendance-register')} /><CsvButton title="CSV per student" onClick={() => csv('/api/reports/attendance', 'attendance-per-student', '&group=student')} /></>}
            >
              {regBuses.length === 0 ? <p className="muted">No attendance in this period.</p> : (
                <div className="bus-registers">
                  {regBuses.map((g) => (
                    <BusRegister
                      key={g.bus}
                      group={g}
                      onRow={setRow}
                      onCsv={() => download(`/api/reports/attendance?${new URLSearchParams({ from: range.from, to: range.to, route: g.route })}&format=csv`, token, `attendance-${g.bus}.csv`).catch((e) => setError(e.message))}
                    />
                  ))}
                </div>
              )}
            </Block>
          </>
        ))}

        {tab === 'demand' && (demand.data == null ? loading : (
          <>
            <div className="kit-stats three">
              <Stat icon="users" label="Boardings" value={demandTotal} />
              <Stat icon="clock" label="Peak hour" value={peak ? peak.label : '—'} />
              <Stat icon="pin" label="Busiest stop" value={busiest ? busiest.n : '—'} hint={busiest?.label} />
            </div>
            <div className="kit-grid-2">
              <Block title="Busiest boarding stops" caption="Top 15 by boardings" actions={<CsvButton title="CSV" onClick={() => csv('/api/reports/demand', 'stop-demand')} />}>
                <Bars rows={demandByStop} label={(r) => r.label} value={(r) => r.n} />
              </Block>
              <Block title="Boardings by hour" caption="Hour of the day (campus time)">
                <ColumnChart data={demandByHour.map((h) => ({ label: h.label.slice(0, 2), value: h.value }))} highlightLast={false} color="#2b8a3e" />
              </Block>
            </div>
          </>
        ))}

        {tab === 'occupancy' && (occ == null ? loading : (
          <>
            <div className="kit-stats">
              <Stat icon="bus" label="Trips" value={occ.length} />
              <Stat icon="chart" label="Average load" value={occLoads.length ? `${Math.round(occLoads.reduce((n, r) => n + r.load_pct, 0) / occLoads.length)}%` : '—'} />
              <Stat icon="alert" label="Over capacity" value={occ.filter((r) => r.load_pct > 100).length} tone={occ.some((r) => r.load_pct > 100) ? 'danger' : ''} />
              <Stat icon="users" label="Near full (> 85%)" value={occ.filter((r) => r.load_pct > 85 && r.load_pct <= 100).length} tone="delayed" />
            </div>
            <Block title="Occupancy against capacity" actions={<CsvButton title="CSV" onClick={() => csv('/api/reports/occupancy', 'occupancy')} />}>
              <Table
                rows={occ}
                rowKey={(r) => r.trip_id}
                empty="No trips in this period."
                columns={[
                  { key: 'started', label: 'Started' },
                  { key: 'route', label: 'Route', render: (r) => <span className="route-code sm">{r.route}</span> },
                  { key: 'bus', label: 'Bus' },
                  { key: 'travelled', label: 'Riders', align: 'right' },
                  { key: 'capacity', label: 'Seats', align: 'right' },
                  { key: 'load_pct', label: 'Load', render: (r) => <Badge tone={r.load_pct > 100 ? 'danger' : r.load_pct > 85 ? 'delayed' : 'live'}>{r.load_pct ?? '—'}%</Badge> },
                  { key: 'driver_reported', label: 'Driver chip', render: (r) => r.driver_reported ?? '—' },
                ]}
              />
            </Block>
          </>
        ))}

        {tab === 'exceptions' && (ex == null ? loading : (
          <>
            <div className="kit-stats">
              <Stat icon="alert" label="Provisional / flagged" value={ex.provisionalOrFlagged.length} tone={ex.provisionalOrFlagged.length ? 'delayed' : ''} />
              <Stat icon="edit" label="Manual overrides" value={ex.manualOverrides.length} />
              <Stat icon="signal" label="System incidents" value={ex.systemIncidents.length} tone={ex.systemIncidents.length ? 'danger' : ''} />
              <Stat icon="shield" label="Flagged devices" value={ex.flaggedDevices.length} tone={ex.flaggedDevices.length ? 'danger' : ''} />
            </div>
            <div className="kit-grid-2">
              <Block title="Provisional, auto-confirmed or flagged records">
                <Table rows={ex.provisionalOrFlagged} rowKey={(r) => r.attendance_id} empty="None in this period." columns={[{ key: 'username', label: 'Student' }, { key: 'trip_id', label: 'Trip' }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.flagged ? 'danger' : 'delayed'}>{r.flag_reason ?? `${statusText(r.status)}${r.auto_confirmed ? ' · auto' : ''}`}</Badge> }]} />
              </Block>
              <Block title="Manual overrides">
                <Table rows={ex.manualOverrides} rowKey={(r, i) => i} empty="No overrides in this period." columns={[{ key: 'username', label: 'Student' }, { key: 'trip_id', label: 'Trip' }, { key: 'detail', label: 'By / reason', wrap: true }]} />
              </Block>
              <Block title="System incidents" caption="Capacity, tracker, conflicts and mock location">
                <Table rows={ex.systemIncidents} empty="No system incidents." columns={[{ key: 'kind', label: 'Kind', render: (r) => statusText(r.kind) }, { key: 'message', label: 'Detail', wrap: true }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'OPEN' ? 'danger' : 'offline'}>{statusText(r.status)}</Badge> }]} />
              </Block>
              <Block title="Flagged devices and trips">
                <Table rows={ex.flaggedDevices} rowKey={(r) => r.username} empty="No mock-location devices." columns={[{ key: 'username', label: 'Student' }, { key: 'platform', label: 'Phone' }]} />
                <Table rows={ex.flaggedTrips} rowKey={(r) => r.trip_id} empty="No flagged trips." columns={[{ key: 'trip_id', label: 'Trip' }, { key: 'route', label: 'Route' }, { key: 'flag_reason', label: 'Reason', wrap: true }]} />
              </Block>
            </div>
          </>
        ))}

        {tab === 'leakage' && (leak == null ? loading : (
          <>
            <div className="kit-stats two">
              <Stat icon="alert" label="Rides without a pass" value={leak.length} tone={leak.length ? 'danger' : 'live'} />
              <Stat icon="users" label="Students" value={new Set(leak.map((r) => r.username)).size} />
            </div>
            <Block title="Travelled without a subscription" caption="Recorded on a bus (by QR or the driver) with no subscription covering that day." actions={<CsvButton title="CSV" onClick={() => csv('/api/reports/leakage', 'subscriber-vs-traveller')} />}>
              <Table rows={leak} rowKey={(r) => `${r.trip_id}:${r.username}`} empty="Nobody travelled without a pass in this period." columns={[{ key: 'date', label: 'Date' }, { key: 'full_name', label: 'Student', render: (r) => <><b>{r.full_name}</b><small>{r.register_no ?? r.username}</small></> }, { key: 'route', label: 'Route', render: (r) => <span className="route-code sm">{r.route}</span> }, { key: 'method', label: 'Method', render: (r) => METHOD_TEXT[r.method] ?? r.method }, { key: 'trip_id', label: 'Trip', align: 'right' }]} />
            </Block>
          </>
        ))}

        {tab === 'eta' && <Block title="ETA accuracy (mean absolute error)"><EtaAccuracy token={token} q={q} /></Block>}
        {tab === 'accuracy' && <Block title="Attendance accuracy against a manual register"><AccuracyUpload token={token} /></Block>}
      </div>

      {row && (
        <Modal title={row.full_name} onClose={() => setRow(null)} width={520}>
          <dl className="kit-kv">
            <div><dt>Student</dt><dd>{row.register_no ?? row.username}{row.department ? ` · ${row.department}` : ''}</dd></div>
            <div><dt>Date</dt><dd>{row.date}</dd></div>
            <div><dt>Route / bus</dt><dd>{row.route} · {row.bus}</dd></div>
            <div><dt>Trip</dt><dd>#{row.trip_id}</dd></div>
            <div><dt>Status</dt><dd><Badge tone={STATUS_TONE[row.status] ?? 'offline'}>{statusText(row.status)}{row.auto_confirmed ? ' (auto)' : ''}</Badge></dd></div>
            <div><dt>Method</dt><dd>{METHOD_TEXT[row.method] ?? row.method}</dd></div>
            <div><dt>Boarded</dt><dd>{row.boarded ?? '—'} {row.boarding_stop ?? ''}</dd></div>
            <div><dt>Alighted</dt><dd>{row.alighted ?? '—'} {row.alighting_stop ?? ''}</dd></div>
            <div><dt>Present</dt><dd><YesNo value={row.present} /></dd></div>
          </dl>
        </Modal>
      )}
    </Page>
  );
}
