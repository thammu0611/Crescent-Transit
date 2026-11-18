import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { CHILD_STATUS_TEXT } from '../../../../shared/service.js';
import { DetailModal } from '../../components/adminkit.js';
import Appearance from '../../components/Appearance.js';
import { ChangePasswordSheet } from '../../components/ChangePassword.js';
import DayBanner from '../../components/DayBanner.js';
import Icon from '../../components/Icon.js';
import { MiniMap } from '../../components/maps';
import YourData from '../../components/YourData.js';
import {
  accentColour, alpha, Avatar, Badge, Button, CardTint, confirm, RowTint, ErrorText, HeaderIconButton, IconBubble, Screen, Sheet, Skeleton, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { dateTime, time } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { routeData, useT } from '../../lib/offline.js';
import { formatMinutes } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F, R, shadow } from '../../theme.js';

const OFFICE_PHONE = '+91 44 2275 1347';
const card = { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, ...shadow };
// A coloured card's border and clipping (the wash and edge come from CardTint / RowTint).
const tinted = (colour) => ({ borderColor: alpha(colour, 0.25), overflow: 'hidden' });
const busName = (fleet) => String(fleet ?? '').replace('BSACIST-', 'Bus ');
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const lateOf = (a) => Number(String(a.body ?? a.title).match(/(\d+)\s*min/)?.[1]) || null;

/** Repeated alerts with the same title on the same day become one entry: the latest, with a count. */
function groupAlerts(list) {
  const out = [];
  const seen = new Map();
  for (const a of list) {
    const k = `${a.title}|${new Date(a.created_at).toDateString()}`;
    if (seen.has(k)) { seen.get(k).count += 1; continue; }
    const g = { latest: a, count: 1 };
    seen.set(k, g);
    out.push(g);
  }
  return out;
}

/** How one of today's two trips went, as a chip. */
function TripChip({ trip }) {
  const t = useT();
  if (trip.state === 'REACHED') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 14, backgroundColor: C.live50, borderWidth: 1, borderColor: C.dark ? 'rgba(74,222,128,0.3)' : 'rgba(21,128,61,0.2)' }}>
        <Icon name="tick" size={13} color={C.live} strokeWidth={2.6} />
        <Text style={{ color: C.live, fontSize: 12.5, ...F[600] }}>{t('Reached')} {time(trip.reachedAt)}</Text>
      </View>
    );
  }
  return <Badge style={{ alignSelf: 'center' }} tone={{ ON_BOARD: 'live', WAITING: 'delayed' }[trip.state] ?? 'offline'}>{t(CHILD_STATUS_TEXT[trip.state])}</Badge>;
}

/** Three steps of the trip in progress: where it started, where the bus is now, where it ends. */
function Steps({ steps }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {steps.map((s, i) => (
        <View key={s.label} style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: s.state === 'done' ? C.live : s.state === 'now' ? C.navy : 'transparent', borderWidth: 2, borderColor: s.state === 'done' ? C.live : s.state === 'now' ? C.navy : C.faint }} />
            {i < steps.length - 1 ? <View style={{ flex: 1, height: 2, backgroundColor: s.state === 'done' ? C.live : C.line }} /> : null}
          </View>
          <View style={{ gap: 2, paddingRight: 8 }}>
            <Text style={{ fontSize: 13.5, lineHeight: 18, ...F[600], color: s.state === 'next' ? C.muted : C.ink }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{s.label}</Text>
            <Txt muted small>{s.note}</Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

function ChildCard({ child, onMap }) {
  const t = useT();
  const bus = child.bus;
  const offline = bus?.freshness === 'offline';
  const live = bus && !offline;
  const route = useAsync(() => (child.routeCode ? routeData(`/api/routes/${encodeURIComponent(child.routeCode)}`) : Promise.resolve(null)), [child.routeCode]);
  const stops = route.data?.stops ?? [];
  const near = stops.find((s) => s.name === bus?.nearStop);
  const home = stops.find((s) => s.name === child.stopName);
  const pin = bus && near ? [{ busId: 1, routeCode: child.routeCode, fleetCode: bus.fleetCode, lat: near.lat, lng: near.lng, freshness: bus.freshness }] : [];
  const down = bus?.direction === 'DOWN';
  const trip = down ? child.outbound : child.inbound;
  const mins = bus?.eta && !bus.eta.passed ? Math.round((bus.eta.low + bus.eta.high) / 2) : null;
  const steps = bus ? [
    { label: down ? 'Left campus' : `Boarded${trip.boardingStop ? ` at ${trip.boardingStop}` : ''}`, note: trip.boardedAt ? time(trip.boardedAt) : '—', state: 'done' },
    { label: bus.nearStop ? `Near ${bus.nearStop}` : 'On the way', note: offline ? 'last seen' : 'now', state: 'now' },
    { label: down ? 'Home stop' : 'Campus', note: mins != null ? `~${formatMinutes(nowMin() + mins)}` : '—', state: 'next' },
  ] : null;
  return (
    <View style={[card, tinted(bus && !offline ? C.live : accentColour('navy')), { padding: 18, gap: 14 }]}>
      <CardTint color={bus && !offline ? C.live : accentColour('navy')} radius={R.lg} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={child.name} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 17, lineHeight: 22, color: C.ink, ...F[700] }} numberOfLines={1}>{child.name}</Text>
          <Txt small muted numberOfLines={2}>{[child.routeCode && `${t('Route')} ${child.routeCode}`, child.stopName].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Badge tone={live ? 'live' : 'offline'}>{live ? 'Live' : offline ? 'Offline' : 'No trip'}</Badge>
      </View>
      {stops.length ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open the live map" onPress={onMap} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.line2 }}>
          <View pointerEvents="none"><MiniMap stops={stops} buses={pin} highlightSeq={home?.seq} height={150} /></View>
        </Pressable>
      ) : route.data === undefined && child.routeCode ? <Skeleton height={150} /> : null}
      {bus ? (
        <>
          <View style={{ gap: 2 }}>
            <Txt muted small>{down ? `Drop-off at ${child.stopName ?? 'home stop'}` : 'Arrival at campus'}</Txt>
            <Text style={{ fontSize: 22, lineHeight: 28, ...F.displayBold, color: C.ink }}>
              {offline ? `${busName(bus.fleetCode)} is offline` : mins != null ? `In ${mins} min · around ${formatMinutes(nowMin() + mins)}` : `${busName(bus.fleetCode)} is on the way`}
            </Text>
          </View>
          <Steps steps={steps} />
        </>
      ) : (
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 18, lineHeight: 24, ...F.display, color: C.ink }}>{child.liveLocked ? 'Live tracking needs a subscription' : t('No bus running right now')}</Text>
          <Txt muted small>The bus shows here as soon as the driver starts the trip.</Txt>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="View live map" icon="map" onPress={onMap} disabled={!stops.length} style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Call the transport office, ${OFFICE_PHONE}`} onPress={() => Linking.openURL(`tel:${OFFICE_PHONE.replace(/\s/g, '')}`).catch(() => {})}
          style={({ pressed }) => [{ width: 52, height: 52, borderRadius: R.md, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
          <Icon name="phone" size={20} color={C.ink} />
        </Pressable>
      </View>
    </View>
  );
}

/** The bigger map for one child, refreshed with the list. */
function ChildMap({ child, onClose }) {
  const route = useAsync(() => routeData(`/api/routes/${encodeURIComponent(child.routeCode)}`), [child.routeCode]);
  const stops = route.data?.stops ?? [];
  const near = stops.find((s) => s.name === child.bus?.nearStop);
  const home = stops.find((s) => s.name === child.stopName);
  const pin = child.bus && near ? [{ busId: 1, routeCode: child.routeCode, fleetCode: child.bus.fleetCode, lat: near.lat, lng: near.lng, freshness: child.bus.freshness }] : [];
  return (
    <DetailModal title={`Route ${child.routeCode}`} subtitle={child.name} onClose={onClose}>
      {stops.length ? <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.line2 }}><MiniMap stops={stops} buses={pin} highlightSeq={home?.seq} height={420} labels /></View> : <Skeleton height={420} />}
      <Txt muted small>{child.bus ? `${busName(child.bus.fleetCode)} near ${child.bus.nearStop ?? '—'} · updated ${time(child.bus.recordedAt)}` : 'No bus on this route is running right now.'}</Txt>
      <Txt muted small>You see the bus, never your child's phone location.</Txt>
    </DetailModal>
  );
}

/** A parent's home: each linked child's bus, today's two trips and alerts. Refreshes by itself. */
export default function ParentHome() {
  const { token, user, signOut } = useSession();
  const t = useT();
  const children = useAsync(() => api('/api/parent/children', { token }), [token]);
  const alerts = useAsync(() => api('/api/parent/alerts', { token }), [token]);
  const { refreshing, onRefresh } = useRefresh(children, alerts);
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [mapOf, setMapOf] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [password, setPassword] = useState(false);
  const a = useAction();
  useEffect(() => {
    const id = setInterval(() => children.reload(), 20000);
    return () => clearInterval(id);
  }, [children]);
  const add = () => a.run(() => api('/api/parent/link', { token, body: { code } })).then((r) => { if (r) { setCode(''); setAdding(false); children.reload(); } });
  const list = children.data;
  const groups = groupAlerts(alerts.data ?? []);
  const today = groups.filter((g) => new Date(g.latest.created_at).toDateString() === new Date().toDateString());
  const firstName = list?.length === 1 ? list[0].name.split(' ')[0] : null;

  const AlertRow = ({ g }) => {
    const late = lateOf(g.latest);
    return (
      <Pressable accessibilityRole="button" onPress={() => setAlertsOpen(true)} style={({ pressed }) => [card, tinted(g.latest.kind === 'LATE' ? C.delayed : C.danger), { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, shadowOpacity: 0 }, pressed && { opacity: 0.85 }]}>
        <RowTint color={g.latest.kind === 'LATE' ? C.delayed : C.danger} radius={R.lg} />
        <IconBubble name={g.latest.kind === 'LATE' ? 'clock' : 'alert'} accent={g.latest.kind === 'LATE' ? 'amber' : 'danger'} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, lineHeight: 20, ...F[700], color: C.ink }} numberOfLines={1}>{late && g.latest.kind === 'LATE' ? `${g.latest.title.replace(/ is running late/, '')} delayed by ${late} min` : g.latest.title}</Text>
          <Txt muted small numberOfLines={1}>{g.count > 1 ? `${g.count} updates · latest ${time(g.latest.created_at)}` : dateTime(g.latest.created_at)}</Txt>
        </View>
        <Icon name="arrow" size={18} color={C.faint} />
      </Pressable>
    );
  };

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt muted small numberOfLines={1}>{user?.name} · Parent</Txt>
          <Text accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34, ...F.displayBold, color: C.ink }} numberOfLines={1}>{t('My children')}</Text>
        </View>
        <HeaderIconButton dark icon="bell" label="Alerts" badge={today.length || undefined} onPress={() => setAlertsOpen(true)} />
        <HeaderIconButton dark icon="user" label="Account" onPress={() => setAccount(true)} />
      </View>
      <DayBanner />
      <ErrorText>{children.error?.message}</ErrorText>
      {list == null ? <Skeleton height={420} /> : list.length === 0 ? (
        <View style={[card, { padding: 24, alignItems: 'center', gap: 10 }]}>
          <IconBubble name="users" accent="navy" size={56} />
          <Text style={{ fontSize: 18, ...F.display, color: C.ink, textAlign: 'center' }}>No child linked yet</Text>
          <Txt muted style={{ textAlign: 'center' }}>Ask your child for a code from Services in their app, then add it here.</Txt>
          <Button title={t('Add a child')} icon="plus" onPress={() => setAdding(true)} />
        </View>
      ) : list.map((c) => (
        <View key={c.id} style={{ gap: 14 }}>
          <ChildCard child={c} onMap={() => setMapOf(c)} />
          <View style={[card, tinted(accentColour('teal')), { paddingHorizontal: 18 }]}>
            <CardTint color={accentColour('teal')} radius={R.lg} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
              <Text style={{ fontSize: 15, ...F[500], color: C.ink }}>To campus</Text>
              <TripChip trip={c.inbound} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
              <Text style={{ fontSize: 15, ...F[500], color: C.ink }}>From campus</Text>
              <TripChip trip={c.outbound} />
            </View>
          </View>
        </View>
      ))}
      {today.length ? (
        <View style={{ gap: 10 }}>
          <Txt muted small style={{ ...F[600] }}>Alerts{firstName ? ` · ${firstName}` : ''} · today</Txt>
          {today.slice(0, 3).map((g) => <AlertRow key={g.latest.id} g={g} />)}
        </View>
      ) : null}
      {list?.length ? (
        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 }}>
          <Icon name="plus" size={18} color={C.link} />
          <Text style={{ color: C.link, fontSize: 15, ...F[600] }}>{t('Add a child')}</Text>
        </Pressable>
      ) : null}

      {adding ? (
        <Sheet title={t('Add a child')} onClose={() => setAdding(false)}>
          <View style={{ gap: 12 }}>
            <Txt muted small>Your child gets this code from Services in their app.</Txt>
            <TextField label="Code from your child's app" value={code} maxLength={9} autoCapitalize="characters" onChangeText={(v) => setCode(v.toUpperCase())} />
            <ErrorText>{a.error}</ErrorText>
            <Button title={t('Add a child')} icon="plus" busy={a.busy} disabled={code.trim().length < 8} onPress={add} />
          </View>
        </Sheet>
      ) : null}
      {mapOf ? <ChildMap child={list?.find((c) => c.id === mapOf.id) ?? mapOf} onClose={() => setMapOf(null)} /> : null}
      {alertsOpen ? (
        <DetailModal title="Alerts" onClose={() => setAlertsOpen(false)} refreshing={false} onRefresh={alerts.reload}>
          {groups.length ? groups.map((g) => (
            <View key={g.latest.id} style={[card, tinted(g.latest.kind === 'LATE' ? C.delayed : C.danger), { padding: 14, gap: 4, shadowOpacity: 0 }]}>
              <RowTint color={g.latest.kind === 'LATE' ? C.delayed : C.danger} radius={R.lg} />
              <Text style={{ fontSize: 15, ...F[700], color: C.ink }}>{g.latest.title}</Text>
              <Txt muted>{g.latest.body}</Txt>
              <Txt muted small>{g.count > 1 ? `${g.count} updates · latest ${dateTime(g.latest.created_at)}` : dateTime(g.latest.created_at)}</Txt>
            </View>
          )) : <Txt muted style={{ textAlign: 'center', paddingVertical: 24 }}>No alerts. Delays and safety notices for your child's bus show here.</Txt>}
        </DetailModal>
      ) : null}
      {account ? (
        <DetailModal title="Account" subtitle={user?.name} onClose={() => setAccount(false)}>
          <Button title="Change password" icon="lock" variant="ghost" onPress={() => setPassword(true)} />
          <Appearance />
          <YourData />
          <Button title="Sign out" icon="logout" variant="danger" onPress={async () => (await confirm('Are you sure you want to log out?', '', 'Yes, Log Out', true)) && signOut()} />
          <ChangePasswordSheet visible={password} onClose={() => setPassword(false)} />
        </DetailModal>
      ) : null}
    </Screen>
  );
}
