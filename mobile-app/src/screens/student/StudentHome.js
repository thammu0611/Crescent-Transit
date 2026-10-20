import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Vibration, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { MiniMap } from '../../components/maps';
import SelectRoute from '../../components/SelectRoute.js';
import {
  Avatar, Badge, Button, confirm, ErrorText, FoldCard, GradientCard, HeaderIconButton, HeroHeader, IconBubble, KV, LivePulse,
  LinkButton, Notice, Screen, SectionTitle, Select, Sheet, Skeleton, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date, dateTime, etaText, longDate, OCCUPANCY, time } from '../../lib/format.js';
import { useAsync, useLive, useRefresh } from '../../lib/hooks.js';
import { ageLabel, estimateArrival, haversineMeters, LEAVE_ALERT_M, leavePlan } from '../../lib/rules.js';
import { requestNotificationPermission, showNotification } from '../../lib/notify.js';
import { dailyRuns, formatMinutes, greeting } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F, FRESH_COLOR, G, R, shadow } from '../../theme.js';
import { call } from '../PublicHome.js';

const Pulse = ({ tone = 'live', size = 10 }) => (tone === 'live'
  ? <LivePulse size={size} />
  : <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: FRESH_COLOR[tone] ?? C.offline }} /></View>);

/** The emerald route card: which route, the two daily runs, and the live bus. */
function RouteCard({ routes, route, routeCode, setRouteCode, stopSeq, bus, eta, entitled, loading }) {
  const runs = dailyRuns(route, stopSeq);
  const etaBig = entitled && bus && bus.freshness !== 'offline' && eta && !eta.passed;
  return (
    <GradientCard colors={G.emerald} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bus" size={21} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Select compact value={routeCode} onChange={setRouteCode} label="Route" options={routes.map((r) => ({ value: r.code, label: `Route ${r.code} · ${r.name}` }))} />
        </View>
      </View>

      {etaBig ? (
        <View style={{ paddingVertical: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, ...F[800], letterSpacing: 1 }}>ARRIVES AT YOUR STOP IN</Text>
          <Text style={{ color: '#fff', fontSize: 40, ...F.display }}>{etaText(eta)}</Text>
        </View>
      ) : null}

      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, ...F[800], letterSpacing: 1 }}>NEXT BUS TIME</Text>
      {!route ? <Skeleton height={96} /> : (
        <View style={{ gap: 8 }}>
          {runs.map((r) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: R.md, backgroundColor: r.next ? '#fff' : 'rgba(255,255,255,0.12)', opacity: r.done ? 0.65 : 1 }}>
              <Icon name={r.key === 'am' ? 'arrow' : 'back'} size={15} color={r.next ? C.emerald700 : '#fff'} />
              <Text style={{ color: r.next ? C.ink : '#fff', flex: 1, fontWeight: r.next ? '700' : '500' }} numberOfLines={1}>{r.label}</Text>
              <Text style={{ color: r.next ? C.emerald700 : '#fff', ...F[800], fontVariant: ['tabular-nums'] }}>{formatMinutes(r.minutes)}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.14)', padding: 12, borderRadius: R.md }}>
        {loading ? (
          <><Pulse tone="offline" /><Text style={{ color: '#fff' }}>Checking live status…</Text></>
        ) : !entitled ? (
          <><Icon name="lock" size={16} color="#fff" /><Text style={{ color: '#fff', flex: 1 }}>Live position and arrival estimate come with the ₹60 subscription.</Text></>
        ) : bus ? (
          <><Pulse tone={bus.freshness} /><Text style={{ color: '#fff', flex: 1, ...F[600] }}>{bus.fleetCode} · {bus.freshness === 'offline' ? 'offline' : eta?.passed ? 'passed your stop' : `arrives in ${etaText(eta)}`}</Text></>
        ) : (
          <><Icon name="clock" size={16} color="#fff" /><Text style={{ color: '#fff', flex: 1 }}>No bus running on this route right now.</Text></>
        )}
      </View>
    </GradientCard>
  );
}

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
          <Txt muted small>{bus.fleetCode} · check the schedule for the next run</Txt>
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
          <Text style={{ color: '#fff', ...F[700], fontSize: 13, marginTop: 4 }}>Tap for details →</Text>
        </GradientCard>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ ...glassCard, gap: 10, opacity: pressed ? 0.9 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBubble name="clock" colors={G.navy} size={40} />
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

const glassCard = { backgroundColor: C.glass, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.glassEdge, ...shadow };

/** "Bus contact": who is driving, and a number to call (doc 4.3). */
function BusContact({ bus, route }) {
  return (
    <View style={{ backgroundColor: C.glass, borderRadius: R.lg, padding: 16, gap: 12, ...shadow }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {bus ? <Avatar name={bus.driverName ?? 'Driver'} size={46} /> : <IconBubble name="bus" accent="navy" size={46} />}
        <View style={{ flex: 1 }}>
          <Txt bold>{bus ? bus.driverName ?? 'Driver' : route ? `BSACIST-${route.code}` : 'Your bus'}</Txt>
          <Txt muted small>{bus ? `${bus.fleetCode} · Route ${bus.routeCode}` : 'Driver details appear when the trip starts'}</Txt>
        </View>
        {OCCUPANCY[bus?.occupancy] ? <Badge tone={OCCUPANCY[bus.occupancy].tone}>{OCCUPANCY[bus.occupancy].label}</Badge> : null}
      </View>
      <Pressable onPress={() => call('+914422751347')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.md, backgroundColor: pressed ? C.indigo50 : C.surface })}>
        <IconBubble name="phone" colors={G.indigo} size={38} />
        <View style={{ flex: 1 }}><Txt bold>Transport office</Txt><Txt muted small>+91 44 2275 1347</Txt></View>
        <Text style={{ color: C.indigo, ...F[800] }}>Call</Text>
      </Pressable>
    </View>
  );
}

export function FeedItem({ n, hot }) {
  const accent = hot ? 'indigo' : n.kind === 'ANNOUNCEMENT' ? 'navy' : n.kind === 'ROUTE_CHANGE' ? 'violet' : 'red';
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: R.md, backgroundColor: hot ? C.indigo50 : '#fff', borderWidth: 1, borderColor: hot ? C.navy100 : C.line2 }}>
      <IconBubble name={n.kind === 'ANNOUNCEMENT' ? 'bell' : n.kind === 'ROUTE_CHANGE' ? 'route' : 'alert'} accent={accent} size={38} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{n.title}</Txt>
        <Txt small style={{ color: C.slate }}>{n.message}</Txt>
        <Txt muted small style={{ fontSize: 12 }}>{dateTime(n.created_at)}{n.route_code ? ` · Route ${n.route_code}` : ''}</Txt>
      </View>
    </View>
  );
}

/** What the boarding question is and when it comes (server/boarding.js), folded. */
function BoardingInfo({ user, stop, onSettings }) {
  const on = user.boardingReminders;
  return (
    <FoldCard
      icon="bus"
      title="Boarding check"
      summary={on ? `Asked when your bus leaves ${stop?.name ?? 'your stop'}` : 'Switched off'}
      badge={<Badge tone={on ? 'live' : 'offline'}>{on ? 'On' : 'Off'}</Badge>}
    >
      <Txt small style={{ color: C.slate }}>
        {on
          ? 'A "Did you board?" popup comes from your bus\'s GPS and repeats every 10 minutes until you answer. "Yes" marks your attendance.'
          : 'Turn it on in Settings to be asked when your bus leaves your stop.'}
      </Txt>
      <LinkButton title="Change in Settings" icon="settings" onPress={onSettings} />
    </FoldCard>
  );
}

/** Missing or delayed bus, lost and found, SOS - free for everyone (doc 4.3, 8.4). */
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
  const routes = useAsync(() => api('/api/routes'), []);
  const [routeCode, setRouteCode] = useState(user?.homeRouteCode ?? '');
  const [reporting, setReporting] = useState(false);
  const [me, setMe] = useState(null);
  const [locError, setLocError] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const alertedTrip = useRef(null);
  useEffect(() => { if (user?.homeRouteCode) setRouteCode(user.homeRouteCode); }, [user?.homeRouteCode]);
  const route = useAsync(() => (routeCode ? api(`/api/routes/${encodeURIComponent(routeCode)}`) : Promise.resolve(null)), [routeCode]);
  const entitled = Boolean(entitlement?.active);
  const { buses } = useLive(token, routeCode, entitled && Boolean(routeCode));
  const alerts = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const { refreshing, onRefresh } = useRefresh(routes, route, alerts, refresh);

  // The 2 km alert: once per trip, when the bus first comes within range of the stop.
  const homeStop = route.data?.stops.find((st) => st.seq === user?.homeStopSeq);
  const liveBus = buses.find((b) => b.freshness !== 'offline') ?? null;
  const liveEta = liveBus && route.data && homeStop && routeCode === user?.homeRouteCode ? estimateArrival(route.data.stops, liveBus, homeStop.seq, route.data.segmentMinutes) : null;
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

  const hero = (
    <HeroHeader colors={G.navy}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => navigation.navigate('Profile')} accessibilityLabel="Profile"><Avatar name={user.name} size={48} light /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#f9d27a', fontSize: 15, ...F[500] }}>{greeting()},</Text>
          <Text style={{ color: '#fff', fontSize: 26, ...F.display }}>{first}</Text>
        </View>
        <HeaderIconButton icon="bell" label="Notifications" badge={entitled ? unread : 0} onPress={() => navigation.navigate('Alerts')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' }}>
          <Icon name="pin" size={13} color={C.gold} />
          <Text style={{ color: '#fff', ...F[700], fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
            {stop ? `${stop.name} · Route ${route.data.code}` : route.data ? 'Choose your stop in Settings' : `Route ${user.homeRouteCode}`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Icon name="clock" size={13} color={C.gold} />
          <Text style={{ color: '#fff', ...F[700], fontSize: 13 }}>{longDate().split(',')[0]}</Text>
        </View>
      </View>
    </HeroHeader>
  );

  return (
    <Screen header={hero} refreshing={refreshing} onRefresh={onRefresh}>
      <RouteCard routes={routes.data ?? []} route={route.data} routeCode={routeCode} setRouteCode={setRouteCode} stopSeq={stopSeq} bus={bus} eta={eta} entitled={entitled} loading={entitlement == null} />

      {entitlement && !entitled && (
        <Pressable onPress={() => navigation.navigate('Subscription')}>
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
        <Pressable onPress={() => navigation.navigate('Subscription')}>
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

      {entitled && isHome ? <LeaveHome plan={plan} bus={bus} stop={stop} armed={armed} onArm={arm} onOpen={() => setLeaveOpen(true)} /> : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Schedule" variant="indigo" icon="list" onPress={() => navigation.navigate('Schedule')} style={{ flex: 1 }} />
        <Button title={entitled ? 'Track live' : 'Subscribe'} variant="red" icon={entitled ? 'map' : 'card'} onPress={() => navigation.navigate(entitled ? 'Track' : 'Subscription')} style={{ flex: 1 }} />
      </View>

      <View style={{ borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.glass, ...shadow }}>
        <View>
          {route.data ? <MiniMap stops={route.data.stops} buses={entitled ? buses : []} highlightSeq={stopSeq} /> : <Skeleton height={190} />}
          <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: C.glass, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, ...shadow }}>
            <Text style={{ ...F[800], color: C.navy, fontSize: 12 }}>Route {route.data?.code ?? ''} map</Text>
          </View>
        </View>
        <Pressable onPress={() => navigation.navigate(entitled ? 'Track' : 'Subscription')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
          <IconBubble name="bus" accent={entitled ? 'emerald' : 'navy'} size={36} />
          <View style={{ flex: 1 }}>
            <Txt bold>{entitlement == null ? 'Checking buses…' : entitled ? `${buses.length} bus${buses.length === 1 ? '' : 'es'} available` : 'Live tracking locked'}</Txt>
            <Txt muted small>{entitled ? 'Tap to open the live map' : 'Subscribe to see your bus move'}</Txt>
          </View>
          <Icon name="arrow" size={16} color={C.faint} />
        </Pressable>
      </View>

      <SectionTitle title="Quick actions" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[
          ['check', 'Attendance', 'My trips', G.emerald, () => navigation.navigate('Attendance')],
          entitlement?.required
            ? ['card', 'Subscription', entitled ? 'Active' : '₹60 / month', G.indigo, () => navigation.navigate('Subscription')]
            : ['bell', 'Alerts', 'Delays & notices', G.indigo, () => navigation.navigate('Alerts')],
          ['alert', 'Report', 'Delay or SOS', G.danger, () => setReporting(true)],
          ['settings', 'Settings', 'Route & privacy', G.dark, () => navigation.navigate('Profile')],
        ].map(([icon, label, hint, colors, onPress]) => (
          <Pressable key={label} onPress={onPress} style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, padding: 14, gap: 10, borderRadius: R.lg, backgroundColor: C.glass, transform: [{ scale: pressed ? 0.97 : 1 }], ...shadow })}>
            <IconBubble name={icon} colors={colors} size={42} />
            <View>
              <Txt bold>{label}</Txt>
              <Txt muted small>{hint}</Txt>
            </View>
          </Pressable>
        ))}
      </View>

      <SectionTitle title="Bus contact" />
      <BusContact bus={entitled ? bus : null} route={route.data} />

      <SectionTitle title="Updates" />
      <BoardingInfo user={user} stop={isHome ? stop : null} onSettings={() => navigation.navigate('Profile')} />
      <FoldCard
        icon="bell"
        title="Notifications"
        summary={alerts.data == null ? 'Loading…' : alerts.data.length ? alerts.data[0].title : "You're all caught up"}
        badge={alerts.data?.length ? <Badge tone="info">{alerts.data.length > 9 ? '9+' : alerts.data.length}</Badge> : null}
      >
        {alerts.data == null ? <Skeleton /> : alerts.data.length === 0 ? <Txt muted>You're all caught up.</Txt> : (
          <View style={{ gap: 8 }}>{alerts.data.slice(0, 3).map((n, i) => <FeedItem key={n.id} n={n} hot={i === 0} />)}</View>
        )}
        <LinkButton title="See all notifications" icon="arrow" onPress={() => navigation.navigate('Alerts')} />
      </FoldCard>
      {reporting && <ReportProblem token={token} user={user} onClose={() => setReporting(false)} />}
      {leaveOpen && <LeaveDetails plan={plan} bus={bus} stop={stop} me={me} onLocate={locate} armed={armed} onArm={arm} onClose={() => setLeaveOpen(false)} locError={locError} />}
    </Screen>
  );
}

