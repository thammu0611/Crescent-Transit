import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, TextInput, useWindowDimensions, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon.js';
import { BusPin, CampusPin, MapBox, RouteLayer } from '../components/maps';
import { Badge, Button, ErrorText, Frost, Select, Skeleton, Text, Txt, useTabBarSpace } from '../components/ui.js';
import { api, getSocket } from '../lib/api.js';
import { etaText, OCCUPANCY } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';
import { requestNotificationPermission, showNotification } from '../lib/notify.js';
import { ageLabel, estimateArrival, freshnessOf, LEAVE_ALERT_M } from '../lib/rules.js';
import { prettyTime } from '../lib/schedule.js';
import { useSession } from '../lib/session.js';
import { C, F, FRESH_COLOR, R, shadow, shadowLg } from '../theme.js';

const STATE_LABEL = { live: 'Live', delayed: 'Delayed', offline: 'Offline' };
const km = (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/** A round floating button over the map (layers, recentre). */
function MapButton({ icon, label, onPress, size = 44, color = C.ink, style }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center', ...shadowLg }, pressed && { opacity: 0.85 }, style]}>
      <Icon name={icon} size={size > 44 ? 22 : 20} color={color} />
    </Pressable>
  );
}

const Metric = ({ k, v }) => (
  <View style={{ flex: 1, minWidth: 0 }}>
    <Txt muted small style={{ fontSize: 12 }}>{k}</Txt>
    <Text style={{ fontSize: 16, lineHeight: 22, ...F[700], color: C.ink, marginTop: 2 }} numberOfLines={1}>{v}</Text>
  </View>
);

/** Student "Track" tab and the admin's fleet map: live buses over the socket. */
export default function LiveMap({ navigation, route: screen }) {
  const { token, user } = useSession();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const isAdmin = user?.role === 'admin';
  const [routes, setRoutes] = useState([]);
  const [routeCode, setRouteCode] = useState(user?.role === 'student' ? user.homeRouteCode ?? '' : '');
  const [stopSeq, setStopSeq] = useState(user?.role === 'student' ? user.homeStopSeq ?? null : null);
  const [route, setRoute] = useState(null);
  const [buses, setBuses] = useState({}); // busId -> snapshot
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [legend, setLegend] = useState(false);
  const [armed, setArmed] = useState(false);
  const [locStatus, setLocStatus] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const alerted = useRef(null);
  // "Another bus can take you" opens the map on that bus's route.
  const askedRoute = screen?.params?.routeCode;
  useEffect(() => {
    if (!askedRoute) return;
    setRouteCode(askedRoute);
    setStopSeq(null);
  }, [askedRoute]);
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState(null);
  const [error, setError] = useState(null);
  const map = useRef(null);
  const now = useNow();

  useEffect(() => {
    api('/api/routes').then(setRoutes).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setRoute(null);
    if (!routeCode) return;
    api(`/api/routes/${encodeURIComponent(routeCode)}`).then(setRoute).catch((e) => setError(e.message));
  }, [routeCode]);

  // Students: is location on? The bus shows either way; location adds your own dot.
  useEffect(() => {
    if (isAdmin || Platform.OS === 'web') return;
    Location.getForegroundPermissionsAsync().then((p) => setLocStatus(p.status)).catch(() => {});
  }, [isAdmin]);

  // Realtime: snapshot on subscribe, then one event per accepted fix.
  useEffect(() => {
    const socket = getSocket(token);
    const subscribe = () => socket.emit('subscribe', { route: routeCode || null });
    const onConnect = () => { setConnected(true); subscribe(); };
    const onDisconnect = () => setConnected(false);
    const onSnapshot = (list) => { setDenied(null); setBuses(Object.fromEntries(list.map((b) => [b.busId, b]))); };
    const onDenied = ({ code }) => { setDenied(code); setBuses({}); };
    const onLocation = (b) => setBuses((prev) => ({ ...prev, [b.busId]: b }));
    const onFreshness = ({ busId, freshness }) => setBuses((prev) => (prev[busId] ? { ...prev, [busId]: { ...prev[busId], freshness } } : prev));
    const onEnded = ({ busId }) => setBuses((prev) => { const next = { ...prev }; delete next[busId]; return next; });
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('snapshot', onSnapshot);
    socket.on('live:denied', onDenied);
    socket.on('bus:location', onLocation);
    socket.on('bus:freshness', onFreshness);
    socket.on('bus:trip-ended', onEnded);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('snapshot', onSnapshot);
      socket.off('live:denied', onDenied);
      socket.off('bus:location', onLocation);
      socket.off('bus:freshness', onFreshness);
      socket.off('bus:trip-ended', onEnded);
    };
  }, [routeCode, token]);

  // Freshness is recomputed locally every second, so a bus turns amber even
  // if the phone misses the server's state-change event.
  const list = useMemo(
    () => Object.values(buses)
      .map((b) => {
        const bus = { ...b, freshness: freshnessOf(b.recordedAt, now) };
        const eta = route && stopSeq && bus.routeCode === route.code
          ? estimateArrival(route.stops, bus, stopSeq, route.segmentMinutes, { now, segmentSource: route.segmentsLearned ? 'segment-history' : 'timetable' })
          : null;
        return { ...bus, eta };
      })
      .sort((a, b) => a.routeCode.localeCompare(b.routeCode, undefined, { numeric: true })),
    [buses, now, route, stopSeq],
  );
  const selected = list.find((b) => b.busId === selectedBusId) ?? null;
  const counts = list.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {});
  const stop = route?.stops.find((s) => s.seq === stopSeq);
  // The bus this student is waiting for: the one picked, else the first on their route.
  const focus = !isAdmin ? (selected ?? list.find((b) => b.routeCode === route?.code) ?? null) : null;
  const loading = Boolean(routeCode) && !route && !error;

  // "Notify me when nearby": once per trip, when the bus comes within 2 km of the stop.
  useEffect(() => {
    if (!armed || !focus?.eta || focus.eta.passed || focus.eta.remainingM > LEAVE_ALERT_M || alerted.current === focus.tripId) return;
    alerted.current = focus.tripId;
    Vibration.vibrate([0, 250, 120, 250]);
    showNotification('Your bus is nearby', `Bus ${focus.routeCode} is ${km(focus.eta.remainingM)} from ${stop?.name ?? 'your stop'}.`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, focus?.eta?.remainingM, focus?.tripId]);

  const selectBus = (busId) => {
    const bus = list.find((b) => b.busId === busId);
    setSelectedBusId(busId);
    if (bus && bus.routeCode !== routeCode && !isAdmin) setRouteCode(bus.routeCode);
    if (bus) map.current?.focus(bus);
  };
  const recentre = () => (focus ? map.current?.focus(focus) : map.current?.fit(route?.stops ?? list));
  const notify = async () => {
    if (!armed) await requestNotificationPermission().catch(() => {});
    setArmed((a) => !a);
  };
  const turnOnLocation = async () => {
    try { setLocStatus((await Location.requestForegroundPermissionsAsync()).status); } catch { /* stays off */ }
  };
  const share = () => {
    if (!focus || !stop) return;
    Share.share({ message: `Bus ${focus.routeCode} ${focus.eta?.passed ? `has passed ${stop.name}` : `arrives at ${stop.name} in ${etaText(focus.eta)}`} (Crescent Transit)` }).catch(() => {});
  };

  const mapH = Math.round(height * 0.56);
  const top = insets.top + 12;
  const routeLabel = route ? route.name : routes.find((r) => r.code === routeCode)?.name ?? 'Choose a route';

  // Admin list: filtered by status chip and search.
  const q = query.trim().toLowerCase();
  const shown = list.filter((b) => (filter === 'all' || b.freshness === filter)
    && (!q || [b.routeCode, b.routeName, b.fleetCode, b.driverName].some((v) => v && String(v).toLowerCase().includes(q))));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* The map, full width under the floating controls. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: mapH, backgroundColor: C.raised }}>
        {loading ? null : (
          <MapBox ref={map} fitPoints={route?.stops ?? []} fitKey={route?.code} showsUserLocation={locStatus === 'granted'}>
            <CampusPin />
            <RouteLayer stops={route?.stops} highlightSeq={stopSeq ?? selected?.nearestStop?.seq} />
            {list.map((b) => <BusPin key={b.busId} bus={b} selected={b.busId === selectedBusId} onPress={selectBus} />)}
          </MapBox>
        )}
        {!isAdmin && !loading && route && !focus && !denied ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.dark ? 'rgba(5,8,12,0.45)' : 'rgba(15,23,42,0.18)' }} /> : null}
        {loading ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: mapH / 2 - 40, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, ...shadow }}>
              <Icon name="signal" size={16} color={C.navy} />
              <Text style={{ fontSize: 13, ...F[500], color: C.muted }}>Finding Bus {routeCode}…</Text>
            </View>
          </View>
        ) : null}
        {legend ? (
          <View style={{ position: 'absolute', left: 20, right: 80, bottom: 54, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(STATE_LABEL).map(([k, label]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: C.line2 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: FRESH_COLOR[k] }} />
                <Text style={{ fontSize: 11.5, color: C.ink, ...F[500] }}>{label} {k === 'live' ? '≤ 30 s' : k === 'delayed' ? '≤ 2 min' : '> 2 min'}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Floating controls. */}
      {isAdmin ? (
        <View style={{ position: 'absolute', top, left: 20, right: 20, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: query ? C.navy : C.line2, ...shadowLg }}>
              <Icon name="search" size={18} color={C.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search bus, route or driver" placeholderTextColor={C.faint} accessibilityLabel="Search buses" autoCorrect={false}
                style={[{ flex: 1, color: C.ink, fontSize: 15, ...F[500], paddingVertical: 0 }, Platform.OS === 'web' && { outlineStyle: 'none' }]} />
              {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><Icon name="x" size={16} color={C.muted} /></Pressable> : null}
            </View>
            <MapButton icon="layers" label="Map key" size={48} onPress={() => setLegend((l) => !l)} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[['all', `All ${list.length}`, C.muted], ['live', `Live ${counts.live ?? 0}`, FRESH_COLOR.live], ['delayed', `Delayed ${counts.delayed ?? 0}`, FRESH_COLOR.delayed], ['offline', `Offline ${counts.offline ?? 0}`, FRESH_COLOR.offline]].map(([k, label, dot]) => {
              const on = filter === k;
              return (
                <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setFilter(k)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: on ? C.navyFill : C.line2, backgroundColor: on ? C.navyFill : C.surface, ...shadow }}>
                  {k === 'all' ? null : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#fff' : dot }} />}
                  <Text style={{ fontSize: 13, ...F[600], color: on ? '#fff' : C.ink }}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <View style={{ position: 'absolute', top, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexShrink: 1 }}>
            <Select
              label="Route"
              value={routeCode}
              onChange={(v) => { setRouteCode(v); setSelectedBusId(null); setStopSeq(v === user?.homeRouteCode ? user.homeStopSeq ?? null : null); }}
              options={routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))}
              searchable
              trigger={(open) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`Route ${routeCode || 'none'}, change route`} onPress={open}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 14, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, ...shadowLg }, pressed && { opacity: 0.85 }]}>
                  <View style={{ minWidth: 34, height: 32, paddingHorizontal: 7, borderRadius: 16, backgroundColor: C.navyFill, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 12.5, ...F.displayBold }}>{routeCode || '—'}</Text>
                  </View>
                  <Text style={{ color: C.ink, fontSize: 14, ...F[600], flexShrink: 1 }} numberOfLines={1}>{routeLabel}</Text>
                  <Icon name="down" size={16} color={C.faint} />
                </Pressable>
              )}
            />
          </View>
          <View style={{ flex: 1 }} />
          <MapButton icon="layers" label="Map key" onPress={() => setLegend((l) => !l)} />
        </View>
      )}
      {!connected && !loading ? (
        <View accessibilityRole="alert" style={{ position: 'absolute', top: top + (isAdmin ? 106 : 56), left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, ...shadowLg }}>
          <Icon name="signal" size={18} color={C.delayed} />
          <View style={{ flex: 1 }}><Txt bold small>Reconnecting…</Txt><Txt muted small>Showing the last known positions.</Txt></View>
        </View>
      ) : null}
      {!loading ? <MapButton icon="locate" label="Centre on the bus" size={48} color={C.navy} onPress={recentre} style={{ position: 'absolute', right: 20, top: mapH - 40 - 64 }} /> : null}

      {/* The sheet. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: mapH - 40, bottom: 0, backgroundColor: C.glassStrong, overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: C.line2, ...shadowLg, shadowOffset: { width: 0, height: -8 } }}>
        <Frost intensity={70} />
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 10 }} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 + tabSpace, gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <ErrorText>{error}</ErrorText>
          {denied ? (
            <View style={{ gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={22} color={C.navy} /></View>
              <Text style={{ fontSize: 20, lineHeight: 26, ...F.display, color: C.ink }}>Live tracking is for subscribers</Text>
              <Txt muted>{denied === 'LOGIN_REQUIRED' ? 'Sign in to see live buses.' : 'Live bus positions, arrival estimates and alerts come with the ₹60 monthly subscription.'}</Txt>
              {denied === 'SUBSCRIPTION_REQUIRED' ? <Button title="Subscribe for ₹60" onPress={() => navigation.navigate('Subscription')} /> : null}
            </View>
          ) : null}

          {/* Student: the answer for your stop. */}
          {!isAdmin && !denied && loading ? <View style={{ gap: 14 }}><Skeleton height={22} /><Skeleton height={56} /><Skeleton height={64} /><Skeleton height={52} /></View> : null}
          {!isAdmin && !denied && !loading && focus && stop ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Badge tone={focus.freshness === 'offline' || !connected ? 'offline' : focus.freshness}>{focus.freshness === 'offline' || !connected ? 'Last known' : STATE_LABEL[focus.freshness]}</Badge>
                <Txt muted small>Updated {ageLabel(focus.recordedAt, now)}</Txt>
              </View>
              {locStatus && locStatus !== 'granted' ? (
                <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 14, backgroundColor: C.delayed50, borderWidth: 1, borderColor: C.line2 }}>
                  <Icon name="pin" size={20} color={C.delayed} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt bold small>Location is off</Txt>
                    <Txt small muted>The bus still shows. Turn on location to see yourself on the map. It is never stored.</Txt>
                  </View>
                </View>
              ) : null}
              <Text style={{ fontSize: 21, lineHeight: 28, ...F.display, color: C.ink }}>
                Bus {focus.routeCode} {focus.eta?.passed ? 'has passed' : focus.freshness === 'offline' ? 'was last seen heading to' : 'arrives at'} {stop.name}
                {!focus.eta?.passed && focus.freshness !== 'offline' ? <Text style={{ color: C.navy }}> in {etaText(focus.eta)}</Text> : null}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, padding: 14, borderRadius: 16, backgroundColor: C.raised }}>
                <Metric k="Distance" v={km(focus.eta?.remainingM)} />
                <Metric k="Next stop" v={focus.nearestStop?.name ?? '—'} />
                <Metric k="Speed" v={focus.freshness === 'offline' ? '—' : `${Math.round(focus.speedKmh ?? 0)} km/h`} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {locStatus && locStatus !== 'granted'
                  ? <Button title="Turn on location" icon="pin" onPress={turnOnLocation} style={{ flex: 1 }} />
                  : <Button title={armed ? 'Alert on · tap to stop' : 'Notify me when nearby'} icon="bell" variant={armed ? 'soft' : 'primary'} onPress={notify} style={{ flex: 1 }} />}
                <Pressable accessibilityRole="button" accessibilityLabel="Share arrival time" onPress={share} style={({ pressed }) => [{ width: 52, height: 52, borderRadius: R.md, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
                  <Icon name="share" size={20} color={C.ink} />
                </Pressable>
              </View>
            </>
          ) : null}
          {!isAdmin && !denied && !loading && route && stop && !focus ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' }}><Icon name="bus" size={22} color={C.navy} /></View>
                <Badge tone="offline">Not started</Badge>
              </View>
              <Text style={{ fontSize: 20, lineHeight: 26, ...F.display, color: C.ink }}>Bus {route.code} hasn't started yet</Text>
              <Txt muted>It shows here the moment the driver starts the trip. It usually reaches {stop.name} at {prettyTime(stop.scheduled_time)}.</Txt>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title={armed ? 'Alert on' : 'Tell me when it starts'} icon="bell" variant={armed ? 'soft' : 'primary'} onPress={notify} style={{ flex: 1 }} />
                <Button title="Schedule" variant="ghost" onPress={() => navigation.navigate('Schedule')} />
              </View>
            </>
          ) : null}
          {!isAdmin && !denied && !loading && route && !stop ? (
            <>
              <Text style={{ fontSize: 18, lineHeight: 24, ...F.display, color: C.ink }}>Route {route.code} · {route.stops.length} stops</Text>
              <Select label="Estimate arrival at" value={stopSeq ?? ''} onChange={(v) => setStopSeq(v === '' ? null : Number(v))} placeholder="Choose your stop" searchable
                options={route.stops.map((s) => ({ value: s.seq, label: `${s.seq}. ${s.name}` }))} />
              {list.filter((b) => b.routeCode === route.code).length === 0 ? <Txt muted small>No bus on this route is on a trip right now.</Txt> : null}
            </>
          ) : null}
          {!isAdmin && !denied && !routeCode ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
              <Text style={{ fontSize: 18, ...F.display, color: C.ink }}>Pick your route</Text>
              <Txt muted style={{ textAlign: 'center' }}>Tap the route button on the map to see its bus.</Txt>
            </View>
          ) : null}

          {/* Admin: the buses on trip. */}
          {isAdmin && !denied ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 18, ...F.display, color: C.ink }}>{shown.length} bus{shown.length === 1 ? '' : 'es'} on trip</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="sort" size={16} color={C.navy} />
                  <Text style={{ color: C.navy, fontSize: 13.5, ...F[600] }}>By route</Text>
                </View>
              </View>
              {shown.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 10, paddingVertical: 20 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }}><Icon name={q ? 'search' : 'bus'} size={26} color={C.muted} /></View>
                  <Text style={{ fontSize: 18, ...F.display, color: C.ink, textAlign: 'center' }}>{q ? `No buses match "${query.trim()}"` : filter !== 'all' ? `No ${STATE_LABEL[filter].toLowerCase()} buses` : 'No bus is on a trip'}</Text>
                  <Txt muted style={{ textAlign: 'center' }}>{q ? 'Check the route number, or clear the search.' : 'Buses appear here as soon as a driver starts a trip.'}</Txt>
                  {q || filter !== 'all' ? <Button small variant="ghost" title="Clear filters" onPress={() => { setQuery(''); setFilter('all'); }} /> : null}
                </View>
              ) : shown.map((b) => (
                <Pressable key={b.busId} accessibilityRole="button" accessibilityState={{ selected: b.busId === selectedBusId }} onPress={() => selectBus(b.busId)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12, backgroundColor: b.busId === selectedBusId ? C.navy50 : 'transparent', borderBottomWidth: 1, borderBottomColor: C.line2 }, pressed && { opacity: 0.8 }]}>
                  <View style={{ minWidth: 46, height: 32, paddingHorizontal: 6, borderRadius: 10, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 13, ...F.displayBold, color: C.ink }}>{b.routeCode}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 14.5, ...F[600], color: C.ink }} numberOfLines={1}>{b.routeName ?? b.fleetCode}</Text>
                    <Txt muted small numberOfLines={1}>{[b.driverName ?? b.fleetCode, OCCUPANCY[b.occupancy]?.label, b.freshness === 'offline' ? `last seen ${ageLabel(b.recordedAt, now)}` : `${Math.round(b.speedKmh ?? 0)} km/h`].filter(Boolean).join(' · ')}</Txt>
                  </View>
                  <Badge style={{ alignSelf: 'center' }} tone={b.freshness}>{STATE_LABEL[b.freshness]}</Badge>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
