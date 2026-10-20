import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, useMap } from 'react-leaflet';
import BaseTiles from '../../components/BaseTiles.jsx';
import { api } from '../../lib/api.js';
import { STATUS_TEXT, date, dateTime, daysAgo, thisMonth, time } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Avatar, Chips, DetailView, Figure, duration, isoDay } from '../../components/adminkit.jsx';
import { Badge, Empty, ErrorText, Field, Modal, Notice, Page, Panel, RowActions, SearchBox, Segmented, Stat, Table } from '../../components/ui.jsx';

const TRIP_TONE = { active: 'live', scheduled: 'delayed', completed: 'offline', cancelled: 'danger' };
const TRIP_TEXT = { active: 'Running', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
const tripWhen = (t) => (t.status === 'scheduled' ? t.scheduled_for : t.started_at);

function FitPath({ path }) {
  const map = useMap();
  useEffect(() => {
    if (path.length) map.fitBounds(path.map((p) => [p.lat, p.lng]), { padding: [30, 30] });
  }, [map, path]);
  return null;
}

/** Trip replay with a time scrubber, play/pause and 1x/4x/16x (doc B.8). */
function Replay({ path }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  useEffect(() => {
    if (!playing) return undefined;
    // Fixes are ~5-10 s apart; one step per (interval / speed).
    const id = setInterval(() => setI((x) => Math.min(x + 1, path.length - 1)), 5000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, path.length]);
  useEffect(() => {
    if (i === path.length - 1) setPlaying(false);
  }, [i, path.length]);
  if (!path.length) return <p className="muted">No stored fixes for this trip.</p>;
  const p = path[i];
  return (
    <>
      <div className="replay-map">
        <MapContainer center={[p.lat, p.lng]} zoom={13} className="map">
          <BaseTiles />
          <FitPath path={path} />
          <Polyline positions={path.map((x) => [x.lat, x.lng])} pathOptions={{ color: '#142548', weight: 3, opacity: 0.3 }} />
          <Polyline positions={path.slice(0, i + 1).map((x) => [x.lat, x.lng])} pathOptions={{ color: '#2c8a63', weight: 4 }} />
          <CircleMarker center={[p.lat, p.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#8f2430', fillOpacity: 1 }} />
        </MapContainer>
      </div>
      <div className="replay-bar">
        <button className="btn ghost" onClick={() => setPlaying((x) => !x)}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={path.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Replay position" />
        <Segmented value={speed} onChange={setSpeed} options={[1, 4, 16].map((s) => ({ value: s, label: `${s}×` }))} />
      </div>
      <p className="muted tabular">{time(p.recorded_at)} · {Math.round(p.speed_kmh ?? 0)} km/h · fix {i + 1} of {path.length}</p>
    </>
  );
}

function TripDetail({ token, trip, onClose }) {
  const [tab, setTab] = useState('register');
  const reg = useAsync(() => api(`/api/trips/${trip.id}/attendance`, { token }), [trip.id]);
  const path = useAsync(() => (tab === 'replay' ? api(`/api/trips/${trip.id}/path`, { token }) : Promise.resolve(null)), [tab, trip.id]);
  return (
    <Modal title={`Trip #${trip.id} · route ${trip.route_code} · ${trip.fleet_code}`} onClose={onClose} width={760}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'register', label: 'Register' }, { value: 'replay', label: 'Replay' }]} />
      {tab === 'register' ? (
        <>
          <p className="muted">{reg.data?.onBoard ?? 0} on board now · capacity {reg.data?.capacity ?? '—'} · {reg.data?.records.length ?? 0} records</p>
          <Table
            rows={reg.data?.records}
            rowKey={(r) => r.attendance_id}
            empty="No attendance on this trip."
            columns={[
              { key: 'full_name', label: 'Student', render: (r) => `${r.full_name} (${r.username})` },
              { key: 'status', label: 'Status', render: (r) => <>{STATUS_TEXT[r.status]}{r.flagged && <> <Badge tone="danger">flagged</Badge></>}</> },
              { key: 'method', label: 'Method' },
              { key: 'boarded', label: 'Boarded', render: (r) => `${time(r.boarded_at)} ${r.boarding_stop ?? ''}` },
              { key: 'alighted', label: 'Alighted', render: (r) => (r.alighted_at ? `${time(r.alighted_at)} ${r.alighting_stop ?? ''}` : '—') },
            ]}
          />
        </>
      ) : path.data ? <Replay path={path.data} /> : <p className="muted">Loading…</p>}
    </Modal>
  );
}


/** One trip as a row: route, bus, start-end, duration, status and riders. */
function TripRow({ t, onOpen, showDriver }) {
  return (
    <button type="button" className="kit-row" onClick={() => onOpen(t)}>
      <span className="route-code">{t.route_code}</span>
      <span className="kit-row-main">
        <b>{t.route_name}</b>
        <small>{t.fleet_code}{showDriver ? ` · ${t.driver_name ?? 'No driver'}` : ''}{t.started_by === 'tracker' ? ' · GPS tracker' : ''}</small>
        <span className="kit-meta tabular"><Icon name="clock" size={12} />
          {t.status === 'scheduled' ? `Planned ${time(tripWhen(t))}` : `${time(t.started_at)} – ${t.ended_at ? time(t.ended_at) : 'now'}`}
          {!['scheduled', 'cancelled'].includes(t.status) ? ` · ${duration(t.started_at, t.ended_at ?? new Date())}` : ''}
        </span>
      </span>
      <span className="kit-row-side">
        <Badge tone={TRIP_TONE[t.status]}>{TRIP_TEXT[t.status] ?? t.status}</Badge>
        <small className="muted">{t.attendance} rider{t.attendance === 1 ? '' : 's'}</small>
        {t.flagged && <Badge tone="danger">{t.flag_reason ?? 'flagged'}</Badge>}
      </span>
    </button>
  );
}

/** Trips grouped under a date heading, newest first. */
function TripsByDate({ trips, onOpen, showDriver }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of trips) {
      const day = isoDay(tripWhen(t));
      if (!m.has(day)) m.set(day, []);
      m.get(day).push(t);
    }
    return [...m.entries()];
  }, [trips]);
  if (!trips.length) return <Empty>No trips match these filters.</Empty>;
  return groups.map(([day, list]) => (
    <div key={day} className="kit-list">
      <div className="kit-day-head">{date(`${day}T06:30:00Z`)}<small>{list.length} trip{list.length === 1 ? '' : 's'}</small></div>
      {list.map((t) => <TripRow key={t.id} t={t} onOpen={onOpen} showDriver={showDriver} />)}
    </div>
  ));
}

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: '7', label: 'Last 7 days' },
];
const inPeriod = (t, period) => {
  if (period === 'all') return true;
  const day = isoDay(tripWhen(t));
  if (period === 'month') return day.startsWith(thisMonth());
  return day >= daysAgo(Number(period) - 1);
};

/** One driver's complete trip history, from the trips table. */
function DriverTrips({ token, driver, onClose }) {
  const trips = useAsync(() => api(`/api/admin/trips?driver=${driver.id}`, { token }), [driver.id, token]);
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('all');
  const [open, setOpen] = useState(null);
  const all = trips.data ?? [];
  const inRange = all.filter((t) => inPeriod(t, period));
  const shown = inRange.filter((t) => !status || t.status === status);
  const done = inRange.filter((t) => t.status === 'completed' && t.ended_at);
  const avg = done.length ? done.reduce((n, t) => n + (new Date(t.ended_at) - new Date(t.started_at)), 0) / done.length : null;
  const count = (s) => inRange.filter((t) => t.status === s).length;
  return (
    <DetailView title={driver.full_name} subtitle={`@${driver.username} · trip history`} onClose={onClose}>
      <section className="kit-profile">
        <div className="kit-profile-top">
          <Avatar name={driver.full_name} size={56} />
          <div>
            <h3>{driver.full_name}</h3>
            <div className="kit-badges">
              {driver.fleet_code ? <Badge tone="info">{driver.fleet_code}</Badge> : <Badge tone="delayed">No bus assigned</Badge>}
              {driver.route_code && <Badge tone="offline">Route {driver.route_code}</Badge>}
              {driver.on_trip && <Badge tone="live">On trip</Badge>}
            </div>
          </div>
        </div>
        <dl className="kit-kv">
          <div><dt>Route</dt><dd>{driver.route_code ? `${driver.route_code} · ${driver.route_name}` : '—'}</dd></div>
          <div><dt>Phone</dt><dd>{driver.phone ? <a href={`tel:${driver.phone}`}>{driver.phone}</a> : '—'}</dd></div>
          <div><dt>Last trip</dt><dd>{driver.last_trip ? dateTime(driver.last_trip) : '—'}</dd></div>
        </dl>
        <div className="kit-divider" />
        <div className="kit-figures">
          <Figure value={inRange.filter((t) => t.status !== 'scheduled').length} label="Trips" />
          <Figure value={count('completed')} label="Completed" />
          <Figure value={count('cancelled')} label="Cancelled" />
          <Figure value={avg == null ? '—' : duration(0, avg)} label="Avg trip time" />
        </div>
      </section>
      <Chips value={period} onChange={setPeriod} options={PERIODS} />
      <Chips
        value={status}
        onChange={setStatus}
        options={[
          { value: '', label: 'All', count: inRange.length },
          { value: 'completed', label: 'Completed', count: count('completed') },
          { value: 'active', label: 'Running', count: count('active') },
          { value: 'scheduled', label: 'Scheduled', count: count('scheduled') },
          { value: 'cancelled', label: 'Cancelled', count: count('cancelled') },
        ]}
      />
      <ErrorText>{trips.error?.message}</ErrorText>
      {trips.data == null ? <div className="skeleton-block" /> : <TripsByDate trips={shown} onOpen={setOpen} />}
      {open && <TripDetail token={token} trip={open} onClose={() => setOpen(null)} />}
    </DetailView>
  );
}

/** Drivers with their bus and how many trips they have run. */
function DriversTab({ drivers, onOpen }) {
  const [q, setQ] = useState('');
  const list = drivers.data ?? null;
  const needle = q.trim().toLowerCase();
  const shown = list?.filter((d) => !needle || [d.full_name, d.username, d.fleet_code, d.route_code, d.route_name].some((v) => v && String(v).toLowerCase().includes(needle)));
  const sum = (f) => (list ?? []).reduce((n, d) => n + f(d), 0);
  const noBus = list ? sum((d) => (d.fleet_code ? 0 : 1)) : null;
  return (
    <>
      <div className="kit-stats">
        <Stat icon="user" label="Drivers" value={list?.length} />
        <Stat icon="bus" label="On trip now" value={list ? sum((d) => (d.on_trip ? 1 : 0)) : null} tone="live" />
        <Stat icon="clock" label="Trips run" value={list ? sum((d) => d.trips_total ?? 0) : null} />
        <Stat icon="alert" label="Without a bus" value={noBus} tone={noBus ? 'delayed' : ''} />
      </div>
      <Panel title="Drivers" icon="users" actions={<SearchBox value={q} onChange={setQ} placeholder="Search driver, bus or route" />}>
        <ErrorText>{drivers.error?.message}</ErrorText>
        {shown == null ? <div className="skeleton-block" /> : shown.length === 0 ? <Empty>No drivers match.</Empty> : (
          <div className="kit-list cols-2">
            {shown.map((d) => (
              <button type="button" key={d.id} className={`kit-row${d.on_trip ? ' is-live' : ''}`} onClick={() => onOpen(d)}>
                <span className={d.on_trip ? 'kit-live-dot' : ''}><Avatar name={d.full_name} size={46} /></span>
                <span className="kit-row-main">
                  <b>{d.full_name}</b>
                  <small>{d.fleet_code ? `${d.fleet_code}${d.route_code ? ` · Route ${d.route_code} · ${d.route_name}` : ''}` : 'No bus assigned'}</small>
                  <small>{d.last_trip ? `Last trip ${dateTime(d.last_trip)}` : 'No trips yet'}</small>
                </span>
                <span className="kit-count"><b className="tabular">{d.trips_total ?? 0}</b><small>TRIPS</small></span>
                <Icon name="arrow" size={16} className="kit-chevron" />
              </button>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export default function Trips() {
  const { token } = useSession();
  const [tab, setTab] = useState('drivers');
  const [filter, setFilter] = useState({ status: '', route: '', date: '' });
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const trips = useAsync(() => (tab === 'trips' ? api(`/api/admin/trips${q ? `?${q}` : ''}`, { token }) : Promise.resolve(null)), [tab, q, token]);
  const drivers = useAsync(() => api('/api/admin/drivers', { token }), [token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [schedule, setSchedule] = useState({ fleetCode: '', when: '' });
  const [detail, setDetail] = useState(null);
  const [driver, setDriver] = useState(null);
  const a = useAction();

  const act = (trip, what) => {
    if (what !== 'start' && !window.confirm(`${what === 'end' ? 'End' : 'Cancel'} trip #${trip.id}?`)) return;
    a.run(() => api(`/api/admin/trips/${trip.id}/${what}`, { token, method: 'POST', body: {} }), `Trip #${trip.id}: ${what}`).then(() => { trips.reload(); drivers.reload(); });
  };

  return (
    <Page eyebrow="Transport office" title="Trips" subtitle="Drivers and their trip history, every trip on the network, and scheduling." wide>
      <div className="kit-stack">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'drivers', label: 'Drivers' }, { value: 'trips', label: 'All trips' }, { value: 'schedule', label: 'Schedule' }]} />
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>

        {tab === 'drivers' && <DriversTab drivers={drivers} onOpen={setDriver} />}

        {tab === 'trips' && (
          <Panel title={`Trips (${trips.data?.length ?? '…'})`} icon="list">
            <div className="form-row filters-row">
              <Field label="Status">
                <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
                  <option value="">All statuses</option><option value="active">Running</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Route code"><input value={filter.route} onChange={(e) => setFilter((f) => ({ ...f, route: e.target.value }))} placeholder="e.g. 118" /></Field>
              <Field label="Date"><input type="date" value={filter.date} onChange={(e) => setFilter((f) => ({ ...f, date: e.target.value }))} /></Field>
            </div>
            <ErrorText>{trips.error?.message}</ErrorText>
            <Table
              rows={trips.data}
              empty="No trips match these filters."
              columns={[
                { key: 'id', label: 'Trip', render: (t) => <b>#{t.id}</b> },
                { key: 'route_code', label: 'Route', wrap: true, render: (t) => <><span className="route-code sm">{t.route_code}</span> {t.route_name}</> },
                { key: 'fleet_code', label: 'Bus / driver', render: (t) => <>{t.fleet_code}<small>{t.driver_name ?? 'No driver'}{t.started_by === 'tracker' ? ' · started by GPS tracker' : ''}</small></> },
                { key: 'when', label: 'When', render: (t) => <>{dateTime(tripWhen(t))}<small>{t.ended_at ? `ended ${time(t.ended_at)} · ${duration(t.started_at, t.ended_at)}` : t.status === 'active' ? 'running' : ''}</small></> },
                { key: 'status', label: 'Status', render: (t) => <><Badge tone={TRIP_TONE[t.status]}>{TRIP_TEXT[t.status] ?? t.status}</Badge>{t.flagged && <> <Badge tone="danger">{t.flag_reason}</Badge></>}</> },
                { key: 'attendance', label: 'Riders', align: 'right' },
                {
                  key: 'x', label: '',
                  render: (t) => (
                    <RowActions>
                      <button className="link" onClick={() => setDetail(t)}><Icon name="eye" size={13} />Open</button>
                      {t.status === 'scheduled' && <button className="link" onClick={() => act(t, 'start')}>Start</button>}
                      {t.status === 'active' && <button className="link" onClick={() => act(t, 'end')}>End</button>}
                      {['scheduled', 'active'].includes(t.status) && <button className="link danger" onClick={() => act(t, 'cancel')}>Cancel</button>}
                    </RowActions>
                  ),
                },
              ]}
            />
          </Panel>
        )}

        {tab === 'schedule' && (
          <Panel title="Schedule a trip" icon="clock">
            <p className="muted">The trip appears in the driver's app; their Start Trip runs it.</p>
            <form className="form-row" onSubmit={(e) => { e.preventDefault(); a.run(() => api('/api/admin/trips', { token, body: { fleetCode: schedule.fleetCode, scheduledFor: new Date(schedule.when).toISOString() } }), "Trip scheduled. The driver's Start Trip will run it.").then(trips.reload); }}>
              <Field label="Bus">
                <select value={schedule.fleetCode} onChange={(e) => setSchedule((s) => ({ ...s, fleetCode: e.target.value }))} required>
                  <option value="">Choose a bus</option>
                  {(buses.data ?? []).filter((b) => b.route_code && b.driver_name).map((b) => <option key={b.id} value={b.fleet_code}>{b.fleet_code} · route {b.route_code} · {b.driver_name}</option>)}
                </select>
              </Field>
              <Field label="When"><input type="datetime-local" value={schedule.when} onChange={(e) => setSchedule((s) => ({ ...s, when: e.target.value }))} required /></Field>
              <button className="btn primary inline" disabled={a.busy}><Icon name="plus" size={14} />Schedule trip</button>
            </form>
          </Panel>
        )}
      </div>
      {detail && <TripDetail token={token} trip={detail} onClose={() => setDetail(null)} />}
      {driver && <DriverTrips token={token} driver={driver} onClose={() => setDriver(null)} />}
    </Page>
  );
}
