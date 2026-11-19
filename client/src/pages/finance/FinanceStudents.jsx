import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { DetailView, Figure } from '../../components/adminkit.jsx';
import { Badge, Dropdown, Empty, ErrorText, Field, Modal, Notice, Page, Panel, SearchBox, Segmented, Table } from '../../components/ui.jsx';

/** Suspending or reinstating an account, with the reason the audit log keeps. */
function StatusDialog({ token, student, onClose, onDone }) {
  const suspend = student.status === 'active';
  const [reason, setReason] = useState('');
  const a = useAction();
  const send = (e) => {
    e.preventDefault();
    a.run(() => api(`/api/finance/users/${student.id}/${suspend ? 'suspend' : 'unsuspend'}`, { token, body: { reason: reason.trim() } }))
      .then((r) => r && onDone(`${student.full_name}: ${suspend ? 'suspended' : 'reinstated'}.`));
  };
  return (
    <Modal title={`${suspend ? 'Suspend' : 'Reinstate'} ${student.full_name}?`} onClose={onClose}>
      <p className="muted">
        {suspend
          ? 'A suspended student cannot sign in until the account is reinstated.'
          : 'The student can sign in again straight away.'}
      </p>
      <form onSubmit={send}>
        <Field label="Reason (kept in the audit log)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required autoFocus placeholder={suspend ? 'e.g. Bus fee unpaid' : 'e.g. Dues cleared'} />
        </Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="btn-row confirm-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${suspend ? 'danger' : 'dark'}`} disabled={a.busy || reason.trim().length < 3}>{suspend ? 'Suspend' : 'Reinstate'}</button>
        </div>
      </form>
    </Modal>
  );
}

const SHOW = [
  { value: '', label: 'All students' },
  { value: 'subscribed', label: 'Subscribers' },
  { value: 'unpaid', label: 'Not subscribed' },
  { value: 'suspended', label: 'Suspended' },
];
const matches = (s, show) => (show === 'subscribed' ? s.subscribed : show === 'unpaid' ? !s.subscribed : show === 'suspended' ? s.status !== 'active' : true);
const NO_BUS = '—';

/** Students with their subscription, a filter and the suspend action: on a bus's page and in the full list. */
function StudentList({ students, onChange, showRoute = true }) {
  const [show, setShow] = useState('');
  const rows = students?.filter((s) => matches(s, show)) ?? null;
  const count = (v) => (students ? students.filter((s) => matches(s, v)).length : undefined);
  return (
    <>
      <div className="btn-row fin-filter">
        <Dropdown label="Show" icon="users" value={show} onChange={setShow} options={SHOW.map((o) => ({ ...o, count: count(o.value) }))} />
      </div>
      <Table
        rows={rows}
        empty={show ? 'No students match.' : 'No students yet.'}
        columns={[
          { key: 'full_name', label: 'Student', render: (s) => <><b>{s.full_name}</b><small>{[s.username, s.register_no, s.department].filter(Boolean).join(' · ')}</small></> },
          ...(showRoute ? [{ key: 'route_code', label: 'Bus', render: (s) => (s.route_code ? <span className="route-code sm">{s.route_code}</span> : '—') }] : []),
          { key: 'paid_until', label: 'Paid until', render: (s) => (s.paid_until ? date(s.paid_until) : '—') },
          { key: 'subscribed', label: 'Subscriber', render: (s) => <Badge tone={s.subscribed ? 'live' : 'offline'}>{s.subscribed ? 'Yes' : 'No'}</Badge> },
          { key: 'payments', label: 'Payments', align: 'right' },
          { key: 'status', label: 'Account', render: (s) => <Badge tone={s.status === 'active' ? 'live' : 'danger'}>{s.status === 'active' ? 'Active' : 'Suspended'}</Badge> },
          { key: 'x', label: '', render: (s) => <button className={`link ${s.status === 'active' ? 'danger' : ''}`} onClick={() => onChange(s)}>{s.status === 'active' ? 'Suspend' : 'Reinstate'}</button> },
        ]}
      />
    </>
  );
}

/**
 * Every bus in the fleet, each with the students whose home route it serves (none yet
 * shows 0), and a last card for students whose route has no bus or who chose none.
 */
function busesOf(students, fleet) {
  const list = fleet.map((b) => ({ key: b.fleet_code, routeCode: b.route_code, routeName: b.route_name, fleetCode: b.fleet_code, students: [] }));
  const byCode = new Map(list.map((b) => [b.fleetCode, b]));
  const loose = { key: NO_BUS, routeCode: null, routeName: null, fleetCode: null, students: [] };
  for (const s of students) (byCode.get(s.fleet_code) ?? loose).students.push(s);
  const sorted = list.sort((a, b) => String(a.routeCode ?? '~').localeCompare(String(b.routeCode ?? '~'), undefined, { numeric: true }) || a.fleetCode.localeCompare(b.fleetCode));
  return loose.students.length ? [...sorted, loose] : sorted;
}

/** Identity and subscription status by bus; open a bus for its students; suspend accounts that have not paid (doc 4.4). */
export default function FinanceStudents() {
  const { token } = useSession();
  const [view, setView] = useState('buses');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // the bus key whose students are shown
  const [changing, setChanging] = useState(null);
  const [message, setMessage] = useState(null);
  const list = useAsync(() => api(`/api/finance/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }), [q, token]);
  const fleet = useAsync(() => api('/api/finance/buses', { token }), [token]);
  // While searching, only buses with a matching student are shown.
  const buses = useMemo(() => (list.data && fleet.data ? busesOf(list.data, fleet.data).filter((b) => !q || b.students.length) : null), [list.data, fleet.data, q]);
  const bus = open ? buses?.find((b) => b.key === open) : null;
  const change = (s) => { setMessage(null); setChanging(s); };

  return (
    <Page eyebrow="Finance office" title="Students" subtitle="Subscriptions by bus. Open a bus to see its students; suspended accounts cannot sign in." wide>
      <Notice>{message}</Notice>
      <ErrorText>{list.error?.message ?? fleet.error?.message}</ErrorText>
      <div className="fin-toolbar">
        <Segmented value={view} onChange={setView} options={[{ value: 'buses', label: 'By bus' }, { value: 'all', label: 'All students' }]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or username" />
      </div>

      {view === 'buses' ? (
        buses == null ? <div className="skeleton-block" /> : buses.length === 0 ? <Empty>{q ? 'No students match.' : 'No students yet.'}</Empty> : (
          <div className="kit-bus-grid">
            {buses.map((b) => {
              const paid = b.students.filter((s) => s.subscribed).length;
              const suspended = b.students.filter((s) => s.status !== 'active').length;
              return (
                <button type="button" key={b.key} className={`kit-bus fin-bus${b.students.length ? '' : ' is-empty'}`} onClick={() => setOpen(b.key)}>
                  <span className="kit-bus-top">
                    {b.routeCode ? <span className="route-code sm">{b.routeCode}</span> : <Badge tone="offline">No bus</Badge>}
                    {suspended > 0 && <Badge tone="danger">{suspended} suspended</Badge>}
                  </span>
                  <span><b>{b.fleetCode ?? 'No bus'}</b><small>{b.fleetCode ? b.routeName ?? 'No route assigned' : 'Students without a bus on their route'}</small></span>
                  <span className="fin-bus-figures">
                    <span><b className="tabular">{b.students.length}</b><small>students</small></span>
                    <span className="is-paid"><b className="tabular">{paid}</b><small>paid</small></span>
                    <span className="is-unpaid"><b className="tabular">{b.students.length - paid}</b><small>unpaid</small></span>
                  </span>
                  <span className="fin-bus-bar" aria-hidden="true"><i style={{ width: `${b.students.length ? (paid / b.students.length) * 100 : 0}%` }} /></span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <Panel title="All students" icon="users">
          <StudentList students={list.data ?? null} onChange={change} />
        </Panel>
      )}

      {bus && (
        <DetailView
          title={bus.fleetCode ?? 'No bus'}
          subtitle={bus.routeCode ? `Route ${bus.routeCode} · ${bus.routeName ?? ''}` : bus.fleetCode ? 'No route assigned' : 'Students without a bus on their route'}
          onClose={() => setOpen(null)}
        >
          <section className="kit-profile">
            <div className="kit-figures">
              <Figure value={bus.students.length} label="Students" />
              <Figure value={bus.students.filter((s) => s.subscribed).length} label="Subscribers" />
              <Figure value={bus.students.filter((s) => !s.subscribed).length} label="Not subscribed" />
              <Figure value={bus.students.filter((s) => s.status !== 'active').length} label="Suspended" />
            </div>
          </section>
          <Panel title="Students on this bus" icon="users">
            <StudentList students={bus.students} onChange={change} showRoute={false} />
          </Panel>
        </DetailView>
      )}

      {changing && (
        <StatusDialog
          token={token}
          student={changing}
          onClose={() => setChanging(null)}
          onDone={(text) => { setChanging(null); setMessage(text); list.reload(); }}
        />
      )}
    </Page>
  );
}
