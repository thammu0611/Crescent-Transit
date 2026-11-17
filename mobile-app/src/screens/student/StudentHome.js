import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Vibration, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { MiniMap } from '../../components/maps';
import SelectRoute from '../../components/SelectRoute.js';
import {
  accentColour, alpha, Avatar, Badge, Button, CardTint, confirm, ErrorText, FadeIn, GradientCard, HeaderIconButton, IconBubble, KV, LivePulse,
  Notice, Screen, SectionTitle, Select, Sheet, Skeleton, Text, TextField, Txt, DirectionBadge,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date, dateTime, etaText, OCCUPANCY, time } from '../../lib/format.js';
import { useAsync, useLive, useRefresh } from '../../lib/hooks.js';
import { ageLabel, estimateArrival, haversineMeters, LEAVE_ALERT_M, leavePlan } from '../../lib/rules.js';
import { requestNotificationPermission, showNotification } from '../../lib/notify.js';
import { dailyRuns, formatMinutes, greeting } from '../../lib/schedule.js';
import DayBanner from '../../components/DayBanner.js';
import { routeData, useT } from '../../lib/offline.js';
import { useSession } from '../../lib/session.js';
import { C, F, G, R, shadow } from '../../theme.js';
import { call } from '../PublicHome.js';
import MyAvatar from '../../components/MyAvatar.js';

/** The status of the next bus, as a chip: a shape and a word, not colour alone. */
function busChip({ loading, entitled, bus, eta }) {
  if (loading) return <Badge tone="offline">Checking…</Badge>;
  if (!entitled) return <Badge tone="offline" dot={false}>Locked</Badge>;
  if (!bus) return <Badge tone="offline">Not started</Badge>;
  if (bus.freshness === 'offline') return <Badge tone="offline">Offline</Badge>;
  if (bus.freshness === 'delayed') return <Badge tone="delayed">Signal late</Badge>;
  if (eta?.passed) return <Badge tone="info">Passed your stop</Badge>;
  return <Badge tone="live">Live</Badge>;
}

/**
 * The next bus: route, departure time, live arrival estimate and the two
 * actions that matter (track it, get told when it is near). With no bus left
 * today it becomes a helpful empty state instead of "No bus running".
 */
function NextBusCard({ route, stop, stopSeq, bus, eta, entitled, loading, day, armed, onNotify, onTrack, onSchedule }) {
  const runs = dailyRuns(route, stopSeq, day);
  const next = runs.find((r) => r.next) ?? null;
  const etaLive = entitled && bus && bus.freshness !== 'offline' && eta && !eta.passed;
  if (!route) return <Skeleton height={250} />;
  if (!next) {
    return (
      <FadeIn style={[card, tinted(accentColour('gold')), { gap: 12 }]}>
        <CardTint color={accentColour('gold')} radius={R.lg} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconBubble name="clock" accent="gold" size={48} iconSize={24} />
          <Badge tone="offline">Not started</Badge>
        </View>
        <Text style={{ fontSize: 20, lineHeight: 26, ...F.display, color: C.ink }}>No more buses today</Text>
        <Txt muted>Route {route.code} leaves {stop?.name ?? route.start_point} at {formatMinutes(runs[0]?.minutes)} on the next school day.</Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={armed ? 'Reminder on' : 'Remind me'} icon="bell" onPress={onNotify} style={{ flex: 1 }} />
          <Button title="Schedule" variant="ghost" onPress={onSchedule} />
        </View>
      </FadeIn>
    );
  }
  const colour = etaLive ? (bus.freshness === 'delayed' ? C.delayed : C.live) : accentColour('gold');
  return (
    <FadeIn style={[card, tinted(colour), { gap: 14 }]}>
      <CardTint color={colour} radius={R.lg} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ minWidth: 48, height: 32, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.navyFill, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 15, ...F.displayBold }}>{route.code}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, ...F[600], color: C.ink }} numberOfLines={1}>{next.key === 'am' ? 'Next bus to campus' : 'Next bus home'}</Text>
          <Txt muted small numberOfLines={1}>{next.key === 'am' ? 'Morning trip' : 'Evening trip'} · {route.name}</Txt>
        </View>
        {busChip({ loading, entitled, bus, eta })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Txt muted small>{next.key === 'am' ? 'Leaves your stop' : 'Leaves campus'}</Txt>
          <Text style={{ fontSize: 34, lineHeight: 40, ...F.displayBold, color: C.ink, fontVariant: ['tabular-nums'] }}>{formatMinutes(next.minutes)}</Text>
        </View>
        {etaLive ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Txt muted small>Arrives in</Txt>
            <Text style={{ fontSize: 26, lineHeight: 32, ...F.displayBold, color: C.navy }}>{etaText(eta)}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="pin" size={16} color={C.muted} />
        <Txt small muted style={{ flex: 1 }} numberOfLines={1}>{next.key === 'am' ? `Boarding at ${stop?.name ?? route.start_point}` : `Drop-off at ${stop?.name ?? route.start_point}`}</Txt>
      </View>
      {etaLive && stopSeq ? (() => {
        // How far along its way to your stop the bus is.
        const at = bus.nearestStop?.seq ?? 0;
        const first = route.stops[0]?.seq ?? 1;
        const done = Math.max(0.04, Math.min(1, (at - first) / Math.max(1, stopSeq - first)));
        const away = Math.max(0, stopSeq - at);
        return (
          <View style={{ gap: 8 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.raised, overflow: 'hidden' }}>
              <View style={{ width: `${done * 100}%`, height: 6, borderRadius: 3, backgroundColor: colour }} />
            </View>
            <Txt small style={{ color: C.faint }} numberOfLines={1}>
              {[bus.nearestStop?.name ? `Near ${bus.nearestStop.name}` : null, away ? `${away} stop${away === 1 ? '' : 's'} away` : 'At your stop', `updated ${ageLabel(bus.recordedAt)}`].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        );
      })() : (
      <Txt small style={{ color: C.faint }}>
        {loading ? 'Checking live status…'
          : !entitled ? 'Live position and arrival estimate come with the ₹60 subscription.'
            : bus ? `${bus.fleetCode} · ${bus.freshness === 'offline' ? 'offline' : eta?.passed ? 'passed your stop' : `about ${etaText(eta)} away`} · updated ${ageLabel(bus.recordedAt)}`
              : 'No bus on the road yet. It shows here as soon as the driver starts.'}
      </Txt>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={entitled ? 'Track live' : 'Subscribe'} icon={entitled ? 'map' : 'card'} onPress={onTrack} style={{ flex: 1 }} />
        {entitled ? <Button title={armed ? 'Alert on' : 'Notify me'} variant="ghost" icon="bell" onPress={onNotify} /> : null}
      </View>
    </FadeIn>
  );
}

/** Today's two trips as a short timeline, each with its status. */
function TodayCard({ route, stopSeq, day, bus, entitled }) {
  const runs = dailyRuns(route, stopSeq, day);
  if (!route) return null;
  return (
    <View style={[card, tinted(accentColour('teal')), { paddingVertical: 14, gap: 0 }]}>
      <CardTint color={accentColour('teal')} radius={R.lg} />
      {runs.map((r, i) => {
        const live = r.next && entitled && bus && bus.freshness !== 'offline';
        return (
          <View key={r.key} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 14, alignItems: 'center', paddingTop: 5 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: r.next ? accentColour('teal') : r.done ? C.faint : 'transparent', borderWidth: r.next || r.done ? 0 : 2, borderColor: C.faint }} />
              {i < runs.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 30, backgroundColor: C.line, marginTop: 6 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < runs.length - 1 ? 14 : 0, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 16, ...F[600], color: r.done ? C.muted : C.ink, fontVariant: ['tabular-nums'] }}>{formatMinutes(r.minutes)}</Text>
                {r.done ? <Badge tone="live" dot={false}>Done</Badge> : live ? <Badge tone="live">Live</Badge> : r.next ? <Badge tone="info">Next</Badge> : <Badge tone="offline">Later today</Badge>}
              </View>
              <Txt small muted numberOfLines={1}>{r.label}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Four big shortcuts. */
function QuickActions({ items }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map((q) => (
        <Pressable
          key={q.label}
          accessibilityRole="button"
          accessibilityLabel={q.label}
          onPress={q.onPress}
          style={({ pressed }) => [{ flex: 1, minHeight: 86, borderRadius: 18, borderWidth: 1, borderColor: alpha(accentColour(q.accent), 0.25), backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 4, overflow: 'hidden' }, pressed && { opacity: 0.8 }]}
        >
          <CardTint color={accentColour(q.accent)} />
          <IconBubble name={q.icon} accent={q.accent} size={38} iconSize={20} />
          <Text style={{ fontSize: 12, lineHeight: 15, minHeight: 30, ...F[600], color: C.ink, textAlign: 'center' }} numberOfLines={2}>{q.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const card = { backgroundColor: C.card, borderRadius: R.lg, padding: 18, borderWidth: 1, borderColor: C.line2, ...shadow };
// A coloured card's border and clipping (the wash and top edge come from CardTint).
const tinted = (colour) => ({ borderColor: alpha(colour, 0.25), overflow: 'hidden' });

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const leaveHeadline = (plan) => (plan.leaveInMin <= 0 ? 'Leave now' : `Leave by ${time(plan.leaveAt)}`);
const arrivalRange = (plan) => (time(plan.arriveFrom) === time(plan.arriveTo) ? time(plan.arriveFrom) : `${time(plan.arriveFrom)} – ${time(plan.arriveTo)}`);

/**
 * "When to leave home", from the bus's live GPS. Within 2 km of the stop it is
 * a prominent card; further away a compact one with a switch that alerts the
 * student when the bus reaches 2 km. Tapping either opens the details.
 */
function LeaveHome({ plan, bus, stop, armed, onArm, onOpen }) {
  if (!bus) {
    return (
      <View style={{ ...glassCard, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBubble name="clock" accent="navy" size={40} />
        <View style={{ flex: 1 }}>
          <Txt bold>When to leave home</Txt>
          <Txt muted small>Appears once your bus starts its trip and its GPS is live.</Txt>
        </View>
      </View>
    );
  }
  if (!plan) return null;
  if (plan.state === 'passed') {
    return (
      <View style={{ ...glassCard, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBubble name="check" accent="navy" size={40} />
        <View style={{ flex: 1 }}>
          <Txt bold>Your bus has passed {stop?.name ?? 'your stop'}</Txt>
          <Txt muted small>{bus.fleetCode} · check the schedule for the next trip</Txt>
        </View>
      </View>
    );
  }
  if (plan.state === 'near') {
    return (
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="When to leave home, details">
        <GradientCard colors={G.red} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LivePulse color="#ffd56b" size={8} />
            <Text style={{ color: '#ffe3a3', fontSize: 11.5, ...F[700], letterSpacing: 1.4 }}>BUS IS {km(plan.distanceM).toUpperCase()} FROM {(stop?.name ?? 'YOUR STOP').toUpperCase()}</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 28, ...F.display }}>{leaveHeadline(plan)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13.5 }}>
            {plan.leaveInMin > 0 ? `In ${plan.leaveInMin} min · ` : ''}bus arrives {arrivalRange(plan)} · {plan.walkMin} min walk{plan.walkAssumed ? ' (assumed)' : ''}
          </Text>
          <Text style={{ color: '#fff', ...F[700], fontSize: 13, marginTop: 4 }}>Tap for details ›</Text>
        </GradientCard>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ ...glassCard, gap: 10, opacity: pressed ? 0.9 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBubble name="clock" accent="navy" size={40} />
        <View style={{ flex: 1 }}>
          <Txt bold>When to leave home</Txt>
          <Txt muted small numberOfLines={2}>Bus is {km(plan.distanceM)} away · arrives about {time(plan.arriveTo)}</Txt>
        </View>
        <Icon name="arrow" size={16} color={C.faint} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line2 }}>
        <Txt small style={{ flex: 1, color: C.slate }}>{armed ? `On: you'll be alerted when the bus is ${km(LEAVE_ALERT_M)} away` : `Alert me when the bus is ${km(LEAVE_ALERT_M)} away`}</Txt>
        <Switch value={armed} onValueChange={onArm} trackColor={{ true: C.live, false: C.line }} thumbColor="#fff" accessibilityLabel="Alert me when the bus is 2 km away" />
      </View>
    </Pressable>
  );
}

/** Everything behind the leave-home estimate, live from the bus GPS. */
function LeaveDetails({ plan, bus, stop, me, onLocate, armed, onArm, onClose, locError }) {
  return (
    <Sheet title="When to leave home" onClose={onClose}>
      <View style={{ gap: 14 }}>
        {plan && plan.state !== 'passed' ? (
          <>
            <View style={{ padding: 16, borderRadius: R.lg, backgroundColor: plan.state === 'near' ? C.red50 : C.navy50, gap: 4 }}>
              <Text style={{ fontSize: 26, ...F.display, color: plan.state === 'near' ? C.red : C.navy }}>{leaveHeadline(plan)}</Text>
              <Txt small style={{ color: C.slate }}>
                {plan.leaveInMin > 0 ? `In ${plan.leaveInMin} min. ` : ''}Leave {plan.walkMin} min before the bus's earliest arrival so you are at the stop first.
              </Txt>
            </View>
            <KV k="Your stop" v={stop?.name ?? '—'} />
            <KV k="Bus" v={`${bus.fleetCode} · GPS ${ageLabel(bus.recordedAt)}`} />
            <KV k="Distance" v={`${km(plan.distanceM)} along the route · ${plan.stopsRemaining} stop${plan.stopsRemaining === 1 ? '' : 's'} away`} />
            <KV k="Arrives" v={`${arrivalRange(plan)}${plan.confidence === 'low' ? ' (weak signal)' : ''}`} />
            <KV k="Walk" v={plan.walkAssumed ? `${plan.walkMin} min (assumed)` : `${plan.walkMin} min from your location`} />
            {!me ? <Button small variant="ghost" icon="pin" title="Use my location for the walk" onPress={onLocate} /> : null}
            <ErrorText>{locError}</ErrorText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: R.md, backgroundColor: C.surface }}>
              <Txt small style={{ flex: 1 }}>Alert me when the bus is {km(LEAVE_ALERT_M)} from my stop</Txt>
              <Switch value={armed} onValueChange={onArm} trackColor={{ true: C.live, false: C.line }} thumbColor="#fff" />
            </View>
          </>
        ) : (
          <Txt muted>{plan?.state === 'passed' ? 'Your bus has already passed your stop.' : 'No live bus on your route yet. This fills in once the trip starts.'}</Txt>
        )}
      </View>
    </Sheet>
  );
}

const glassCard = { backgroundColor: C.card, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.line2, ...shadow };

/** "Bus contact": who is driving, and a number to call (doc 4.3). */
function BusContact({ bus, route }) {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: R.lg, padding: 16, gap: 12, borderWidth: 1, borderColor: C.line2, ...shadow }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {bus ? <Avatar name={bus.driverName ?? 'Driver'} size={46} /> : <IconBubble name="bus" accent="navy" size={46} />}
        <View style={{ flex: 1 }}>
          <Txt bold>{bus ? bus.driverName ?? 'Driver' : route ? `BSACIST-${route.code}` : 'Your bus'}</Txt>
          <Txt muted small>{bus ? `${bus.fleetCode} · Route ${bus.routeCode}` : 'Driver details appear when the trip starts'}</Txt>
        </View>
        {OCCUPANCY[bus?.occupancy] ? <Badge tone={OCCUPANCY[bus.occupancy].tone}>{OCCUPANCY[bus.occupancy].label}</Badge> : null}
      </View>
      <Pressable accessibilityRole="button" onPress={() => call('+914422751347')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.md, backgroundColor: pressed ? C.indigo50 : C.surface })}>
        <IconBubble name="phone" accent="navy" size={38} />
        <View style={{ flex: 1 }}><Txt bold>Transport office</Txt><Txt muted small>+91 44 2275 1347</Txt></View>
        <Text style={{ color: C.indigo, ...F[800] }}>Call</Text>
      </Pressable>
    </View>
  );
}

export function FeedItem({ n, hot }) {
  const accent = hot ? 'indigo' : n.kind === 'ANNOUNCEMENT' ? 'navy' : n.kind === 'ROUTE_CHANGE' ? 'violet' : 'red';
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: R.md, backgroundColor: hot ? C.indigo50 : C.paper, borderWidth: 1, borderColor: hot ? C.navy100 : C.line2 }}>
      <IconBubble name={n.kind === 'ANNOUNCEMENT' ? 'bell' : n.kind === 'ROUTE_CHANGE' ? 'route' : 'alert'} accent={accent} size={38} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{n.title}</Txt>
        <Txt small style={{ color: C.slate }}>{n.message}</Txt>
        <Txt muted small style={{ fontSize: 12 }}>{dateTime(n.created_at)}{n.route_code ? ` · Route ${n.route_code}` : ''}</Txt>
      </View>
    </View>
  );
}

/** Missing or delayed bus, lost and found, SOS - open to every student (doc 4.3, 8.4). */
function ReportProblem({ token, user, onClose }) {
  const [kind, setKind] = useState('DELAY');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async (k = kind) => {
    setError(null);
    setBusy(true);
    try {
      await api('/api/problems', { token, body: { kind: k, message: message || undefined, routeCode: user.homeRouteCode ?? undefined } });
      setDone(k === 'SOS' ? 'SOS sent to the transport office and campus security.' : 'Reported to the transport office. Thank you.');
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Report a problem" onClose={onClose}>
      <View style={{ gap: 14 }}>
        <Select
          label="What happened"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'DELAY', label: 'Bus delayed' },
            { value: 'MISSING_BUS', label: 'Bus did not come' },
            { value: 'LOST_AND_FOUND', label: 'Lost and found' },
            { value: 'OTHER', label: 'Something else' },
          ]}
        />
        <TextField label="Details" value={message} onChangeText={setMessage} placeholder="Optional" />
        <Notice>{done}</Notice>
        <ErrorText>{error}</ErrorText>
        <Button title="Send report" variant="dark" icon="arrow" busy={busy} onPress={() => send()} />
        <Button title="Send SOS" variant="danger" icon="alert" disabled={busy} onPress={async () => (await confirm('Send SOS', 'Send an SOS to the transport office and campus security?', 'Send SOS', true)) && send('SOS')} />
      </View>
    </Sheet>
  );
}

export default function StudentHome({ navigation }) {
  const { token, user, entitlement, refresh } = useSession();
  const calendar = useAsync(() => api('/api/calendar'), []);
  const routes = useAsync(() => routeData('/api/routes'), []);
  const [routeCode, setRouteCode] = useState(user?.homeRouteCode ?? '');
  const [reporting, setReporting] = useState(false);
  const [me, setMe] = useState(null);
  const [locError, setLocError] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const alertedTrip = useRef(null);
  useEffect(() => { if (user?.homeRouteCode) setRouteCode(user.homeRouteCode); }, [user?.homeRouteCode]);
  const route = useAsync(() => (routeCode ? routeData(`/api/routes/${encodeURIComponent(routeCode)}`) : Promise.resolve(null)), [routeCode]);
  const entitled = Boolean(entitlement?.active);
  const { buses } = useLive(token, routeCode, entitled && Boolean(routeCode));
  const alerts = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const { refreshing, onRefresh } = useRefresh(routes, route, alerts, refresh);

  // The 2 km alert: once per trip, when the bus first comes within range of the stop.
  const homeStop = route.data?.stops.find((st) => st.seq === user?.homeStopSeq);
  const liveBus = buses.find((b) => b.freshness !== 'offline') ?? null;
  const liveEta = liveBus && liveBus.direction !== 'DOWN' && route.data && homeStop && routeCode === user?.homeRouteCode ? estimateArrival(route.data.stops, liveBus, homeStop.seq, route.data.segmentMinutes) : null;
  const nearNow = liveEta && !liveEta.passed && liveEta.remainingM <= LEAVE_ALERT_M;
  useEffect(() => {
    if (!armed || !nearNow || !liveBus || alertedTrip.current === liveBus.tripId) return;
    alertedTrip.current = liveBus.tripId;
    Vibration.vibrate([0, 250, 120, 250]);
    showNotification('Time to leave for your bus', `${liveBus.fleetCode} is ${km(liveEta.remainingM)} from ${homeStop.name}.`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, nearNow, liveBus?.tripId]);

  if (!user) return null;
  if (!user.homeRouteCode) {
    return <Screen safeTop><SelectRoute /></Screen>;
  }

  const isHome = routeCode === user.homeRouteCode;
  const stopSeq = isHome ? user.homeStopSeq : route.data?.stops[0]?.seq;
  const stop = route.data?.stops.find((s) => s.seq === stopSeq);
  const bus = buses.find((b) => b.freshness !== 'offline') ?? buses[0] ?? null;
  const eta = bus && route.data && stopSeq ? estimateArrival(route.data.stops, bus, stopSeq, route.data.segmentMinutes, { segmentSource: route.data.segmentsLearned ? 'segment-history' : 'timetable' }) : null;
  const walk = me && stop ? haversineMeters(me, stop) : null;
  const plan = leavePlan(eta, { walkMeters: walk });
  const first = user.name.replace(/^(Mr|Mrs|Ms)\.?\s*/i, '').split(' ')[0];
  const t = useT();
  const unread = (alerts.data ?? []).length;

  const arm = async (on) => {
    setArmed(on);
    if (on) await requestNotificationPermission().catch(() => {});
  };

  const locate = async () => {
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setLocError('Location permission is needed to work out your walk to the stop.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
    } catch (err) {
      setLocError(err.message);
    }
  };

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 }}>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Profile')} accessibilityLabel="Profile"><MyAvatar size={46} /></Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt muted small>{greeting()}</Txt>
          <Text style={{ color: C.ink, fontSize: 22, lineHeight: 28, ...F.displayBold }} numberOfLines={1}>{first}</Text>
        </View>
        <HeaderIconButton dark icon="bell" label="Notifications" badge={entitled ? unread : 0} onPress={() => navigation.navigate('Alerts')} />
      </View>
      <View style={{ alignSelf: 'flex-start', maxWidth: '100%', marginTop: -2 }}>
        <Select
          value={routeCode}
          onChange={setRouteCode}
          label="Route"
          searchable
          options={(routes.data ?? []).map((r) => ({ value: r.code, label: `Route ${r.code} · ${r.name}` }))}
          trigger={(open) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Route ${routeCode}${stop ? `, ${stop.name}` : ''}. Change route`} onPress={open}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingLeft: 14, paddingRight: 14, borderRadius: 23, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, maxWidth: '100%' }, pressed && { opacity: 0.85 }]}>
              <Icon name="pin" size={18} color={C.navy} />
              <Text style={{ fontSize: 15, ...F[600], color: C.ink, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Route {routeCode}{stop ? ` · ${stop.name}` : route.data ? ` · ${route.data.name}` : ''}</Text>
              <Icon name="down" size={16} color={C.faint} />
            </Pressable>
          )}
        />
      </View>
      <NextBusCard
        route={route.data} stop={stop} stopSeq={stopSeq} bus={bus} eta={eta} entitled={entitled} loading={entitlement == null} day={calendar.data?.today}
        armed={armed} onNotify={() => arm(!armed)} onTrack={() => navigation.navigate(entitled ? 'Track' : 'Subscription')} onSchedule={() => navigation.navigate('Schedule')}
      />

      {entitlement && !entitled && (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Subscription')}>
          <GradientCard colors={G.violet} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
            <IconBubble name="sparkle" size={42} colors={G.red} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', ...F[800], fontSize: 15 }}>Unlock live tracking for ₹60 a month</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>Live bus, arrival estimates, alerts and automatic attendance</Text>
            </View>
            <Icon name="arrow" size={18} color="#fff" />
          </GradientCard>
        </Pressable>
      )}
      {entitled && entitlement.inGrace && (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Subscription')}>
          <GradientCard colors={G.sunrise} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
            <Icon name="alert" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', ...F[800] }}>Your subscription has expired</Text>
              <Text style={{ color: '#fff', fontSize: 13 }}>Access continues until {date(entitlement.graceEndsOn)}. Renew now.</Text>
            </View>
            <Icon name="arrow" size={18} color="#fff" />
          </GradientCard>
        </Pressable>
      )}


      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 16, ...F[600], color: C.ink }}>{t('Today')}</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Schedule')} hitSlop={10}><Text style={{ color: C.link, ...F[600], fontSize: 14 }}>{t('Full schedule')}</Text></Pressable>
      </View>
      <TodayCard route={route.data} stopSeq={stopSeq} day={calendar.data?.today} bus={bus} entitled={entitled} />
      <QuickActions items={[
        { label: t('Schedule'), icon: 'clock', accent: 'gold', onPress: () => navigation.navigate('Schedule') },
        { label: t('Bus pass'), icon: 'qr', accent: 'navy', onPress: () => navigation.navigate('BusPass') },
        { label: t('Attendance'), icon: 'check', accent: 'teal', onPress: () => navigation.navigate('Attendance') },
        { label: t('Report issue'), icon: 'alert', accent: 'danger', onPress: () => setReporting(true) },
      ]} />

      <DayBanner />

      {reporting && <ReportProblem token={token} user={user} onClose={() => setReporting(false)} />}
      {leaveOpen && <LeaveDetails plan={plan} bus={bus} stop={stop} me={me} onLocate={locate} armed={armed} onArm={arm} onClose={() => setLeaveOpen(false)} locError={locError} />}
    </Screen>
  );
}

