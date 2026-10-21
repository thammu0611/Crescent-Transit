import { useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import TrackersTab from './Trackers.jsx';
import { Badge, ErrorText, Field, Modal, Notice, Page, Panel, RowActions, SearchBox, Segmented, Table } from '../../components/ui.jsx';

function BusForm({ token, bus, routes, onClose, onSaved }) {
  const [f, setF] = useState({
    fleetCode: bus?.fleet_code ?? '',
    registrationNumber: bus?.registration_number ?? '',
    busType: bus?.bus_type ?? '',
    capacity: bus?.capacity ?? 50,
    routeCode: bus?.route_code ?? '',
    status: bus?.status ?? 'active',
  });
  const a = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const body = { ...f, capacity: Number(f.capacity), routeCode: f.routeCode || null };
    a.run(() => api(bus ? `/api/admin/buses/${bus.id}` : '/api/admin/buses', { token, method: bus ? 'PATCH' : 'POST', body })).then((r) => r && onSaved());
  };
  return (
    <Modal title={bus ? `Edit ${bus.fleet_code}` : 'Add a bus'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid2">
          <Field label="Fleet code"><input value={f.fleetCode} onChange={set('fleetCode')} required /></Field>
          <Field label="Registration"><input value={f.registrationNumber} onChange={set('registrationNumber')} /></Field>
          <Field label="Type"><input value={f.busType} onChange={set('busType')} /></Field>
          <Field label="Capacity"><input type="number" min={1} max={120} value={f.capacity} onChange={set('capacity')} /></Field>
          <Field label="Route">
            <select value={f.routeCode} onChange={set('routeCode')}>
              <option value="">Unassigned</option>
              {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={f.status} onChange={set('status')}>
              <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>Save</button>
      </form>
    </Modal>
  );
}

function DriverForm({ token, driver, buses, onClose, onSaved }) {
  const [f, setF] = useState({ username: driver?.username ?? '', fullName: driver?.full_name ?? '', phone: driver?.phone ?? '', fleetCode: driver?.fleet_code ?? '', password: '', status: driver?.status ?? 'active' });
  const a = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const body = driver
      ? { fullName: f.fullName, phone: f.phone, fleetCode: f.fleetCode || null, status: f.status, ...(f.password ? { password: f.password } : {}) }
      : { ...f, fleetCode: f.fleetCode || undefined };
    a.run(() => api(driver ? `/api/admin/drivers/${driver.id}` : '/api/admin/drivers', { token, method: driver ? 'PATCH' : 'POST', body })).then((r) => r && onSaved());
  };
  return (
    <Modal title={driver ? `Edit ${driver.username}` : 'Add a driver'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid2">
          <Field label="Username"><input value={f.username} onChange={set('username')} disabled={Boolean(driver)} required /></Field>
          <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} required /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Assigned bus">
            <select value={f.fleetCode} onChange={set('fleetCode')}>
              <option value="">None</option>
              {buses.map((b) => <option key={b.id} value={b.fleet_code}>{b.fleet_code}{b.driver_username && b.driver_username !== driver?.username ? ` (${b.driver_username})` : ''}</option>)}
            </select>
          </Field>
          <Field label={driver ? 'New password (optional)' : 'Password'}><input type="password" value={f.password} onChange={set('password')} minLength={8} required={!driver} autoComplete="new-password" /></Field>
          {driver && (
            <Field label="Status">
              <select value={f.status} onChange={set('status')}><option value="active">Active</option><option value="suspended">Suspended</option></select>
            </Field>
          )}
        </div>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>Save</button>
      </form>
    </Modal>
  );
}

/** Add, edit and remove buses and drivers; assign buses to routes (doc 4.1). */
export default function Fleet() {
  const { token } = useSession();
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const drivers = useAsync(() => api('/api/admin/drivers', { token }), [token]);
  const routes = useAsync(() => api('/api/admin/routes', { token }), [token]);
  const [editBus, setEditBus] = useState(null);
  const [editDriver, setEditDriver] = useState(null);
  const a = useAction();

  const remove = (kind, id, label) => {
    if (!window.confirm(`Delete ${label}? Buses and drivers with trip history cannot be deleted; deactivate them instead.`)) return;
    a.run(() => api(`/api/admin/${kind}/${id}`, { token, method: 'DELETE' }), `${label} deleted.`).then(() => { buses.reload(); drivers.reload(); });
  };

  const [tab, setTab] = useState('buses');
  const [q, setQ] = useState('');
  const match = (...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q.toLowerCase()));
  const busRows = buses.data?.filter((b) => match(b.fleet_code, b.route_code, b.route_name, b.driver_name, b.registration_number));
  const driverRows = drivers.data?.filter((d) => match(d.username, d.full_name, d.fleet_code, d.route_code));

  return (
    <Page
      eyebrow="Transport office"
      title="Buses and drivers"
      subtitle="Add, edit or retire buses, drivers and GPS trackers, and assign each bus to a route."
      wide
      actions={<>
        <button className="btn ghost" onClick={() => setEditBus('new')}><Icon name="plus" size={14} />Add bus</button>
        <button className="btn ghost" onClick={() => setEditDriver('new')}><Icon name="plus" size={14} />Add driver</button>
      </>}
    >
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>
      <Panel>
        <div className="toolbar">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'buses', label: `Buses (${buses.data?.length ?? '…'})` },
              { value: 'drivers', label: `Drivers (${drivers.data?.length ?? '…'})` },
              { value: 'trackers', label: 'GPS trackers' },
            ]}
          />
          {tab !== 'trackers' && <SearchBox value={q} onChange={setQ} placeholder={tab === 'buses' ? 'Search bus, route or driver' : 'Search driver or bus'} />}
        </div>
        {tab === 'trackers' ? (
          <TrackersTab token={token} buses={buses.data ?? []} onChanged={() => buses.reload()} />
        ) : tab === 'buses' ? (
          <Table
            rows={busRows}
            empty="No bus matches."
            columns={[
              { key: 'fleet_code', label: 'Bus', render: (b) => <><b>{b.fleet_code}</b>{b.live && <> <Badge tone="live">on trip</Badge></>}{b.tracker_id && <> <Badge tone={b.liveSource === 'tracker' ? 'live' : 'offline'}>GPS tracker</Badge></>}<small>{b.bus_type ?? ''}</small></> },
              { key: 'registration_number', label: 'Reg. no.', render: (b) => b.registration_number ?? '—' },
              { key: 'route_code', label: 'Route', wrap: true, render: (b) => (b.route_code ? <><span className="route-code sm">{b.route_code}</span> {b.route_name}</> : <span className="muted">Unassigned</span>) },
              { key: 'capacity', label: 'Seats', align: 'right' },
              { key: 'driver_name', label: 'Driver', render: (b) => b.driver_name ?? '—' },
              { key: 'status', label: 'Status', render: (b) => <Badge tone={b.status === 'active' ? 'live' : 'delayed'}>{b.status}</Badge> },
              { key: 'x', label: '', render: (b) => <RowActions><button className="link" onClick={() => setEditBus(b)}><Icon name="edit" size={13} />Edit</button><button className="link danger" onClick={() => remove('buses', b.id, b.fleet_code)}><Icon name="trash" size={13} />Delete</button></RowActions> },
            ]}
          />
        ) : (
          <Table
            rows={driverRows}
            empty="No driver matches."
            columns={[
              { key: 'full_name', label: 'Driver', render: (d) => <><b>{d.full_name}</b><small>{d.username}{d.phone ? ` · ${d.phone}` : ''}</small></> },
              { key: 'fleet_code', label: 'Bus', render: (d) => d.fleet_code ?? <span className="muted">None</span> },
              { key: 'route_code', label: 'Route', render: (d) => (d.route_code ? <span className="route-code sm">{d.route_code}</span> : '—') },
              { key: 'last_trip', label: 'Last trip', render: (d) => dateTime(d.last_trip) },
              { key: 'status', label: 'Status', render: (d) => <Badge tone={d.status === 'active' ? 'live' : 'danger'}>{d.status}</Badge> },
              { key: 'x', label: '', render: (d) => <RowActions><button className="link" onClick={() => setEditDriver(d)}><Icon name="edit" size={13} />Edit</button><button className="link danger" onClick={() => remove('drivers', d.id, d.username)}><Icon name="trash" size={13} />Delete</button></RowActions> },
            ]}
          />
        )}
      </Panel>
      {editBus && <BusForm token={token} bus={editBus === 'new' ? null : editBus} routes={routes.data ?? []} onClose={() => setEditBus(null)} onSaved={() => { setEditBus(null); buses.reload(); drivers.reload(); }} />}
      {editDriver && <DriverForm token={token} driver={editDriver === 'new' ? null : editDriver} buses={buses.data ?? []} onClose={() => setEditDriver(null)} onSaved={() => { setEditDriver(null); buses.reload(); drivers.reload(); }} />}
    </Page>
  );
}
