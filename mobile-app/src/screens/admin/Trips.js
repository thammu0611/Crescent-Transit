import Slider from '@react-native-community/slider';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Block, Chips, DetailModal, Figure, duration } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import { Dot, MapBox, Polyline, ll } from '../../components/maps';
import {
  Avatar, Badge, Button, confirm, DataList, DateField, Empty, ErrorText, ItemCard, KV, LinkButton, Notice, PageHead, Panel,
  RouteCode, Row, Screen, SearchBox, SectionTitle, Segmented, Select, Stat, StatGrid, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { STATUS_TEXT, date, dateTime, daysAgo, isoDay, thisMonth, time } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G, shadow } from '../../theme.js';

const TRIP_TONE = { active: 'live', scheduled: 'delayed', completed: 'offline', cancelled: 'danger' };
const TRIP_TEXT = { active: 'Running', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
const tripWhen = (t) => (t.status === 'scheduled' ? t.scheduled_for : t.started_at);

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
  if (!path.length) return <Txt muted>No stored fixes for this trip.</Txt>;
  const p = path[i];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ height: 300, borderRadius: 14, overflow: 'hidden' }}>
        <MapBox fitPoints={path} fitKey={path.length}>
          <Polyline coordinates={path.map(ll)} strokeColor="rgba(15,30,60,0.3)" strokeWidth={3} />
          <Polyline coordinates={path.slice(0, i + 1).map(ll)} strokeColor={C.live} strokeWidth={4} />
          <Dot point={p} color={C.red} size={18} />
        </MapBox>
      </View>
      <Row>
        <Button small title={playing ? 'Pause' : 'Play'} variant="ghost" onPress={() => { if (i === path.length - 1) setI(0); setPlaying((x) => !x); }} />
        <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={path.length - 1} step={1} value={i} onValueChange={(v) => setI(Math.round(v))} minimumTrackTintColor={C.indigo} accessibilityLabel="Replay position" />
      </Row>
      <Segmented value={speed} onChange={setSpeed} options={[1, 4, 16].map((sp) => ({ value: sp, label: `${sp}×` }))} />
      <Txt muted small>{time(p.recorded_at)} · {Math.round(p.speed_kmh ?? 0)} km/h · fix {i + 1} of {path.length}</Txt>
    </View>
  );
}

function TripDetail({ token, trip, onClose }) {
  const [tab, setTab] = useState('register');
  const reg = useAsync(() => api(`/api/trips/${trip.id}/attendance`, { token }), [trip.id]);
  const path = useAsync(() => (tab === 'replay' ? api(`/api/trips/${trip.id}/path`, { token }) : Promise.resolve(null)), [tab, trip.id]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <Screen>
          <Row>
            <Txt bold style={{ flex: 1, fontSize: 18 }}>Trip #{trip.id} · route {trip.route_code} · {trip.fleet_code}</Txt>
            <Button small variant="ghost" title="Close" onPress={onClose} />
          </Row>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'register', label: 'Register' }, { value: 'replay', label: 'Replay' }]} />
          {tab === 'register' ? (
            <>
              <Txt muted small>{reg.data?.onBoard ?? 0} on board now · capacity {reg.data?.capacity ?? '—'} · {reg.data?.records.length ?? 0} records</Txt>
              <ErrorText>{reg.error?.message}</ErrorText>
              <DataList
                rows={reg.data?.records}
                keyOf={(r) => r.attendance_id}
                empty="No attendance on this trip."
                render={(r) => (
                  <ItemCard title={`${r.full_name} (${r.username})`} right={r.flagged ? <Badge tone="danger">flagged</Badge> : null}>
                    <KV k="Status" v={STATUS_TEXT[r.status]} />
                    <KV k="Method" v={r.method} />
                    <KV k="Boarded" v={`${time(r.boarded_at)} ${r.boarding_stop ?? ''}`} />
                    <KV k="Alighted" v={r.alighted_at ? `${time(r.alighted_at)} ${r.alighting_stop ?? ''}` : '—'} />
                  </ItemCard>
                )}
              />
            </>
          ) : path.data ? <Replay path={path.data} /> : path.error ? <ErrorText>{path.error.message}</ErrorText> : <Txt muted>Loading…</Txt>}
        </Screen>
      </SafeAreaView>
    </Modal>
  );
}

/** One trip as a row: route, bus, start-end, duration, status and riders. */
function TripRow({ t, onPress, showDriver }) {
  const when = tripWhen(t);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: C.glass, borderRadius: 16, borderWidth: 1, borderColor: C.glassEdge }, pressed && { opacity: 0.8 }]}>
      <RouteCode code={t.route_code} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold numberOfLines={1}>{t.route_name}</Txt>
        <Txt small muted numberOfLines={1}>{t.fleet_code}{showDriver ? ` · ${t.driver_name ?? 'No driver'}` : ''}{t.started_by === 'tracker' ? ' · GPS tracker' : ''}</Txt>
        <Row gap={6}>
          <Icon name="clock" size={12} color={C.faint} />
          <Txt small muted style={{ fontVariant: ['tabular-nums'] }}>
            {t.status === 'scheduled' ? `Planned ${time(when)}` : `${time(t.started_at)} – ${t.ended_at ? time(t.ended_at) : 'now'}`}
            {t.status !== 'scheduled' && t.status !== 'cancelled' ? ` · ${duration(t.started_at, t.ended_at ?? new Date())}` : ''}
          </Txt>
        </Row>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Badge tone={TRIP_TONE[t.status]}>{TRIP_TEXT[t.status] ?? t.status}</Badge>
        <Txt small muted>{t.attendance} rider{t.attendance === 1 ? '' : 's'}</Txt>
        {t.flagged ? <Badge tone="danger">{t.flag_reason ?? 'flagged'}</Badge> : null}
      </View>
    </Pressable>
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
  if (!trips.length) return <Empty icon="clock">No trips match these filters.</Empty>;
  return groups.map(([day, list]) => (
    <View key={day} style={{ gap: 8 }}>
      <Row style={{ marginTop: 4 }}>
        <Text style={{ flex: 1, fontSize: 12, ...F[700], color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }}>{date(`${day}T06:30:00Z`)}</Text>
        <Txt small muted>{list.length} trip{list.length === 1 ? '' : 's'}</Txt>
      </Row>
      {list.map((t) => <TripRow key={t.id} t={t} showDriver={showDriver} onPress={() => onOpen(t)} />)}
    </View>
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

/** One driver's complete trip history, from the trips table (doc B.8). */
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
    <DetailModal title={driver.full_name} subtitle={`@${driver.username} · trip history`} onClose={onClose} refreshing={trips.loading && trips.data != null} onRefresh={trips.reload}>
      <View style={{ backgroundColor: C.glass, borderRadius: 22, padding: 18, gap: 16, borderWidth: 1, borderColor: C.glassEdge, ...shadow }}>
        <Row gap={14}>
          <Avatar name={driver.full_name} size={54} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 18, ...F[700], color: C.ink }}>{driver.full_name}</Text>
            <Row gap={6} wrap>
              {driver.fleet_code ? <Badge tone="info">{driver.fleet_code}</Badge> : <Badge tone="delayed">No bus assigned</Badge>}
              {driver.route_code ? <Badge tone="offline">{`Route ${driver.route_code}`}</Badge> : null}
              {driver.on_trip ? <Badge tone="live">On trip</Badge> : null}
            </Row>
          </View>
        </Row>
        {driver.route_name ? <KV k="Route" v={`${driver.route_code} · ${driver.route_name}`} /> : null}
        {driver.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${driver.phone}`)} accessibilityRole="link">
            <Row gap={6}><Icon name="phone" size={14} color={C.red} /><Text style={{ color: C.red, ...F[600] }}>{driver.phone}</Text></Row>
          </Pressable>
        ) : null}
        <View style={{ height: 1, backgroundColor: C.line2 }} />
        <Row>
          <Figure value={inRange.filter((t) => t.status !== 'scheduled').length} label="Trips" />
          <Figure value={count('completed')} label="Completed" />
          <Figure value={count('cancelled')} label="Cancelled" />
          <Figure value={avg == null ? '—' : duration(new Date(0), new Date(avg))} label="Avg time" />
        </Row>
      </View>

      <View style={{ gap: 10 }}>
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
      </View>
      <ErrorText>{trips.error?.message}</ErrorText>
      {trips.data == null ? <DataList rows={null} render={() => null} /> : <TripsByDate trips={shown} onOpen={setOpen} />}
      {open && <TripDetail token={token} trip={open} onClose={() => setOpen(null)} />}
    </DetailModal>
  );
}

/** Drivers with their bus and how many trips they have run. */
function DriversTab({ token, drivers, onOpen }) {
  const [q, setQ] = useState('');
  const list = drivers.data ?? null;
  const needle = q.trim().toLowerCase();
  const shown = list?.filter((d) => !needle || [d.full_name, d.username, d.fleet_code, d.route_code, d.route_name].some((v) => v && String(v).toLowerCase().includes(needle)));
  const sum = (f) => (list ?? []).reduce((n, d) => n + f(d), 0);
  return (
    <>
      <StatGrid>
        <Stat icon="user" label="Drivers" value={list?.length} />
        <Stat icon="bus" label="On trip now" value={list ? sum((d) => (d.on_trip ? 1 : 0)) : null} tone="live" />
        <Stat icon="clock" label="Trips run" value={list ? sum((d) => d.trips_total ?? 0) : null} />
        <Stat icon="alert" label="Without a bus" value={list ? sum((d) => (d.fleet_code ? 0 : 1)) : null} tone={list && sum((d) => (d.fleet_code ? 0 : 1)) ? 'delayed' : undefined} />
      </StatGrid>
      <Panel title="Drivers" icon="users">
        <SearchBox value={q} onChange={setQ} placeholder="Search driver, bus or route" />
        <ErrorText>{drivers.error?.message}</ErrorText>
        <DataList
          rows={shown}
          empty="No drivers match."
          render={(d) => (
            <Pressable onPress={() => onOpen(d)} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, borderLeftWidth: d.on_trip ? 4 : 1, borderLeftColor: d.on_trip ? C.live : C.glassEdge }, pressed && { opacity: 0.8 }]}>
              <View>
                <Avatar name={d.full_name} size={46} />
                {d.on_trip ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: C.live, borderWidth: 2, borderColor: '#fff' }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt bold numberOfLines={1}>{d.full_name}</Txt>
                <Row gap={6}>
                  <Icon name="bus" size={13} color={d.fleet_code ? C.navy : C.faint} />
                  <Txt small muted numberOfLines={1} style={{ flex: 1 }}>{d.fleet_code ? `${d.fleet_code}${d.route_code ? ` · Route ${d.route_code}` : ''}` : 'No bus assigned'}</Txt>
                </Row>
                <Txt small muted>{d.last_trip ? `Last trip ${dateTime(d.last_trip)}` : 'No trips yet'}</Txt>
              </View>
              <View style={{ alignItems: 'center', minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, backgroundColor: C.navy50 }}>
                <Text style={{ fontSize: 20, ...F.display, color: C.navy, fontVariant: ['tabular-nums'] }}>{d.trips_total ?? 0}</Text>
                <Text style={{ fontSize: 10, ...F[600], color: C.muted, letterSpacing: 0.5 }}>TRIPS</Text>
              </View>
              <Icon name="arrow" size={16} color={C.faint} />
            </Pressable>
          )}
        />
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
  const { refreshing, onRefresh } = useRefresh(trips, buses, drivers);

  const act = async (trip, what) => {
    if (what !== 'start' && !(await confirm(`${what === 'end' ? 'End' : 'Cancel'} trip #${trip.id}?`, '', what === 'end' ? 'End trip' : 'Cancel trip', true))) return;
    a.run(() => api(`/api/admin/trips/${trip.id}/${what}`, { token, method: 'POST', body: {} }), `Trip #${trip.id}: ${what}`).then(() => { trips.reload(); drivers.reload(); });
  };

  const scheduleTrip = () => {
    if (!schedule.fleetCode || !schedule.when) return a.setError('Choose a bus and a time.');
    a.run(() => api('/api/admin/trips', { token, body: { fleetCode: schedule.fleetCode, scheduledFor: new Date(schedule.when).toISOString() } }), "Trip scheduled. The driver's Start Trip will run it.").then(trips.reload);
  };

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="clock" colors={G.navy} eyebrow="Transport office" title="Trips" subtitle="Drivers and their trip history, every trip on the network, and scheduling." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'drivers', label: 'Drivers' }, { value: 'trips', label: 'All trips' }, { value: 'schedule', label: 'Schedule' }]} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>

      {tab === 'drivers' && <DriversTab token={token} drivers={drivers} onOpen={setDriver} />}

      {tab === 'trips' && (
        <>
          <Block title="Filters">
            <Select
              label="Status"
              value={filter.status}
              onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
              options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Running' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }]}
            />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <TextField label="Route code" value={filter.route} onChangeText={(v) => setFilter((f) => ({ ...f, route: v }))} placeholder="e.g. 118" style={{ flex: 1 }} autoCapitalize="characters" />
              <View style={{ flex: 1 }}><DateField label="Date" value={filter.date} onChange={(v) => setFilter((f) => ({ ...f, date: v }))} clearable /></View>
            </Row>
          </Block>
          <SectionTitle title={`Trips (${trips.data?.length ?? '…'})`} />
          <ErrorText>{trips.error?.message}</ErrorText>
          <DataList
            rows={trips.data}
            empty="No trips match these filters."
            render={(t) => (
              <View style={{ gap: 6 }}>
                <TripRow t={t} showDriver onPress={() => setDetail(t)} />
                {['scheduled', 'active'].includes(t.status) ? (
                  <Row gap={12} style={{ paddingHorizontal: 6 }}>
                    <Txt small muted style={{ flex: 1 }}>{`#${t.id} · ${dateTime(tripWhen(t))}`}</Txt>
                    {t.status === 'scheduled' && <LinkButton title="Start" onPress={() => act(t, 'start')} />}
                    {t.status === 'active' && <LinkButton title="End" onPress={() => act(t, 'end')} />}
                    <LinkButton danger title="Cancel" onPress={() => act(t, 'cancel')} />
                  </Row>
                ) : null}
              </View>
            )}
          />
        </>
      )}

      {tab === 'schedule' && (
        <Panel title="Schedule a trip" icon="clock">
          <Txt muted small>The trip appears in the driver's app; their Start Trip runs it.</Txt>
          <Select
            label="Bus"
            value={schedule.fleetCode}
            onChange={(v) => setSchedule((x) => ({ ...x, fleetCode: v }))}
            placeholder="Choose a bus"
            searchable
            options={(buses.data ?? []).filter((b) => b.route_code && b.driver_name).map((b) => ({ value: b.fleet_code, label: `${b.fleet_code} · route ${b.route_code} · ${b.driver_name}` }))}
          />
          <DateField label="When" mode="datetime" value={schedule.when} onChange={(v) => setSchedule((x) => ({ ...x, when: v }))} />
          <Button title="Schedule trip" icon="plus" busy={a.busy} onPress={scheduleTrip} />
        </Panel>
      )}

      {detail && <TripDetail token={token} trip={detail} onClose={() => setDetail(null)} />}
      {driver && <DriverTrips token={token} driver={driver} onClose={() => setDriver(null)} />}
    </Screen>
  );
}
