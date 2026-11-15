import { useEffect, useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { ListRow, ViewCard, ViewList } from '../../components/adminkit.js';
import { ChangePasswordSheet } from '../../components/ChangePassword.js';
import Icon from '../../components/Icon.js';
import {
  Avatar, Badge, Button, Collapsible, confirm, ErrorText, IconBubble, KV, Notice, PageHead, Screen, Select, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { notificationsAvailable, pushRegistered, registerForPush } from '../../lib/notify.js';
import { refreshPlan } from '../../lib/sampler.js';
import YourData from '../../components/YourData.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/offline.js';
import Appearance from '../../components/Appearance.js';
import { C, F, G, R, shadow } from '../../theme.js';
import { call } from '../PublicHome.js';
import MyAvatar from '../../components/MyAvatar.js';

// Bus fees are paid on the university's DigiiCampus portal. Fee status and
// sign-in checks need API access from Digii; until then the app links there.
const DIGIICAMPUS_URL = 'https://crescent.digiicampus.com/';

/** The bus fee: paid on DigiiCampus, where the student also sees its status. */
function BusFee() {
  return (
    <ViewCard icon="wallet" title="Bus fee" summary="Pay and check status on DigiiCampus">
      <View style={{ gap: 10 }}>
        <Txt muted small>Pay your bus fee and check whether it is paid on DigiiCampus, the university's student portal. Sign in there with your DigiiCampus account.</Txt>
        <Button title="Pay bus fee" variant="red" icon="arrow" onPress={() => Linking.openURL(DIGIICAMPUS_URL).catch(() => {})} />
        <Txt muted small style={{ textAlign: 'center' }}>Opens crescent.digiicampus.com</Txt>
      </View>
    </ViewCard>
  );
}

/**
 * The plain-language privacy notice (doc 9.11): what is collected, when, why,
 * for how long, and how to opt out. Shown here and before consent is given.
 */
export function PrivacyNotice() {
  const items = [
    ['What', "your phone's location, one reading every 20 seconds."],
    ['When', 'only inside your travel window (set below) and only near a bus route. Outside it the app does not ask for your location at all.'],
    ['Why', 'to notice that you are on a university bus and ask you, with one tap, to confirm your attendance.'],
    ['What is kept', 'never your location. Each reading is compared with the bus and thrown away. What is kept is the attendance record - trip, time, stop, method and confidence - for one academic year, then only as totals.'],
    ['Who sees it', 'you, and the transport office as registers. There is no screen anywhere that shows where a student is.'],
    ['Opting out', 'withdraw consent here at any time. Your attendance is then taken by the boarding check, the bus QR code or the driver.'],
  ];
  return (
    <View style={{ gap: 6 }}>
      {items.map(([k, v]) => <Txt key={k} small><Txt small bold>{k}:</Txt> {v}</Txt>)}
    </View>
  );
}

// Travel window presets; '' is the university default (06:00-10:30 and 15:30-19:30).
const WINDOW_PRESETS = [
  { value: '', label: 'University default · morning and evening' },
  { value: '06:00-10:30', label: 'Morning only · 06:00 – 10:30' },
  { value: '15:30-19:30', label: 'Evening only · 15:30 – 19:30' },
  { value: 'custom', label: 'Custom hours' },
];
const presetOf = (w) => (WINDOW_PRESETS.some((p) => p.value === (w ?? '')) ? w ?? '' : 'custom');

/** One line of a settings section: icon, title and explanation, and a control. */
function SettingRow({ icon, accent = 'navy', title, children, control, first }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: first ? 0 : 12, borderTopWidth: first ? 0 : 1, borderTopColor: C.line2 }}>
      <IconBubble name={icon} accent={accent} size={36} iconSize={17} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{title}</Txt>
        {children}
      </View>
      {control ? <View style={{ alignSelf: 'center' }}>{control}</View> : null}
    </View>
  );
}

const Toggle = ({ value, onChange, disabled, label }) => (
  <Switch
    value={value}
    onValueChange={onChange}
    disabled={disabled}
    accessibilityLabel={label}
    trackColor={{ false: '#cfd2d8', true: C.live }}
    thumbColor="#fff"
    ios_backgroundColor="#cfd2d8"
  />
);

/** A row in "How your trips are recorded". */
function Method({ icon, title, hint, tone, state }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: R.md, backgroundColor: C.surface }}>
      <Icon name={icon} size={17} color={C.navy} />
      <View style={{ flex: 1 }}>
        <Txt small bold>{title}</Txt>
        <Txt muted small>{hint}</Txt>
      </View>
      <Badge tone={tone}>{state}</Badge>
    </View>
  );
}

export default function Settings({ navigation }) {
  const { token, user, entitlement, refresh, signOut } = useSession();
  const t = useT();
  const routes = useAsync(() => api('/api/routes'), []);
  const contacts = useAsync(() => api('/api/contacts'), []);
  const plan = useAsync(() => (token ? api('/api/attendance/plan', { token }) : Promise.resolve(null)), [token, user?.locationConsent, user?.travelWindows]);
  const [form, setForm] = useState(null);
  const route = useAsync(() => (form?.homeRouteCode ? api(`/api/routes/${encodeURIComponent(form.homeRouteCode)}`) : Promise.resolve(null)), [form?.homeRouteCode]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pushOn, setPushOn] = useState(pushRegistered);

  useEffect(() => {
    if (user && !form) {
      setForm({
        homeRouteCode: user.homeRouteCode ?? '',
        homeStopSeq: user.homeStopSeq ?? '',
        windowPreset: presetOf(user.travelWindows),
        travelWindows: user.travelWindows ?? '',
        language: user.language ?? 'en',
      });
    }
  }, [user, form]);

  const save = async (patch, done = 'Saved.') => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await api('/api/me', { token, method: 'PATCH', body: patch });
      await refresh();
      await refreshPlan();
      plan.reload();
      setMessage(done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!form || !user) return null;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const stop = route.data?.stops.find((s) => s.seq === Number(form.homeStopSeq));
  const campus = route.data?.stops.at(-1);
  const p = plan.data;
  const saveTravel = () => save({
    homeRouteCode: form.homeRouteCode || null,
    homeStopSeq: form.homeStopSeq ? Number(form.homeStopSeq) : null,
    travelWindows: form.windowPreset === 'custom' ? form.travelWindows.trim() : form.windowPreset,
    language: form.language,
  }, 'Travel details saved.');
  const turnOnPush = () => registerForPush(token).then((r) => {
    setPushOn(r.ok);
    if (r.ok) setMessage('Notifications are on for this phone.');
    else setError(r.reason);
  });

  const chip = (icon, label, on) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? 'rgba(97, 206, 112,0.16)' : 'rgba(255,255,255,0.12)', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5, maxWidth: '100%' }}>
      <Icon name={icon} size={13} color={C.gold} />
      <Text style={{ color: on ? '#b6ecbe' : 'rgba(255,255,255,0.85)', fontSize: 12.5, ...F[600], flexShrink: 1 }} numberOfLines={1}>{label}</Text>
    </View>
  );

  return (
    <Screen safeTop>
      <PageHead title="Settings" />

      <View style={{ backgroundColor: C.navyFill, borderRadius: R.lg, padding: 16, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', ...shadow }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <MyAvatar size={58} light />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: '#fff', fontSize: 18, ...F[700] }}>{user.name}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>@{user.username}{user.registerNo ? ` · ${user.registerNo}` : ''}{user.department ? ` · ${user.department}` : ''}</Text>
            {user.email ? <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }} numberOfLines={1}>{user.email}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {chip('route', user.homeRouteCode ? `Route ${user.homeRouteCode}` : 'No route', false)}
          {chip('pin', stop?.name ?? 'No stop chosen', false)}
        </View>
      </View>

      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>

      <ViewList label="Travel">
      <ViewCard
        icon="route"
        title="Route and stop"
        summary={route.data ? `Route ${route.data.code}${stop ? ` · ${stop.name}` : ' · choose your stop'}` : 'Choose your route and stop'}
      >
        <Txt muted small>Sets your home screen, arrival times and the boarding check.</Txt>
        <Select
          label="Route"
          value={form.homeRouteCode}
          onChange={(v) => setForm((f) => ({ ...f, homeRouteCode: v, homeStopSeq: '' }))}
          placeholder="—"
          searchable
          options={[{ value: '', label: '—' }, ...(routes.data ?? []).map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))]}
        />
        <Select
          label="Boarding stop"
          value={form.homeStopSeq}
          onChange={set('homeStopSeq')}
          disabled={!route.data}
          placeholder="—"
          searchable
          options={(route.data?.stops ?? []).map((s) => ({ value: s.seq, label: `${s.seq}. ${s.name}${s.scheduled_time ? ` · ${s.scheduled_time}` : ''}` }))}
        />
        {stop ? (
          <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: R.md, backgroundColor: C.surface }}>
            <Icon name="clock" size={14} color={C.red600} />
            <Txt small muted style={{ flex: 1 }}>
              Bus {route.data.code} reaches <Txt small bold>{stop.name}</Txt>{stop.scheduled_time ? ` at ${stop.scheduled_time}` : ''} and arrives at {campus?.name ?? 'campus'}{campus?.scheduled_time ? ` at ${campus.scheduled_time}` : ''}.
            </Txt>
          </View>
        ) : null}
        <Select
          label="When you travel"
          hint="The boarding check and phone attendance only work inside these hours."
          value={form.windowPreset}
          onChange={set('windowPreset')}
          options={WINDOW_PRESETS}
        />
        {form.windowPreset === 'custom' ? (
          <TextField
            label="Custom travel window"
            hint="e.g. 07:00-09:30,16:00-18:30"
            value={form.travelWindows}
            onChangeText={set('travelWindows')}
            placeholder="07:00-09:30,16:00-18:30"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
        ) : null}
        <Button title="Save travel details" busy={busy} onPress={saveTravel} />
      </ViewCard>
      <BusFee />
      </ViewList>

      <Appearance />

      <ViewList label="Reminders and notifications">
        <ListRow icon="bus" accent={user.boardingReminders ? 'emerald' : 'navy'} title="Boarding check"
          summary={`Asks "Did you board?" when your bus leaves ${stop?.name ?? 'your stop'}.`}
          right={<Toggle value={user.boardingReminders} disabled={busy} label="Boarding check" onChange={(v) => save({ boardingReminders: v }, v ? 'Boarding check is on.' : 'Boarding check is off.')} />} />
        <ListRow icon="clock" accent={user.arrivalAlerts ? 'emerald' : 'navy'} title="Bus is almost here"
          summary={`About 5 minutes before the bus reaches ${stop?.name ?? 'your stop'}.`}
          right={<Toggle value={user.arrivalAlerts} disabled={busy} label="Bus is almost here" onChange={(v) => save({ arrivalAlerts: v }, v ? 'You will be told when the bus is near.' : 'Bus alerts are off.')} />} />
        <ListRow icon="bell" title="Phone notifications"
          summary={notificationsAvailable ? 'Alerts arrive even when the app is closed.' : 'Not available in this build.'}
          right={pushOn ? <Badge tone="live">On</Badge> : notificationsAvailable ? <Button small variant="ghost" title="Turn on" onPress={turnOnPush} /> : <Badge>Unavailable</Badge>} />
        <ListRow icon="alert" accent="red" title="Route alerts" summary={`Delays and changes for Route ${user.homeRouteCode ?? '—'}.`} right={<Badge tone="info">Always on</Badge>} />
      </ViewList>

      <ViewList label="Attendance and privacy">
        <ListRow icon="pin" title="Use my location for attendance" summary="Optional. Readings are compared with the bus and thrown away."
          right={<Toggle value={user.locationConsent} disabled={busy} label="Location consent" onChange={(v) => save({ locationConsent: v }, v ? 'Thank you - phone GPS attendance is on.' : 'Consent withdrawn. Your location is no longer used.')} />} />
      <ViewCard
        icon="shield"
        title="How your trips are recorded"
        summary={`Phone GPS ${user.locationConsent ? (p?.shouldSample ? 'active' : 'allowed') : 'off'} · bus QR always`}
      >
        <View style={{ gap: 8 }}>
          <Method icon="bus" title="Boarding check" hint="From the bus GPS only; your location is never used." tone={user.boardingReminders ? 'live' : 'offline'} state={user.boardingReminders ? 'On' : 'Off'} />
          <Method icon="signal" title="Phone GPS" hint="Your phone notices it is moving with the bus." tone={p?.shouldSample ? 'live' : 'offline'} state={p?.shouldSample ? 'Active now' : user.locationConsent ? 'Paused' : 'Off'} />
          <Method icon="qr" title="Bus QR code" hint="Scan the code on the driver's screen." tone="live" state="Always" />
        </View>
        {p && user.locationConsent && !p.shouldSample ? (
          <Txt muted small>Phone GPS is paused: {!p.deviceBound ? 'this phone is not bound yet (open Attendance).' : !p.inTravelWindow ? `outside your travel window (${p.travelWindows}).` : 'waiting for the next check.'}</Txt>
        ) : null}
        <Collapsible title="Read the privacy notice"><PrivacyNotice /></Collapsible>
      </ViewCard>
      </ViewList>

      <ViewList label="More">
      <ListRow icon="sparkle" title="Services" summary="Parent access, route change, lost and found" onPress={() => navigation.navigate('Services')} />
      <ViewCard icon="lock" title="Account and security" summary={`@${user.username}${user.registerNo ? ` · ${user.registerNo}` : ''}`}>
        <View style={{ gap: 6 }}>
          <KV k="Username" v={`@${user.username}`} />
          <KV k="Register no." v={user.registerNo} />
          <KV k="Department" v={user.department} />
          <KV k="Email" v={user.email} />
        </View>
        <Txt muted small>To correct your name, register number or department, contact the transport office. Changing your password signs you out on every other device.</Txt>
        <Button title="Change password" variant="ghost" icon="lock" onPress={() => setChangingPassword(true)} />
      </ViewCard>

      <YourData />

      <ViewCard icon="phone" title="Help and support" summary="Contacts and common questions">
        <View style={{ gap: 2 }}>
          {(contacts.data ?? []).map((c, i) => (
            <Pressable accessibilityRole="button" key={c.label} onPress={() => call(c.phone)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line2, opacity: pressed ? 0.6 : 1 })}>
              <Txt style={{ flex: 1 }}>{c.label}</Txt>
              <Text style={{ color: C.red600, ...F[700] }}>{c.phone}</Text>
              <Icon name="phone" size={15} color={C.red600} />
            </Pressable>
          ))}
        </View>
        <Collapsible title={'Asked "Did you board?" but didn\'t travel'}>
          <Txt muted small>Answer "No". Nothing is recorded and the reminders stop. If you never travel at some times, set "When you travel" above.</Txt>
        </Collapsible>
        <Collapsible title="My attendance looks wrong">
          <Txt muted small>Open Attendance and tap "Dispute" on the trip within 7 days. The transport office reviews it.</Txt>
        </Collapsible>
      </ViewCard>

      <ViewCard icon="sparkle" title="About" summary="Crescent Transit · Bus Route 2026-2027">
        <View style={{ gap: 6 }}>
          <KV k="App" v="Crescent Transit · Bus Tracker" />
          <KV k="Timetable" v="BSACIST Bus Route 2026-2027" />
          <KV k="Access" v={entitlement?.required ? 'Monthly subscription' : 'Included for every student'} />
        </View>
      </ViewCard>
      </ViewList>

      <Button
        title="Sign out"
        variant="ghost"
        icon="logout"
        style={{ marginTop: 6, borderColor: 'rgba(160,32,34,0.28)' }}
        textStyle={{ color: C.danger }}
        onPress={async () => (await confirm('Sign out?', 'You can sign in again any time.', 'Sign out')) && signOut()}
      />
      <ChangePasswordSheet visible={changingPassword} onClose={() => setChangingPassword(false)} />
    </Screen>
  );
}
