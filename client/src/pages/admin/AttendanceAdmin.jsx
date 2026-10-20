import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { METHOD_TEXT, STATUS_TEXT, date, dateTime, daysAgo, thisMonth, time, today } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Avatar, Chips, DetailView, Figure } from '../../components/adminkit.jsx';
import { Badge, Empty, ErrorText, Field, Modal, Notice, Page, Panel, SearchBox, Segmented, Stat, Table, YesNo } from '../../components/ui.jsx';

const DAY_TONE = { PRESENT: 'live', ABSENT: 'danger', PENDING: 'delayed' };
const DAY_COLOR = { PRESENT: 'var(--live)', ABSENT: 'var(--danger)', PENDING: 'var(--delayed)' };
const DAY_TEXT = { PRESENT: 'Present', ABSENT: 'Absent', PENDING: 'Pending review' };
const RECORD_TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'info', REJECTED: 'offline', VOID: 'danger' };
const RECORD_TEXT = { ...STATUS_TEXT, REJECTED: 'Said No', PROMPTED: 'Awaiting answer' };

/** One provisional or disputed record, with the evidence behind it (doc 9.8). */
function Review({ token, item, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  const decide = (decision) => a.run(() => api(`/api/admin/attendance/${item.attendance_id}/resolve`, { token, body: { decision, reason } })).then((r) => r && onDone());
  const disputed = item.status === 'DISPUTED';
  const spanS = item.first_match_at && item.last_match_at ? Math.round((new Date(item.last_match_at) - new Date(item.first_match_at)) / 1000) : null;
  return (
    <Modal title={`${item.full_name} · ${item.fleet_code} · trip #${item.trip_id}`} onClose={onClose} width={620}>
      {disputed ? (
        <p>
          <b>Dispute:</b> “{item.dispute_reason}” - the student says they were <b>{item.claimed_present ? 'on' : 'not on'}</b> the bus.
          Record was {STATUS_TEXT[item.previous_status]}.
        </p>
      ) : (
        <p>
          <b>Provisional:</b> the phone and the bus moved together{spanS != null ? ` for ${spanS} s` : ''} but the student did not answer the prompt.
          {item.flagged && <> <Badge tone="danger">{item.flag_reason ?? 'flagged'}</Badge> - never auto-confirms.</>}
        </p>
      )}
      <h3>Evidence</h3>
      <Table
        rows={item.evidence ?? []}
        empty="No stored evidence (manual or QR record)."
        columns={[
          { key: 'server_ts', label: 'Time', render: (e) => time(e.server_ts) },
          { key: 'event_type', label: 'Event' },
          { key: 'distance_m', label: 'Distance', render: (e) => (e.distance_m != null ? `${Math.round(e.distance_m)} m` : '—') },
          { key: 'speed_kmph', label: 'Speed', render: (e) => (e.speed_kmph != null ? `${Math.round(e.speed_kmph)} km/h` : '—') },
          { key: 'bearing_delta', label: 'Bearing Δ', render: (e) => (e.bearing_delta != null ? `${Math.round(e.bearing_delta)}°` : '—') },
          { key: 'detail', label: 'Detail' },
        ]}
      />
      <Field label="Reason (recorded with your decision)"><input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
      <ErrorText>{a.error}</ErrorText>
      <div className="btn-row spaced">
        {disputed ? (
          <>
            <button className="btn primary inline" disabled={a.busy || reason.length < 3} onClick={() => decide('PRESENT')}>Mark present</button>
            <button className="btn danger inline" disabled={a.busy || reason.length < 3} onClick={() => decide('ABSENT')}>Mark absent</button>
          </>
        ) : (
          <>
            <button className="btn primary inline" disabled={a.busy || reason.length < 3} onClick={() => decide('CONFIRM')}>Confirm present</button>
            <button className="btn danger inline" disabled={a.busy || reason.length < 3} onClick={() => decide('VOID')}>Void</button>
          </>
        )}
      </div>
    </Modal>
  );
}


const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];
const periodRange = (p) => {
  if (p === 'all') return { from: '2020-01-01', to: today() };
  if (p === 'month') return { from: `${thisMonth()}-01`, to: today() };
  return { from: daysAgo(Number(p) - 1), to: today() };
};

/** One student's attendance, date by date, with the phone binding. */
function StudentHistory({ token, student: initial, onClose, onUnbind }) {
  const [student, setStudent] = useState(initial);
  const [period, setPeriod] = useState('30');
  const [status, setStatus] = useState('');
  const q = new URLSearchParams(periodRange(period)).toString();
  const h = useAsync(() => api(`/api/admin/students/${student.id}/attendance?${q}`, { token }), [student.id, q, token]);
  const days = h.data?.days ?? null;
  const shown = days?.filter((d) => !status || d.status === status);
  const sm = h.data?.summary;
  const unbind = async () => {
    if (await onUnbind(student)) setStudent({ ...student, device: null, mock_location_flag: false });
  };
  return (
    <DetailView title={student.full_name} subtitle={`${student.register_no ?? student.username} · attendance history`} onClose={onClose}>
      <section className="kit-profile">
        <div className="kit-profile-top">
          <Avatar name={student.full_name} size={56} />
          <div>
            <h3>{student.full_name}</h3>
            <p>{[student.register_no, student.department, `@${student.username}`].filter(Boolean).join(' · ')}</p>
            <div className="kit-badges">
              <Badge tone={student.subscribed ? 'live' : 'danger'}>{student.subscribed ? 'Pass active' : 'No active pass'}</Badge>
              <Badge tone={student.location_consent ? 'info' : 'offline'}>{student.location_consent ? 'GPS consent' : 'No GPS consent'}</Badge>
            </div>
          </div>
        </div>
        <dl className="kit-kv">
          <div><dt>Route</dt><dd>{student.route_code ? `${student.route_code} · ${student.route_name ?? ''}` : '—'}</dd></div>
          <div><dt>Boarding stop</dt><dd>{student.home_stop ?? 'Not chosen'}</dd></div>
          <div><dt>Phone app</dt><dd>{student.device ? <>{student.device}{student.mock_location_flag && <> <Badge tone="danger">mock location</Badge></>} <button className="link" onClick={unbind}>Unbind</button></> : 'Not bound'}</dd></div>
          <div><dt>Contact</dt><dd>{student.phone ? <a href={`tel:${student.phone}`}>{student.phone}</a> : student.email ?? '—'}</dd></div>
        </dl>
        <div className="kit-divider" />
        <div className="kit-figures">
          <Figure value={sm ? (sm.attendancePct == null ? '—' : `${sm.attendancePct}%`) : '…'} label="Attendance" />
          <Figure value={sm?.present ?? '…'} label="Present days" />
          <Figure value={sm?.absent ?? '…'} label="Absent days" />
          <Figure value={sm?.trips ?? '…'} label="Trips" />
        </div>
        {sm?.lastBoardedAt && <p className="muted" style={{ margin: 0 }}>Last boarded {dateTime(sm.lastBoardedAt)}</p>}
      </section>

      <Chips value={period} onChange={setPeriod} options={PERIODS} />
      <Chips
        value={status}
        onChange={setStatus}
        options={[
          { value: '', label: 'All days', count: days?.length },
          { value: 'PRESENT', label: 'Present', count: sm?.present },
          { value: 'ABSENT', label: 'Absent', count: sm?.absent },
          { value: 'PENDING', label: 'Pending', count: sm?.pending },
        ]}
      />
      <p className="muted" style={{ margin: 0 }}>A day is listed when the student's route ran a trip or the student was recorded on any bus. Absent: the route ran and nothing was recorded.</p>
      <ErrorText>{h.error?.message}</ErrorText>
      {shown == null ? <div className="skeleton-block" /> : shown.length === 0 ? <Empty>No days in this period.</Empty> : shown.map((d) => (
        <article key={d.date} className="kit-day" style={{ '--tone': DAY_COLOR[d.status] }}>
          <div className="kit-day-top">
            <span><b>{date(`${d.date}T06:30:00Z`)}</b><small>{d.routeTrips ? `Route ran ${d.routeTrips} trip${d.routeTrips === 1 ? '' : 's'}` : 'Rode another route'}</small></span>
            <Badge tone={DAY_TONE[d.status]}>{DAY_TEXT[d.status]}</Badge>
          </div>
          {d.records.length === 0 ? <small className="muted">No boarding recorded.</small> : d.records.map((r) => (
            <div key={r.attendance_id} className="kit-record">
              <span className="route-code sm">{r.route_code}</span>
              <span>
                <b className="tabular">{time(r.boarded_at)}{r.alighted_at ? ` – ${time(r.alighted_at)}` : ''} · {r.fleet_code}</b>
                <small>{[r.boarding_stop, r.alighting_stop].filter(Boolean).join(' → ') || r.route_name}</small>
                <small>{METHOD_TEXT[r.method] ?? r.method} · trip #{r.trip_id}{r.auto_confirmed ? ' · auto-confirmed' : ''}</small>
              </span>
              <span className="kit-badges" style={{ justifyContent: 'flex-end' }}>
                <Badge tone={RECORD_TONE[r.status] ?? 'offline'}>{RECORD_TEXT[r.status] ?? r.status}</Badge>
                {r.flagged && <Badge tone="danger">{r.flag_reason ?? 'flagged'}</Badge>}
              </span>
            </div>
          ))}
        </article>
      ))}
    </DetailView>
  );
}

/** The students whose home route is this bus's route, by stop. */
function BusStudents({ token, bus, onClose, onUnbind }) {
  const students = useAsync(() => api(`/api/admin/students?route=${encodeURIComponent(bus.route_code)}`, { token }), [bus.route_code, token]);
  const [q, setQ] = useState('');
  const [pass, setPass] = useState('');
  const [open, setOpen] = useState(null);
  const list = students.data ?? null;
  const needle = q.trim().toLowerCase();
  const shown = list?.filter((s) => (!pass || (pass === 'yes') === Boolean(s.subscribed))
    && (!needle || [s.full_name, s.username, s.register_no, s.department, s.home_stop].some((v) => v && String(v).toLowerCase().includes(needle))));
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of shown ?? []) {
      const k = s.home_stop ?? 'No stop chosen';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return [...m.entries()];
  }, [shown]);
  const withPass = (list ?? []).filter((s) => s.subscribed).length;
  return (
    <DetailView title={bus.fleet_code} subtitle={`Route ${bus.route_code} · ${bus.route_name}`} onClose={onClose}>
      <section className="kit-profile">
        <div className="kit-profile-top">
          <span className="route-code">{bus.route_code}</span>
          <div style={{ flex: 1 }}>
            <h3>{bus.route_name}</h3>
            <p>{bus.driver_name ? `Driver ${bus.driver_name}` : 'No driver assigned'}{bus.registration_number ? ` · ${bus.registration_number}` : ''}</p>
          </div>
          {bus.live && <Badge tone="live">On trip</Badge>}
        </div>
        <div className="kit-figures">
          <Figure value={list?.length ?? '…'} label="Students" />
          <Figure value={list ? withPass : '…'} label="With pass" />
          <Figure value={bus.capacity ?? '—'} label="Seats" />
        </div>
      </section>
      <SearchBox value={q} onChange={setQ} placeholder="Search name, register no or stop" />
      <Chips value={pass} onChange={setPass} options={[{ value: '', label: 'All', count: list?.length }, { value: 'yes', label: 'Pass active', count: list ? withPass : undefined }, { value: 'no', label: 'No pass', count: list ? list.length - withPass : undefined }]} />
      <ErrorText>{students.error?.message}</ErrorText>
      {shown == null ? <div className="skeleton-block" /> : shown.length === 0 ? <Empty>No students on this route match.</Empty> : groups.map(([stop, rows]) => (
        <div key={stop} className="kit-list">
          <div className="kit-day-head"><span><Icon name="pin" size={12} /> {stop}</span><small>{rows.length}</small></div>
          {rows.map((s) => (
            <button type="button" key={s.id} className="kit-row" onClick={() => setOpen(s)}>
              <Avatar name={s.full_name} size={40} />
              <span className="kit-row-main"><b>{s.full_name}</b><small>{[s.register_no ?? s.username, s.department].filter(Boolean).join(' · ')}</small></span>
              <Badge tone={s.subscribed ? 'live' : 'danger'}>{s.subscribed ? 'Pass' : 'No pass'}</Badge>
              <Icon name="arrow" size={15} className="kit-chevron" />
            </button>
          ))}
        </div>
      ))}
      {open && <StudentHistory token={token} student={open} onClose={() => setOpen(null)} onUnbind={onUnbind} />}
    </DetailView>
  );
}

/** Every bus as a card: route, driver, students and whether it is on a trip. */
function BusesTab({ buses, onOpen }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = buses.data?.filter((b) => !needle || [b.fleet_code, b.route_code, b.route_name, b.driver_name].some((v) => v && String(v).toLowerCase().includes(needle)));
  const total = (buses.data ?? []).reduce((n, b) => n + (b.students ?? 0), 0);
  return (
    <>
      <div className="kit-stats three">
        <Stat icon="bus" label="Buses" value={buses.data?.length} />
        <Stat icon="signal" label="On trip now" value={buses.data ? buses.data.filter((b) => b.live).length : null} tone="live" />
        <Stat icon="users" label="Students assigned" value={buses.data ? total : null} />
      </div>
      <Panel title="Choose a bus" icon="bus" actions={<SearchBox value={q} onChange={setQ} placeholder="Search bus, route or driver" />}>
        <ErrorText>{buses.error?.message}</ErrorText>
        {list == null ? <div className="skeleton-block" /> : list.length === 0 ? <Empty>No buses match.</Empty> : (
          <div className="kit-bus-grid">
            {list.map((b) => (
              <button type="button" key={b.id} className={`kit-bus${b.live ? ' is-live' : ''}${b.students ? '' : ' is-empty'}`} disabled={!b.route_code} onClick={() => onOpen(b)}>
                <span className="kit-bus-top">
                  {b.route_code ? <span className="route-code sm">{b.route_code}</span> : <Badge tone="offline">No route</Badge>}
                  <span className="kit-bus-dot" style={{ background: b.live ? 'var(--live)' : b.status === 'active' ? '#d9dee8' : 'var(--delayed)' }} title={b.live ? 'On trip' : b.status} />
                </span>
                <span><b>{b.fleet_code}</b><small>{b.route_name ?? '—'}</small></span>
                <span className="kit-meta"><Icon name="users" size={13} /> <b style={{ color: 'var(--ink)' }}>{b.students ?? 0}</b> students</span>
                <small>{b.driver_name ?? 'No driver'}</small>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export default function AttendanceAdmin() {
  const { token } = useSession();
  const [tab, setTab] = useState('buses');
  const queue = useAsync(() => api('/api/admin/attendance/review', { token }), [token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [q, setQ] = useState('');
  const students = useAsync(() => (tab === 'tools' ? api(`/api/admin/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }) : Promise.resolve(null)), [tab, q, token]);
  const [open, setOpen] = useState(null);
  const [bus, setBus] = useState(null);
  const [student, setStudent] = useState(null);
  const [manual, setManual] = useState({ tripId: '', username: '', reason: '', status: 'PRESENT' });
  const a = useAction();

  const unbind = async (s) => {
    const reason = window.prompt(`Unbind ${s.username}'s phone (lost or replaced)? Reason:`);
    if (!reason) return false;
    const ok = await a.run(() => api(`/api/admin/students/${s.id}/device`, { token, method: 'DELETE', body: { reason } }), `${s.username} can bind a new phone.`);
    students.reload();
    return Boolean(ok);
  };

  return (
    <Page eyebrow="Transport office" title="Attendance" subtitle="Pick a bus to see its students and each student's day-by-day record. Registers only; never a student's location." wide>
      <div className="kit-stack">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'buses', label: 'By bus' }, { value: 'review', label: `Review${queue.data?.length ? ` (${queue.data.length})` : ''}` }, { value: 'tools', label: 'Tools' }]} />
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>

        {tab === 'buses' && <BusesTab buses={buses} onOpen={setBus} />}

        {tab === 'review' && (
          <Panel title={`Review queue (${queue.data?.length ?? '…'})`} icon="alert">
            <p className="muted">Provisional records and disputes need a human decision.</p>
            {queue.data?.length === 0 ? <Empty>Nothing to review.</Empty> : (
              <Table
                rows={queue.data}
                rowKey={(r) => r.attendance_id}
                columns={[
                  { key: 'status', label: 'Type', render: (r) => <Badge tone={r.status === 'DISPUTED' ? 'delayed' : 'offline'}>{r.status}</Badge> },
                  { key: 'full_name', label: 'Student', render: (r) => `${r.full_name} (${r.username})` },
                  { key: 'bus', label: 'Bus / trip', render: (r) => `${r.fleet_code} · #${r.trip_id}` },
                  { key: 'boarded_at', label: 'Boarded', render: (r) => dateTime(r.boarded_at) },
                  { key: 'flag', label: '', render: (r) => (r.flagged ? <Badge tone="danger">{r.flag_reason ?? 'flagged'}</Badge> : null) },
                  { key: 'x', label: '', render: (r) => <button className="link" onClick={() => setOpen(r)}>Review</button> },
                ]}
              />
            )}
          </Panel>
        )}

        {tab === 'tools' && (
          <div className="cols">
            <div className="col wide">
              <Panel title="Find a student" icon="users" actions={<SearchBox value={q} onChange={setQ} placeholder="Name, username or register no" />}>
                <Table
                  rows={students.data}
                  columns={[
                    { key: 'full_name', label: 'Student', render: (s) => <><b>{s.full_name}</b><small>{s.username}{s.register_no ? ` · ${s.register_no}` : ''}{s.department ? ` · ${s.department}` : ''}</small></> },
                    { key: 'route_code', label: 'Route / stop', render: (s) => (s.route_code ? <><span className="route-code sm">{s.route_code}</span> {s.home_stop ?? ''}</> : '—') },
                    { key: 'subscribed', label: 'Pass', render: (s) => <YesNo value={s.subscribed} /> },
                    { key: 'device', label: 'Phone', render: (s) => (s.device ? <>{s.device}{s.mock_location_flag && <> <Badge tone="danger">mock</Badge></>}</> : <span className="muted">Not bound</span>) },
                    { key: 'x', label: '', render: (s) => <span className="row-actions"><button className="link" onClick={() => setStudent(s)}><Icon name="eye" size={13} />History</button>{s.device && <button className="link" onClick={() => unbind(s)}>Unbind</button>}</span> },
                  ]}
                />
              </Panel>
            </div>
            <div className="col">
              <Panel title="Correct a record" icon="edit">
                <p className="muted">Mark a student present or absent on a trip, with a reason. Recorded as a manual override.</p>
                <form onSubmit={(e) => { e.preventDefault(); a.run(() => api('/api/attendance/manual', { token, body: { ...manual, tripId: Number(manual.tripId) } }), 'Saved.'); }}>
                  <div className="grid2">
                    <Field label="Trip #"><input value={manual.tripId} onChange={(e) => setManual((m) => ({ ...m, tripId: e.target.value }))} inputMode="numeric" required /></Field>
                    <Field label="Username"><input value={manual.username} onChange={(e) => setManual((m) => ({ ...m, username: e.target.value }))} required /></Field>
                  </div>
                  <Field label="Mark">
                    <select value={manual.status} onChange={(e) => setManual((m) => ({ ...m, status: e.target.value }))}><option value="PRESENT">Present</option><option value="ABSENT">Absent (void)</option></select>
                  </Field>
                  <Field label="Reason"><input value={manual.reason} onChange={(e) => setManual((m) => ({ ...m, reason: e.target.value }))} required minLength={3} /></Field>
                  <button className="btn primary" disabled={a.busy}>Save</button>
                </form>
              </Panel>
              <Panel title="Scheduled jobs" icon="clock">
                <p className="muted">Run now instead of waiting: prompt timeouts (every 15 s) and the nightly 23:30 lock and auto-confirm.</p>
                <div className="btn-row">
                  <button className="btn ghost" onClick={() => a.run(() => api('/api/admin/jobs/tick', { token, method: 'POST' }), (r) => `Timeouts: ${JSON.stringify(r)}`).then(queue.reload)}>Run timeouts</button>
                  <button className="btn ghost" onClick={() => a.run(() => api('/api/admin/jobs/nightly', { token, method: 'POST' }), (r) => `Nightly: ${JSON.stringify(r.attendance)}`).then(queue.reload)}>Run nightly</button>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </div>
      {open && <Review token={token} item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); queue.reload(); }} />}
      {bus && <BusStudents token={token} bus={bus} onClose={() => setBus(null)} onUnbind={unbind} />}
      {student && <StudentHistory token={token} student={student} onClose={() => setStudent(null)} onUnbind={unbind} />}
    </Page>
  );
}
