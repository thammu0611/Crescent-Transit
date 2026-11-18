import Slider from '@react-native-community/slider';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DetailModal, Figure, duration } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import { Dot, MapBox, Polyline, ll } from '../../components/maps';
import {
  Avatar, Badge, Button, confirm, DangerDialog, DataList, DateField, Empty, ErrorText, ItemCard, KV, ListCard, Notice, Panel,
  RouteCode, Row, Screen, SearchBox, Segmented, Select, Sheet, Skeleton, Stat, StatGrid, Text, Txt, useTabBarSpace,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { STATUS_TEXT, date, dateTime, daysAgo, isoDay, thisMonth, time } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { DIRECTION_TEXT } from '../../lib/rules.js';
import { useSession } from '../../lib/session.js';
import { C, F, R, shadow } from '../../theme.js';

const TRIP_TONE = { active: 'live', scheduled: 'delayed', completed: 'offline', cancelled: 'danger' };
const TRIP_TEXT = { active: 'Running', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
const tripWhen = (t) => (t.status === 'scheduled' ? t.scheduled_for : t.started_at);
const RUN = { UP: 'To college', DOWN: 'From college' };

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

function TripDetail({ token, trip, onClose, onAct }) {
  const [tab, setTab] = useState('register');
  const reg = useAsync(() => api(`/api/trips/${trip.id}/attendance`, { token }), [trip.id]);
  const path = useAsync(() => (tab === 'replay' ? api(`/api/trips/${trip.id}/path`, { token }) : Promise.resolve(null)), [tab, trip.id]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <Screen>
          <Row>
            <Txt bold style={{ flex: 1, fontSize: 18 }}>Trip #{trip.id} · route {trip.route_code} · {trip.fleet_code} · {DIRECTION_TEXT[trip.direction]}</Txt>
            <Button small variant="ghost" title="Close" onPress={onClose} />
          </Row>
          {onAct && ['scheduled', 'active'].includes(trip.status) ? (
            <Row gap={10}>
              {trip.status === 'scheduled' ? <Button small title="Start" icon="play" onPress={() => onAct('start')} style={{ flex: 1 }} /> : null}
              {trip.status === 'active' ? <Button small title="End trip" variant="ghost" icon="stop" onPress={() => onAct('end')} style={{ flex: 1 }} /> : null}
              <Button small title="Cancel trip" variant="danger" onPress={() => onAct('cancel')} style={{ flex: 1 }} />
            </Row>
          ) : null}
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

/** The trip's status as a chip: running, completed with a tick, cancelled, scheduled, or flagged. */
function TripChip({ t }) {
  if (t.status === 'completed') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 26, borderRadius: 13, backgroundColor: C.live50 }}>
        <Icon name="tick" size={12} color={C.live} strokeWidth={2.6} />
        <Text style={{ color: C.live, fontSize: 12.5, ...F[600] }}>Completed</Text>
      </View>
    );
  }
  return <Badge style={{ alignSelf: 'center' }} tone={TRIP_TONE[t.status] === 'danger' ? 'offline' : TRIP_TONE[t.status]}>{TRIP_TEXT[t.status] ?? t.status}</Badge>;
}

/** One trip in the list: a checkbox, the route tile, what and when, and its status. */
function TripCard({ t, selected, onToggle, onPress }) {
  const when = tripWhen(t);
  const sub = t.status === 'scheduled'
    ? `${RUN[t.direction] ?? 'By time'} · planned ${time(when)} · ${t.fleet_code}`
    : `${RUN[t.direction] ?? ''} · ${time(t.started_at)} · ${t.status === 'cancelled' && !t.ended_at ? 'not started' : duration(t.started_at, t.ended_at ?? new Date())} · ${t.attendance} rider${t.attendance === 1 ? '' : 's'}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Route ${t.route_code} ${t.route_name}, ${TRIP_TEXT[t.status]}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: selected ? C.navy50 : C.card, borderRadius: R.lg, borderWidth: 1, borderColor: selected ? C.navy : C.line2 }, pressed && { opacity: 0.85 }]}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Select trip ${t.id}`} onPress={onToggle} hitSlop={10}
        style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: selected ? C.navyFill : C.faint, backgroundColor: selected ? C.navyFill : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
      </Pressable>
      <View style={{ minWidth: 44, height: 32, paddingHorizontal: 7, borderRadius: 10, backgroundColor: C.navyFill, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 14, ...F.displayBold }}>{t.route_code}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 15.5, lineHeight: 20, ...F[700], color: C.ink }} numberOfLines={2}>{t.route_name}</Text>
        <Txt small muted numberOfLines={2}>{sub}</Txt>
        {/* Status under the text, so the route name and times get the whole width on a narrow phone. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <TripChip t={t} />
          {t.flagged ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="alert" size={12} color={C.danger} />
              <Text style={{ fontSize: 12, ...F[600], color: C.danger }} numberOfLines={1}>{String(t.flag_reason ?? 'Flagged').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** One trip as a row: route, bus, start-end, duration, status and riders. */
function TripRow({ t, onPress, showDriver }) {
  const when = tripWhen(t);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: C.glass, borderRadius: 16, borderWidth: 1, borderColor: C.glassEdge }, pressed && { opacity: 0.8 }]}>
      <RouteCode code={t.route_code} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold numberOfLines={2}>{t.route_name}</Txt>
        <Txt small muted numberOfLines={2}>{DIRECTION_TEXT[t.direction]} · {t.fleet_code}{showDriver ? ` · ${t.driver_name ?? 'No driver'}` : ''}{t.started_by === 'tracker' ? ' · GPS tracker' : ''}</Txt>
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
  const [run, setRun] = useState('');
  const [open, setOpen] = useState(null);
  const all = trips.data ?? [];
  const inRange = all.filter((t) => inPeriod(t, period) && (!run || t.direction === run));
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

      <Row gap={8}>
        <Select style={{ flex: 1 }} label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        <Select style={{ flex: 1 }} label="Direction" value={run} onChange={setRun} options={[{ value: '', label: 'Both' }, { value: 'UP', label: 'To college' }, { value: 'DOWN', label: 'From college' }]} />
        <Select
          style={{ flex: 1 }}
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: `All (${inRange.length})` },
            { value: 'completed', label: `Completed (${count('completed')})` },
            { value: 'active', label: `Running (${count('active')})` },
            { value: 'scheduled', label: `Scheduled (${count('scheduled')})` },
            { value: 'cancelled', label: `Cancelled (${count('cancelled')})` },
          ]}
        />
      </Row>
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
      </StatGrid>
      <Panel title="Drivers" icon="users">
        <SearchBox value={q} onChange={setQ} placeholder="Search driver, bus or route" />
        <ErrorText>{drivers.error?.message}</ErrorText>
        <DataList
          rows={shown}
          empty="No drivers match."
          render={(d) => (
            <ListCard
              onPress={() => onOpen(d)}
              tone={d.on_trip ? 'live' : undefined}
              lead={(
                <View>
                  <Avatar name={d.full_name} size={46} />
                  {d.on_trip ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: C.live, borderWidth: 2, borderColor: '#fff' }} /> : null}
                </View>
              )}
              title={d.full_name}
              lines={[d.fleet_code ? `${d.fleet_code}${d.route_code ? ` · Route ${d.route_code}` : ''}` : 'No bus assigned', d.last_trip ? `Last trip ${dateTime(d.last_trip)}` : 'No trips yet']}
              count={d.trips_total ?? 0}
              countLabel="TRIPS"
            />
          )}
        />
      </Panel>
    </>
  );
}

const STATUS_CHIPS = [['active', 'Running'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

export default function Trips({ route }) {
  const { token } = useSession();
  const tabSpace = useTabBarSpace();
  const [tab, setTab] = useState('trips');
  const [status, setStatus] = useState('');
  const [today, setToday] = useState(false);
  const [query, setQuery] = useState('');
  // The dashboard opens this list: its running trips, or all of them.
  useEffect(() => {
    if (route?.params?.at == null) return;
    setTab('trips');
    setStatus(route.params.status ?? '');
    setToday(false);
    setQuery('');
  }, [route?.params?.at, route?.params?.status]);
  const [picked, setPicked] = useState([]);
  const [ask, setAsk] = useState(null); // 'end' | 'cancel' for the selected trips
  const trips = useAsync(() => (tab !== 'drivers' ? api('/api/admin/trips', { token }) : Promise.resolve(null)), [tab, token]);
  const drivers = useAsync(() => api('/api/admin/drivers', { token }), [token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [schedule, setSchedule] = useState({ fleetCode: '', when: '' });
  const [scheduling, setScheduling] = useState(false);
  const [detail, setDetail] = useState(null);
  const [driver, setDriver] = useState(null);
  const a = useAction();
  const { refreshing, onRefresh } = useRefresh(trips, buses, drivers);

  const all = trips.data ?? [];
  const q = query.trim().toLowerCase();
  const base = tab === 'scheduled' ? all.filter((t) => t.status === 'scheduled') : all;
  const shown = base
    .filter((t) => (tab === 'scheduled' || !status || t.status === status) && (!today || isToday(tripWhen(t))))
    .filter((t) => !q || [t.route_code, t.route_name, t.fleet_code, t.driver_name].some((v) => v && String(v).toLowerCase().includes(q)))
    .sort((x, y) => (isToday(tripWhen(y)) - isToday(tripWhen(x))) || (new Date(tripWhen(y)) - new Date(tripWhen(x))));
  const running = all.filter((t) => t.status === 'active').length;
  const chosen = all.filter((t) => picked.includes(t.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  useEffect(() => { setPicked([]); }, [tab]);

  const act = async (trip, what) => {
    if (what !== 'start' && !(await confirm(`${what === 'end' ? 'End' : 'Cancel'} trip #${trip.id}?`, '', what === 'end' ? 'End trip' : 'Cancel trip', true))) return;
    a.run(() => api(`/api/admin/trips/${trip.id}/${what}`, { token, method: 'POST', body: {} }), `Trip #${trip.id}: ${what}`).then(() => { trips.reload(); drivers.reload(); });
  };
  const bulk = async (what) => {
    const list = chosen.filter((t) => (what === 'end' ? t.status === 'active' : ['active', 'scheduled'].includes(t.status)));
    const ok = await a.run(async () => {
      for (const t of list) await api(`/api/admin/trips/${t.id}/${what}`, { token, method: 'POST', body: {} });
      return true;
    }, `${list.length} trip${list.length === 1 ? '' : 's'} ${what === 'end' ? 'ended' : 'cancelled'}.`);
    setAsk(null);
    if (ok) setPicked([]);
    trips.reload();
    drivers.reload();
  };
  const scheduleTrip = () => {
    if (!schedule.fleetCode || !schedule.when) return a.setError('Choose a bus and a time.');
    a.run(() => api('/api/admin/trips', { token, body: { fleetCode: schedule.fleetCode, scheduledFor: new Date(schedule.when).toISOString(), direction: schedule.direction || undefined } }), "Trip scheduled. The driver's Start Trip will run it.")
      .then((r) => { if (r) setScheduling(false); trips.reload(); });
  };

  const endable = chosen.filter((t) => t.status === 'active').length;
  const cancellable = chosen.filter((t) => ['active', 'scheduled'].includes(t.status));
  const routesText = (list) => {
    const codes = [...new Set(list.map((t) => t.route_code))];
    return codes.length <= 2 ? `Routes ${codes.join(' and ')}` : `${codes.length} routes`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen safeTop refreshing={refreshing} onRefresh={onRefresh} contentStyle={picked.length ? { paddingBottom: 100 } : null}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34, ...F.displayBold, color: C.ink }}>Trips</Text>
          <Button title="Schedule trip" icon="plus" onPress={() => { a.setError(null); setScheduling(true); }} style={{ minHeight: 44, paddingHorizontal: 16 }} />
        </View>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'drivers', label: 'Drivers' }, { value: 'trips', label: 'All trips' }, { value: 'scheduled', label: 'Scheduled' }]} />
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>

        {tab === 'drivers' && <DriversTab token={token} drivers={drivers} onOpen={setDriver} />}

        {tab !== 'drivers' && (
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Route, bus or driver" />
            {tab === 'trips' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }} style={{ marginRight: -16 }}>
                {STATUS_CHIPS.map(([k, label]) => {
                  const on = status === k;
                  return (
                    <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setStatus(on ? '' : k)}
                      style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: on ? C.navy : C.line, backgroundColor: on ? C.navy50 : C.card, justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14, ...F[600], color: on ? C.navy : C.ink }}>{label}{k === 'active' ? ` ${running}` : ''}</Text>
                    </Pressable>
                  );
                })}
                <Pressable accessibilityRole="button" accessibilityState={{ selected: today }} onPress={() => setToday((x) => !x)}
                  style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: today ? C.navy : C.line, backgroundColor: today ? C.navy50 : C.card, justifyContent: 'center' }}>
                  <Text style={{ fontSize: 14, ...F[600], color: today ? C.navy : C.ink }}>Today</Text>
                </Pressable>
              </ScrollView>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt muted>{trips.data ? `${shown.length} trip${shown.length === 1 ? '' : 's'} · today first` : 'Loading trips…'}</Txt>
              {shown.length ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPicked(picked.length ? [] : shown.filter((t) => ['active', 'scheduled'].includes(t.status)).map((t) => t.id))} style={{ minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: C.link, fontSize: 15, ...F[600] }}>{picked.length ? 'Clear' : 'Select'}</Text>
                </Pressable>
              ) : null}
            </View>
            {trips.error ? (
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
                <ErrorText>{trips.error.message}</ErrorText>
                <Button title="Try again" variant="ghost" icon="refresh" onPress={trips.reload} />
              </View>
            ) : trips.data == null ? (
              <View style={{ gap: 10 }}><Skeleton height={76} /><Skeleton height={76} /><Skeleton height={76} /></View>
            ) : shown.length === 0 ? (
              <Empty icon="clock">{tab === 'scheduled' ? 'No trips are scheduled.' : 'No trips match these filters.'}</Empty>
            ) : (
              <View style={{ gap: 10 }}>
                {shown.slice(0, 200).map((t) => (
                  <TripCard key={t.id} t={t} selected={picked.includes(t.id)} onToggle={() => toggle(t.id)} onPress={() => setDetail(t)} />
                ))}
              </View>
            )}
          </>
        )}
      </Screen>

      {/* Bulk actions for the selected trips. */}
      {picked.length ? (
        <View style={{ position: 'absolute', left: 14, right: 14, bottom: tabSpace + 4, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, paddingLeft: 16, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, ...shadow }}>
          <Text style={{ flex: 1, fontSize: 15, ...F[700], color: C.ink }}>{picked.length} selected</Text>
          <Button small title="End trips" variant="ghost" disabled={!endable} onPress={() => setAsk('end')} />
          <Pressable accessibilityRole="button" disabled={!cancellable.length} onPress={() => setAsk('cancel')}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.dark ? 'rgba(248,113,113,0.45)' : 'rgba(220,38,38,0.35)', backgroundColor: C.raised, justifyContent: 'center', opacity: cancellable.length ? 1 : 0.45 }}>
            <Text style={{ color: C.danger, fontSize: 14, ...F[600] }}>Cancel trips</Text>
          </Pressable>
        </View>
      ) : null}

      {ask === 'cancel' ? (
        <DangerDialog
          title={`Cancel ${cancellable.length} ${cancellable.every((t) => t.status === 'active') ? 'running ' : ''}trip${cancellable.length === 1 ? '' : 's'}?`}
          message={`${routesText(cancellable)} stop sharing location and students get a cancellation alert. Attendance already recorded stays saved. You can't undo this.`}
          keepLabel="Keep trips" okLabel={`Cancel ${cancellable.length} trip${cancellable.length === 1 ? '' : 's'}`} busy={a.busy}
          onKeep={() => setAsk(null)} onOk={() => bulk('cancel')} />
      ) : null}
      {ask === 'end' ? (
        <DangerDialog
          title={`End ${endable} running trip${endable === 1 ? '' : 's'}?`}
          message={`${routesText(chosen.filter((t) => t.status === 'active'))} stop sharing location now. Attendance already recorded stays saved.`}
          keepLabel="Keep running" okLabel={`End ${endable} trip${endable === 1 ? '' : 's'}`} busy={a.busy}
          onKeep={() => setAsk(null)} onOk={() => bulk('end')} />
      ) : null}

      {scheduling ? (
        <Sheet title="Schedule a trip" onClose={() => setScheduling(false)}>
          <View style={{ gap: 12 }}>
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
            <Txt bold>Direction</Txt>
            <Segmented value={schedule.direction ?? ''} onChange={(v) => setSchedule((x) => ({ ...x, direction: v }))} options={[{ value: '', label: 'By time' }, { value: 'UP', label: 'To college' }, { value: 'DOWN', label: 'From college' }]} />
            <ErrorText>{a.error}</ErrorText>
            <Button title="Schedule trip" icon="plus" busy={a.busy} onPress={scheduleTrip} />
          </View>
        </Sheet>
      ) : null}

      {detail && <TripDetail token={token} trip={detail} onClose={() => setDetail(null)} onAct={(w) => { act(detail, w); setDetail(null); }} />}
      {driver && <DriverTrips token={token} driver={driver} onClose={() => setDriver(null)} />}
    </View>
  );
}
