import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { BusPin, CampusPin, MapBox, RouteLayer } from '../components/maps';
import {
  Badge, Button, ErrorText, FadeIn, LivePulse, Panel, Row, Select, Stat, StatGrid, Text, Txt, useTabBarSpace,
} from '../components/ui.js';
import { api, getSocket } from '../lib/api.js';
import { etaText, OCCUPANCY } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';
import { ageLabel, estimateArrival, freshnessOf } from '../lib/rules.js';
import { useSession } from '../lib/session.js';
import { C, FRESH_COLOR } from '../theme.js';

const STATE_LABEL = { live: 'Live', delayed: 'Delayed', offline: 'Offline' };

/** What a student without a subscription sees instead of live positions (doc 8.4). */
function Paywall({ reason, navigation }) {
  return (
    <Panel title="Live tracking is for subscribers" icon="lock">
      <Txt muted>
        {reason === 'LOGIN_REQUIRED' ? 'Sign in to see live buses.' : 'Live bus positions, arrival estimates and alerts come with the ₹60 monthly subscription.'}
        {' '}The route list, stops and timetable stay free.
      </Txt>
      {reason === 'SUBSCRIPTION_REQUIRED' && <Button title="Subscribe for ₹60" onPress={() => navigation.navigate('Subscription')} />}
    </Panel>
  );
}

/** Student "Track" tab and the admin's fleet map: live buses over the socket. */
export default function LiveMap({ navigation }) {
  const { token, user } = useSession();
  const { height } = useWindowDimensions();
  const tabSpace = useTabBarSpace();
  const [routes, setRoutes] = useState([]);
  const [routeCode, setRouteCode] = useState(user?.role === 'student' ? user.homeRouteCode ?? '' : '');
  const [stopSeq, setStopSeq] = useState(user?.role === 'student' ? user.homeStopSeq ?? null : null);
  const [route, setRoute] = useState(null);
  const [buses, setBuses] = useState({}); // busId -> snapshot
  const [selectedBusId, setSelectedBusId] = useState(null);
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

  const selectBus = (busId) => {
    const bus = list.find((b) => b.busId === busId);
    setSelectedBusId(busId);
    if (bus && bus.routeCode !== routeCode) setRouteCode(bus.routeCode);
    if (bus) map.current?.focus(bus);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* The map as a rounded card with the same side margins as the panels below. */}
      <View style={{ height: Math.round(Math.min(Math.max(height * 0.4, 260), 520)), marginHorizontal: 14, marginTop: 6, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.glassEdge, backgroundColor: C.surface }}>
        <MapBox ref={map} fitPoints={route?.stops ?? []} fitKey={route?.code}>
          <CampusPin />
          <RouteLayer stops={route?.stops} highlightSeq={stopSeq ?? selected?.nearestStop?.seq} />
          {list.map((b) => <BusPin key={b.busId} bus={b} selected={b.busId === selectedBusId} onPress={selectBus} />)}
        </MapBox>
        <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(STATE_LABEL).map(([k, label]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: FRESH_COLOR[k] }} />
              <Text style={{ fontSize: 11, color: C.ink }}>{label} {k === 'live' ? '≤ 30 s' : k === 'delayed' ? '≤ 2 min' : '> 2 min'}</Text>
            </View>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 + tabSpace }} keyboardShouldPersistTaps="handled">
        {denied ? <Paywall reason={denied} navigation={navigation} /> : null}
        <Panel title={user?.role === 'admin' ? 'Fleet' : 'Live buses'} actions={<Row gap={2}>{connected ? <LivePulse size={7} /> : null}<Badge tone={connected ? 'live' : 'delayed'}>{connected ? 'Connected' : 'Reconnecting…'}</Badge></Row>}>
          <StatGrid>
            <Stat label="on trip" value={list.length} />
            <Stat label="live" value={counts.live ?? 0} tone="live" />
            <Stat label="delayed" value={counts.delayed ?? 0} tone="delayed" />
            <Stat label="offline" value={counts.offline ?? 0} tone="offline" />
          </StatGrid>
          <Select
            label="Route"
            value={routeCode}
            onChange={(v) => { setRouteCode(v); setSelectedBusId(null); setStopSeq(null); }}
            options={[{ value: '', label: `All ${routes.length} routes` }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))]}
          />
          {route && (
            <Select
              label="Estimate arrival at"
              value={stopSeq ?? ''}
              onChange={(v) => setStopSeq(v === '' ? null : Number(v))}
              placeholder="Choose a stop"
              options={[{ value: '', label: 'Choose a stop' }, ...route.stops.map((s) => ({ value: s.seq, label: `${s.seq}. ${s.name}` }))]}
            />
          )}
          <ErrorText>{error}</ErrorText>
        </Panel>

        {list.length === 0 && !denied && (
          <Panel>
            <Txt muted style={{ textAlign: 'center' }}>No bus on this {routeCode ? 'route' : 'network'} is on a trip right now.</Txt>
            <Txt muted small style={{ textAlign: 'center' }}>A driver starts a trip from the driver app, or run npm run simulate on the server.</Txt>
          </Panel>
        )}
        {list.map((b) => (
          <FadeIn key={b.busId}>
            <Pressable accessibilityRole="button"
              onPress={() => selectBus(b.busId)}
              accessibilityState={{ selected: b.busId === selectedBusId }}
              style={{ backgroundColor: b.busId === selectedBusId ? C.glassStrong : C.glass, borderRadius: 16, padding: 14, paddingLeft: 18, gap: 6, borderWidth: b.busId === selectedBusId ? 2 : 1, borderColor: b.busId === selectedBusId ? C.navy : C.glassEdge, overflow: 'hidden' }}
            >
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: FRESH_COLOR[b.freshness] ?? C.offline }} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt bold>{b.fleetCode}</Txt>
                <Row gap={6}>
                  {OCCUPANCY[b.occupancy] ? <Badge tone={OCCUPANCY[b.occupancy].tone}>{OCCUPANCY[b.occupancy].label}</Badge> : null}
                  <Badge tone={b.freshness}>{STATE_LABEL[b.freshness]}</Badge>
                </Row>
              </Row>
              <Txt muted small>{b.routeName}</Txt>
              {stop && b.routeCode === route?.code && (
                <Row style={{ justifyContent: 'space-between', backgroundColor: b.eta?.confidence === 'low' ? C.delayed50 : C.indigo50, padding: 8, borderRadius: 10 }}>
                  <Txt small style={{ flex: 1 }}>Estimated arrival at {stop.name}</Txt>
                  <Txt bold>{b.freshness === 'offline' ? 'Bus offline' : etaText(b.eta)}</Txt>
                </Row>
              )}
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt muted small>Updated {ageLabel(b.recordedAt, now)}</Txt>
                <Txt muted small>{b.freshness === 'offline' ? 'last seen' : `${Math.round(b.speedKmh ?? 0)} km/h`}</Txt>
              </Row>
              {b.nearestStop && (
                <Txt small>{b.freshness === 'offline' ? 'Last seen near' : 'Near'} <Txt small bold>{b.nearestStop.name}</Txt> ({b.nearestStop.distanceM} m)</Txt>
              )}
            </Pressable>
          </FadeIn>
        ))}

        {route && (
          <Panel title={`Route ${route.code} · ${route.stops.length} boarding points`} icon="route">
            <Txt muted small>
              {route.bus_type} · {route.capacity} seats · departs {route.departure_time} · ETA from {route.segmentsLearned ? `${route.segmentsLearned} learned segments + timetable` : 'the timetable'}
            </Txt>
            {route.stops.map((s) => {
              const here = selected?.nearestStop?.seq === s.seq;
              const mine = s.seq === stopSeq;
              return (
                <Pressable accessibilityRole="button" key={s.seq} onPress={() => map.current?.focus(s)} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8, backgroundColor: here ? C.indigo50 : mine ? C.red50 : 'transparent' }}>
                  <Txt small style={{ flex: 1 }}>{s.seq}. {s.name}{s.geo_source === 'interpolated' ? <Txt small muted> approx.</Txt> : null}</Txt>
                  <Txt small muted>{s.scheduled_time}</Txt>
                </Pressable>
              );
            })}
          </Panel>
        )}
      </ScrollView>
    </View>
  );
}
