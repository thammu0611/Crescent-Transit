import { useState } from 'react';
import { View } from 'react-native';
import {
  Badge, Button, confirm, DataList, ErrorText, ItemCard, KV, LinkButton, Notice, PageHead, Panel, Row, Screen,
  SearchBox, Segmented, Select, Sheet, TextField,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';
import TrackersTab from './Trackers.js';

function BusForm({ token, bus, routes, onClose, onSaved }) {
  const [f, setF] = useState({
    fleetCode: bus?.fleet_code ?? '',
    registrationNumber: bus?.registration_number ?? '',
    busType: bus?.bus_type ?? '',
    capacity: String(bus?.capacity ?? 50),
    routeCode: bus?.route_code ?? '',
    status: bus?.status ?? 'active',
  });
  const a = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    const capacity = Number(f.capacity);
    if (!f.fleetCode.trim()) return a.setError('Fleet code is required.');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 120) return a.setError('Capacity is a whole number from 1 to 120.');
    const body = { ...f, capacity, routeCode: f.routeCode || null };
    a.run(() => api(bus ? `/api/admin/buses/${bus.id}` : '/api/admin/buses', { token, method: bus ? 'PATCH' : 'POST', body })).then((r) => r && onSaved());
  };
  return (
    <Sheet title={bus ? `Edit ${bus.fleet_code}` : 'Add a bus'} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <TextField label="Fleet code" value={f.fleetCode} onChangeText={set('fleetCode')} autoCapitalize="characters" />
        <TextField label="Registration" value={f.registrationNumber} onChangeText={set('registrationNumber')} autoCapitalize="characters" />
        <TextField label="Type" value={f.busType} onChangeText={set('busType')} />
        <TextField label="Capacity" value={f.capacity} onChangeText={(v) => set('capacity')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Select label="Route" value={f.routeCode} onChange={set('routeCode')} options={[{ value: '', label: 'Unassigned' }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))]} />
        <Select label="Status" value={f.status} onChange={set('status')} options={[{ value: 'active', label: 'Active' }, { value: 'maintenance', label: 'Maintenance' }, { value: 'inactive', label: 'Inactive' }]} />
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save" busy={a.busy} onPress={save} />
      </View>
    </Sheet>
  );
}

function DriverForm({ token, driver, buses, onClose, onSaved }) {
  const [f, setF] = useState({ username: driver?.username ?? '', fullName: driver?.full_name ?? '', phone: driver?.phone ?? '', fleetCode: driver?.fleet_code ?? '', password: '', status: driver?.status ?? 'active' });
  const a = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!driver && !f.username.trim()) return a.setError('Username is required.');
    if (!f.fullName.trim()) return a.setError('Full name is required.');
    if ((!driver || f.password) && f.password.length < 8) return a.setError('Password must be at least 8 characters.');
    const body = driver
      ? { fullName: f.fullName, phone: f.phone, fleetCode: f.fleetCode || null, status: f.status, ...(f.password ? { password: f.password } : {}) }
      : { ...f, fleetCode: f.fleetCode || undefined };
    a.run(() => api(driver ? `/api/admin/drivers/${driver.id}` : '/api/admin/drivers', { token, method: driver ? 'PATCH' : 'POST', body })).then((r) => r && onSaved());
  };
  return (
    <Sheet title={driver ? `Edit ${driver.username}` : 'Add a driver'} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <TextField label="Username" value={f.username} onChangeText={set('username')} editable={!driver} autoCapitalize="none" />
        <TextField label="Full name" value={f.fullName} onChangeText={set('fullName')} />
        <TextField label="Phone" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Select
          label="Assigned bus"
          value={f.fleetCode}
          onChange={set('fleetCode')}
          options={[{ value: '', label: 'None' }, ...buses.map((b) => ({ value: b.fleet_code, label: `${b.fleet_code}${b.driver_username && b.driver_username !== driver?.username ? ` (${b.driver_username})` : ''}` }))]}
        />
        <TextField label={driver ? 'New password (optional)' : 'Password'} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
        {driver && <Select label="Status" value={f.status} onChange={set('status')} options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />}
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save" busy={a.busy} onPress={save} />
      </View>
    </Sheet>
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
  const { refreshing, onRefresh } = useRefresh(buses, drivers, routes);

  const remove = async (kind, id, label) => {
    if (!(await confirm(`Delete ${label}?`, 'Buses and drivers with trip history cannot be deleted; deactivate them instead.', 'Delete', true))) return;
    a.run(() => api(`/api/admin/${kind}/${id}`, { token, method: 'DELETE' }), `${label} deleted.`).then(() => { buses.reload(); drivers.reload(); });
  };

  const [tab, setTab] = useState('buses');
  const [q, setQ] = useState('');
  const match = (...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q.toLowerCase()));
  const busRows = buses.data?.filter((b) => match(b.fleet_code, b.route_code, b.route_name, b.driver_name, b.registration_number));
  const driverRows = drivers.data?.filter((d) => match(d.username, d.full_name, d.fleet_code, d.route_code));

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead
        icon="bus"
        colors={G.navy}
        eyebrow="Transport office"
        title="Buses and drivers"
        subtitle="Add, edit or retire buses, drivers and GPS trackers, and assign each bus to a route."
        actions={<>
          <Button small variant="ghost" icon="plus" title="Add bus" onPress={() => setEditBus('new')} />
          <Button small variant="ghost" icon="plus" title="Add driver" onPress={() => setEditDriver('new')} />
        </>}
      />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? buses.error?.message}</ErrorText>
      <Panel>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'buses', label: `Buses (${buses.data?.length ?? '…'})` },
            { value: 'drivers', label: `Drivers (${drivers.data?.length ?? '…'})` },
            { value: 'trackers', label: 'GPS' },
          ]}
        />
        {tab !== 'trackers' ? <SearchBox value={q} onChange={setQ} placeholder={tab === 'buses' ? 'Search bus, route or driver' : 'Search driver or bus'} /> : null}
        {tab === 'trackers' ? (
          <TrackersTab token={token} buses={buses.data ?? []} onChanged={() => buses.reload()} />
        ) : tab === 'buses' ? (
          <DataList
            rows={busRows}
            empty="No bus matches."
            render={(b) => (
              <ItemCard
                title={b.fleet_code}
                subtitle={b.bus_type ?? ''}
                right={<View style={{ gap: 4, alignItems: 'flex-end' }}><Badge tone={b.status === 'active' ? 'live' : 'delayed'}>{b.status}</Badge>{b.live ? <Badge tone="live">on trip</Badge> : null}{b.tracker_id ? <Badge tone={b.liveSource === 'tracker' ? 'live' : 'offline'}>GPS tracker</Badge> : null}</View>}
              >
                <KV k="Reg. no." v={b.registration_number ?? '—'} />
                <KV k="Route" v={b.route_code ? `${b.route_code} · ${b.route_name}` : 'Unassigned'} />
                <KV k="Seats" v={b.capacity} />
                <KV k="Driver" v={b.driver_name ?? '—'} />
                <Row gap={16}>
                  <LinkButton icon="edit" title="Edit" onPress={() => setEditBus(b)} />
                  <LinkButton icon="trash" danger title="Delete" onPress={() => remove('buses', b.id, b.fleet_code)} />
                </Row>
              </ItemCard>
            )}
          />
        ) : (
          <DataList
            rows={driverRows}
            empty="No driver matches."
            render={(d) => (
              <ItemCard title={d.full_name} subtitle={`${d.username}${d.phone ? ` · ${d.phone}` : ''}`} right={<Badge tone={d.status === 'active' ? 'live' : 'danger'}>{d.status}</Badge>}>
                <KV k="Bus" v={d.fleet_code ?? 'None'} />
                <KV k="Route" v={d.route_code ?? '—'} />
                <KV k="Last trip" v={dateTime(d.last_trip)} />
                <Row gap={16}>
                  <LinkButton icon="edit" title="Edit" onPress={() => setEditDriver(d)} />
                  <LinkButton icon="trash" danger title="Delete" onPress={() => remove('drivers', d.id, d.username)} />
                </Row>
              </ItemCard>
            )}
          />
        )}
      </Panel>
      {editBus && <BusForm token={token} bus={editBus === 'new' ? null : editBus} routes={routes.data ?? []} onClose={() => setEditBus(null)} onSaved={() => { setEditBus(null); buses.reload(); drivers.reload(); }} />}
      {editDriver && <DriverForm token={token} driver={editDriver === 'new' ? null : editDriver} buses={buses.data ?? []} onClose={() => setEditDriver(null)} onSaved={() => { setEditDriver(null); buses.reload(); drivers.reload(); }} />}
    </Screen>
  );
}
