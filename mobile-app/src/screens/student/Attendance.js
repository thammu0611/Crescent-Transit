import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Platform, Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Chips, DetailModal } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import RateTrip from '../../components/RateTrip.js';
import {
  accentColour, alpha, Badge, Button, DataList, DirectionBadge, Empty, ErrorText, ItemCard, LinkButton, MonthPicker, Row, Screen,
  Segmented, Select, Sheet, Text, TextField, Txt,
} from '../../components/ui.js';
import { api, ApiError, getSocket } from '../../lib/api.js';
import { ATTENDANCE_CHANGED, emit, on } from '../../lib/events.js';
import { METHOD_TEXT, STATUS_TEXT, dateTime, thisMonth, time } from '../../lib/format.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { useT } from '../../lib/offline.js';
import { refreshPlan, requestNewOtp, setSource, submitOtp, useSampler } from '../../lib/sampler.js';
import { useServerInfo } from '../../lib/serverInfo.js';
import { useSession } from '../../lib/session.js';
import { getJSON, setJSON } from '../../lib/storage.js';
import { C, F, G, R, shadow } from '../../theme.js';

const QUEUE_KEY = 'ubts.qrQueue';
const TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'offline', REJECTED: 'offline', VOID: 'offline' };
const busName = (fleet) => String(fleet ?? '').replace('BSACIST-', 'Bus ');
const tripName = (dir) => (dir === 'DOWN' ? 'Evening trip' : 'Morning trip');
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const label = { margin: 0, fontSize: 13, lineHeight: 18, ...F[500], color: C.muted };
const h2 = { fontSize: 20, lineHeight: 26, ...F.display, color: C.ink };
const card = { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, ...shadow };

/** The automatic (GPS) check-in: what it needs, and whether it is running. */
function AutoPanel({ token, user, navigation, bare = false }) {
  const box = (pad) => (bare ? { gap: pad } : [card, { padding: 16, gap: pad }]);
  const s = useSampler();
  const demo = Boolean(useServerInfo()?.demoMode);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null);
  const buses = useAsync(
    () => (s.plan?.subscribed && user.homeRouteCode ? api(`/api/live?route=${encodeURIComponent(user.homeRouteCode)}`, { token }) : Promise.resolve([])),
    [s.plan?.subscribed, user.homeRouteCode, token],
  );
  const p = s.plan;
  if (!p) return <View style={box(10)}><Txt muted>Checking…</Txt><ErrorText>{s.error}</ErrorText><Button title="Refresh" variant="ghost" small onPress={refreshPlan} /></View>;
  const checks = [
    ...(p.subscribed ? [] : [['Subscription', false, <LinkButton key="a" title="Subscribe" onPress={() => navigation.navigate('Subscription')} />]]),
    ['Location consent', p.consent, <LinkButton key="b" title="Give consent in Settings" onPress={() => navigation.navigate('Profile')} />],
    ['This phone bound to your account', p.deviceBound && !s.otp, null],
    ['Inside your travel window', p.inTravelWindow, <Txt key="c" muted small>Window: {p.travelWindows}</Txt>],
  ];
  const allOk = checks.every((c) => c[1]);
  return (
    <View style={box(12)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 16, ...F[600], color: C.ink, flex: 1 }}>{allOk ? 'Your phone checks you in' : 'Automatic check-in is paused'}</Text>
        <Badge tone={allOk ? 'live' : 'offline'}>{allOk ? 'Active' : 'Paused'}</Badge>
      </View>
      {checks.map(([name, ok, fix]) => (
        <View key={name} style={{ gap: 2 }}>
          <Row>
            <Icon name={ok ? 'check' : 'x'} size={15} color={ok ? C.live : C.danger} />
            <Txt style={{ flex: 1 }}>{name}</Txt>
          </Row>
          {!ok && fix ? <View style={{ paddingLeft: 23 }}>{fix}</View> : null}
        </View>
      ))}
      {s.otp && (
        <View style={{ gap: 8 }}>
          <Txt muted small>
            {s.otp.emailedTo ? `Your account is bound to another phone. We emailed a code to ${s.otp.emailedTo}. Enter it to move your account here.` : 'Your account is bound to another phone. If you have no code, ask the transport office to reset your phone.'}
            {s.otp.devOtp ? ` (test mode code: ${s.otp.devOtp})` : ''}
          </Txt>
          <Row>
            <TextField value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} placeholder="6-digit code" style={{ flex: 1 }} accessibilityLabel="One-time code" />
            <Button title="Move here" variant="ghost" onPress={async () => { setOtpError(null); try { await submitOtp(otp); } catch (err) { setOtpError(err.message); } }} />
          </Row>
          <Button small variant="ghost" title="Send a new code" onPress={async () => { setOtpError(null); try { await requestNewOtp(); setOtp(''); } catch (err) { setOtpError(err.message); } }} />
          <ErrorText>{otpError}</ErrorText>
        </View>
      )}
      {p.shouldSample && !s.otp && (
        <>
          <Select
            label="Location source"
            value={s.source === 'ride' ? `ride:${s.rideBusId}` : 'gps'}
            onChange={(v) => (v === 'gps' ? setSource('gps') : setSource('ride', Number(String(v).split(':')[1])))}
            options={[{ value: 'gps', label: "This phone's location" }, ...(demo ? buses.data ?? [] : []).map((b) => ({ value: `ride:${b.busId}`, label: `Demo: ride along with ${b.fleetCode}` }))]}
          />
          <Txt muted small>
            One reading every {p.intervalS} s, only in your travel window, while the app is open. It is compared with the bus and discarded - never stored.
            {s.last ? ` Last: ${time(s.last.at)} · ${s.last.prompted ? 'prompt sent' : s.last.status ?? (s.last.matched ? `moving with a bus (${s.last.count ?? ''})` : s.last.reason?.toLowerCase().replaceAll('_', ' ') ?? 'ok')}` : ''}
          </Txt>
        </>
      )}
      <ErrorText>{s.error}</ErrorText>
    </View>
  );
}

/** The scanner window: the camera inside a rounded frame with corner brackets and a moving line. */
function ScanViewport({ onScan, error, onRetry }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(line, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(line, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [line]);
  useEffect(() => { if (!error) done.current = false; }, [error]);
  const bracket = error ? '#F87171' : '#F7BC31';
  const B = { position: 'absolute', width: 30, height: 30, borderColor: bracket };
  const live = permission?.granted && Platform.OS !== 'web';
  return (
    <View style={{ height: 172, borderRadius: 20, backgroundColor: '#05080C', overflow: 'hidden', borderWidth: 2, borderColor: error ? 'rgba(239,68,68,0.6)' : 'transparent' }}>
      {live && !error ? (
        <CameraView
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (done.current || !String(data).startsWith('UBTS-BOARD:')) return;
            done.current = true;
            onScan(String(data));
          }}
        />
      ) : null}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' }}>
        <View style={{ width: 142, height: 112 }}>
          <View style={[B, { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 14 }]} />
          <View style={[B, { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 14 }]} />
          <View style={[B, { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 14 }]} />
          <View style={[B, { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 14 }]} />
          {!error && (live || !permission || Platform.OS === 'web') ? (
            <Animated.View style={{ position: 'absolute', left: 8, right: 8, top: 4, height: 2, backgroundColor: '#F7BC31', shadowColor: '#F7BC31', shadowOpacity: 1, shadowRadius: 6, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [0, 100] }) }] }} />
          ) : null}
        </View>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(5,8,12,0.82)', paddingHorizontal: 24 }}>
          <Icon name="alert" size={26} color="#FCA5A5" />
          <Text style={{ color: '#F8FAFC', fontSize: 15, ...F[600], textAlign: 'center' }}>{error}</Text>
          <Text style={{ color: '#CBD5E1', fontSize: 12.5, ...F[500], textAlign: 'center' }}>Codes change every minute. Ask the driver to show the new one.</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={{ marginTop: 4, height: 38, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#0F172A', fontSize: 14, ...F[600] }}>Scan again</Text>
          </Pressable>
        </View>
      ) : permission && !permission.granted && Platform.OS !== 'web' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center', gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={requestPermission} style={{ height: 38, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
            <Icon name="camera" size={16} color="#0F172A" />
            <Text style={{ color: '#0F172A', fontSize: 14, ...F[600] }}>Allow camera</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={{ position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center', color: '#CBD5E1', fontSize: 12.5, ...F[500] }}>
          {Platform.OS === 'web' ? 'Scanning works in the phone app' : "Point at the code on the driver's phone"}
        </Text>
      )}
    </View>
  );
}

const GOLD = '#F7BC31';
const ON_NAVY = 'rgba(255,255,255,0.72)';

/** A ring with the share of trips counted present, drawn on the navy summary card. */
function Ring({ pct, size = 92, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const len = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} />
        {pct > 0 ? <Circle cx={c} cy={c} r={r} fill="none" stroke={GOLD} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(len * pct) / 100} ${len}`} transform={`rotate(-90 ${c} ${c})`} /> : null}
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, lineHeight: 26, ...F.displayBold, color: '#fff', fontVariant: ['tabular-nums'] }}>{pct}%</Text>
        <Text style={{ fontSize: 11, lineHeight: 13, ...F[500], color: ON_NAVY }}>present</Text>
      </View>
    </View>
  );
}

/** One direction's month on the summary card: trips present out of trips taken, with a bar. */
function DirTile({ name, done, total }) {
  return (
    <View style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', gap: 6 }}>
      <Text style={{ color: ON_NAVY, fontSize: 12.5, lineHeight: 16, ...F[500] }} numberOfLines={1}>{name}</Text>
      <Text style={{ color: '#fff', fontSize: 22, lineHeight: 26, ...F.displayBold, fontVariant: ['tabular-nums'] }}>
        {done}<Text style={{ fontSize: 13, ...F[500], color: 'rgba(255,255,255,0.6)' }}>{` of ${total}`}</Text>
      </Text>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
        <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: 5, borderRadius: 3, backgroundColor: GOLD }} />
      </View>
    </View>
  );
}

/** Today's morning or evening trip: present (bus, time, how), waiting for an answer, or not yet. */
function TodayRow({ dir, rec, first }) {
  const present = Boolean(rec?.present);
  const tone = present ? C.live : rec ? C.delayed : C.muted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: C.line2 }}>
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(tone, 0.14), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={present ? 'check' : rec ? 'clock' : 'bus'} size={19} color={tone} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt bold numberOfLines={1}>{dir === 'DOWN' ? 'Evening · From college' : 'Morning · To college'}</Txt>
        <Txt muted small numberOfLines={1}>
          {present ? `${busName(rec.fleet_code)} · boarded ${time(rec.boarded_at)}` : rec ? STATUS_TEXT[rec.status] ?? 'Waiting' : 'Not checked in yet'}
        </Txt>
      </View>
      <Badge tone={present ? 'live' : rec ? 'delayed' : 'offline'}>{present ? 'Present' : rec ? 'Pending' : 'Waiting'}</Badge>
    </View>
  );
}

function DisputeDialog({ token, record, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [claimedPresent, setClaimedPresent] = useState(!record.present);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (reason.trim().length < 5) return setError('Describe what is wrong (at least 5 characters).');
    setBusy(true);
    try {
      await api(`/api/attendance/${record.attendance_id}/dispute`, { token, body: { reason, claimedPresent } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Dispute this record" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Txt muted small>{record.fleet_code} · {dateTime(record.boarded_at)} · currently {STATUS_TEXT[record.status]}</Txt>
        <Txt bold>I was</Txt>
        <Segmented value={claimedPresent} onChange={setClaimedPresent} options={[{ value: true, label: 'On this bus' }, { value: false, label: 'Not on this bus' }]} />
        <TextField label="What is wrong?" value={reason} onChangeText={setReason} multiline />
        <ErrorText>{error}</ErrorText>
        <Button title="Send to the transport office" busy={busy} onPress={send} />
      </View>
    </Sheet>
  );
}

/** The month's trips, one per card, with dispute and rating. */
function History({ token, entitlement, navigation, onClose, focusId }) {
  const t = useT();
  const [month, setMonth] = useState(thisMonth());
  const [run, setRun] = useState('');
  const [disputing, setDisputing] = useState(null);
  const [rating, setRating] = useState(null);
  const record = useAsync(() => (entitlement?.active ? api(`/api/attendance/me?month=${month}`, { token }) : Promise.resolve(null)), [token, month, entitlement?.active]);
  const rated = useAsync(() => (entitlement?.active ? api('/api/feedback/me', { token }) : Promise.resolve([])), [token, entitlement?.active]);
  const { refreshing, onRefresh } = useRefresh(record, rated);
  const ratedTrips = new Set((rated.data ?? []).map((f) => f.trip_id));
  const canRate = (r) => r.present && Date.now() - new Date(r.boarded_at).getTime() < 7 * 86400000;
  const all = record.data?.records ?? [];
  const records = all.filter((r) => !run || r.direction === run);
  return (
    <DetailModal title="History" subtitle={record.data ? `${record.data.upPresent} ${t('to college')} · ${record.data.downPresent} ${t('from college')} ${t('present')}` : null} onClose={onClose} refreshing={refreshing} onRefresh={onRefresh}>
      <MonthPicker value={month} onChange={setMonth} />
      {!entitlement?.active ? (
        <View style={{ alignItems: 'center' }}>
          <Empty>Your attendance record is part of the subscription.</Empty>
          <LinkButton title="Subscribe" onPress={() => { onClose(); navigation.navigate('Subscription'); }} />
        </View>
      ) : (
        <>
          <ErrorText>{record.error?.message}</ErrorText>
          <Chips
            value={run}
            onChange={setRun}
            options={[
              { value: '', label: t('Both directions'), count: all.length },
              { value: 'UP', label: t('To college'), count: all.filter((r) => r.direction === 'UP').length },
              { value: 'DOWN', label: t('From college'), count: all.filter((r) => r.direction === 'DOWN').length },
            ]}
          />
          <DataList
            rows={record.data ? records : undefined}
            keyOf={(r) => r.attendance_id}
            empty="No trips recorded this month."
            render={(r) => (
              <ItemCard
                title={dateTime(r.boarded_at)}
                subtitle={`Route ${r.route_code} · ${r.route_name} · ${METHOD_TEXT[r.method] ?? r.method}`}
                right={<Badge tone={TONE[r.status]}>{`${STATUS_TEXT[r.status]}${r.auto_confirmed ? ' (auto)' : ''}`}</Badge>}
                highlight={r.attendance_id === focusId}
              >
                <View style={{ alignSelf: 'flex-start' }}><DirectionBadge direction={r.direction} /></View>
                <Txt small>{r.boarding_stop ?? '—'} → {r.alighting_stop ?? (r.alighted_at ? '—' : 'on board')}</Txt>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt muted small>{r.present ? 'Counted present' : 'Not counted'}</Txt>
                  {r.canDispute ? <LinkButton title="Dispute" onPress={() => setDisputing(r)} /> : <Txt muted small>{r.dispute?.resolution ?? (r.dispute ? 'Under review' : '')}</Txt>}
                  {ratedTrips.has(r.trip_id) ? <Txt muted small>{t('Rated')}</Txt> : canRate(r) ? <LinkButton title={t('Rate trip')} onPress={() => setRating(r)} /> : null}
                </Row>
              </ItemCard>
            )}
          />
          <Txt muted small>Disputes can be raised within 7 days. Records are locked each night at 23:30; the transport office can still correct them.</Txt>
        </>
      )}
      {rating ? <RateTrip trip={rating} onClose={() => setRating(null)} onDone={() => { setRating(null); rated.reload(); }} /> : null}
      {disputing && <DisputeDialog token={token} record={disputing} onClose={() => setDisputing(null)} onDone={() => { setDisputing(null); record.reload(); emit(ATTENDANCE_CHANGED); }} />}
    </DetailModal>
  );
}

/**
 * Attendance: the boarding check for the trip in progress, the three ways to
 * check in (automatic GPS, scanning the driver's QR, typing the code), and this
 * month's summary. The full record opens from History.
 */
export default function StudentAttendance({ navigation }) {
  const { token, user, entitlement } = useSession();
  const [method, setMethod] = useState('qr');
  const [history, setHistory] = useState(null); // null closed, true open, or an attendance id to highlight
  const [prompt, setPrompt] = useState(null);
  const [answering, setAnswering] = useState(false);
  const [checked, setChecked] = useState(null); // { bus, at, how }
  const [scanError, setScanError] = useState(null);
  const [routeCode, setRouteCode] = useState(user.homeRouteCode ?? '');
  const [code, setCode] = useState('');
  const [queue, setQueue] = useState([]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const month = thisMonth();
  const record = useAsync(() => (entitlement?.active ? api(`/api/attendance/me?month=${month}`, { token }) : Promise.resolve(null)), [token, month, entitlement?.active]);
  const { refreshing, onRefresh } = useRefresh(record, refreshPlan);
  const reload = record.reload;
  useEffect(() => on(ATTENDANCE_CHANGED, () => reload()), [reload]);

  // The waiting boarding question, if any.
  const loadPending = useCallback(async () => {
    try { setPrompt((await api('/api/attendance/pending', { token }))[0] ?? null); } catch { /* the socket brings it */ }
  }, [token]);
  useEffect(() => {
    loadPending();
    const socket = getSocket(token);
    const onPrompt = (p) => setPrompt(p);
    socket.on('attendance:prompt', onPrompt);
    return () => socket.off('attendance:prompt', onPrompt);
  }, [token, loadPending]);
  useEffect(() => on(ATTENDANCE_CHANGED, loadPending), [loadPending]);

  const answer = async (a) => {
    setAnswering(true);
    setError(null);
    try {
      await api(`/api/attendance/${prompt.attendanceId}/confirm`, { token, body: { answer: a } });
      if (a === 'YES') setChecked({ bus: busName(prompt.fleetCode), at: new Date().toISOString(), how: 'confirmed' });
      setPrompt(null);
      emit(ATTENDANCE_CHANGED);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) setTimeout(() => setPrompt(null), 1500);
    } finally {
      setAnswering(false);
    }
  };

  // QR and typed codes, queued while offline.
  const submit = async (scan) => {
    try {
      const r = await api('/api/attendance/qr', { token, body: scan });
      setChecked({ bus: r.fleetCode ? busName(r.fleetCode) : `Route ${scan.routeCode ?? user.homeRouteCode ?? ''}`.trim(), at: new Date().toISOString(), how: scan.payload ? 'scanned QR' : 'typed code', already: r.alreadyRecorded });
      setScanError(null);
      emit(ATTENDANCE_CHANGED);
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (scan.payload) setScanError(err.message); else setError(err.message);
        return true; // the server answered: do not queue
      }
      return false;
    }
  };
  const checkIn = async (scan) => {
    setError(null);
    setMessage(null);
    const full = { ...scan, scannedAt: new Date().toISOString() };
    if (!(await submit(full))) {
      const q = [...(await getJSON(QUEUE_KEY, [])), full];
      await setJSON(QUEUE_KEY, q);
      setQueue(q);
      setMessage('No network. The scan is saved and will be sent when the connection returns.');
    }
  };
  useEffect(() => {
    const flush = async () => {
      const q = await getJSON(QUEUE_KEY, []);
      setQueue(q);
      if (!q.length) return;
      const rest = [];
      for (const scan of q) if (!(await submit(scan))) rest.push(scan);
      await setJSON(QUEUE_KEY, rest);
      setQueue(rest);
    };
    flush();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && flush());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const typed = () => {
    if (!routeCode.trim()) return setError('Enter the route.');
    if (!/^\d{6}$/.test(code)) return setError('The code has 6 digits.');
    checkIn({ routeCode: routeCode.trim(), code });
  };

  const all = record.data?.records ?? [];
  const up = all.filter((r) => r.direction === 'UP');
  const down = all.filter((r) => r.direction === 'DOWN');
  const present = all.filter((r) => r.present).length;
  const pct = all.length ? Math.round((present / all.length) * 100) : 0;
  const disputes = all.filter((r) => r.dispute && !r.dispute.resolution).length;
  const todayOf = (d) => {
    const mine = all.filter((r) => r.direction === d && sameDay(r.boarded_at, Date.now()));
    return mine.find((r) => r.present) ?? mine[0] ?? null;
  };
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const todayName = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34, ...F.displayBold, color: C.ink, flexShrink: 1 }} numberOfLines={1}>Attendance</Text>
        <Pressable accessibilityRole="button" onPress={() => setHistory(true)} hitSlop={6} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }, pressed && { opacity: 0.8 }]}>
          <Icon name="calendar" size={16} color={C.navy} />
          <Text style={{ color: C.navy, fontSize: 14, ...F[600] }}>History</Text>
        </Pressable>
      </View>

      {/* This month, at a glance */}
      {entitlement?.active ? (
        <LinearGradient colors={G.navy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: R.lg, padding: 18, gap: 16, overflow: 'hidden', ...shadow }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={{ color: ON_NAVY, fontSize: 13, ...F[600], letterSpacing: 0.4 }}>{monthName.toUpperCase()}</Text>
              <Text style={{ color: '#fff', fontSize: 30, lineHeight: 36, ...F.displayBold, fontVariant: ['tabular-nums'] }}>
                {record.data ? present : '—'}<Text style={{ fontSize: 15, ...F[500], color: ON_NAVY }}>{record.data ? ` of ${all.length} trips` : ''}</Text>
              </Text>
              <Text style={{ color: ON_NAVY, fontSize: 13, lineHeight: 18, ...F[500] }}>counted present this month</Text>
            </View>
            <Ring pct={pct} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <DirTile name="To college" done={up.filter((r) => r.present).length} total={up.length} />
            <DirTile name="From college" done={down.filter((r) => r.present).length} total={down.length} />
          </View>
          {disputes ? (
            <Pressable accessibilityRole="button" onPress={() => setHistory(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(247,188,49,0.14)' }}>
              <Icon name="clock" size={15} color={GOLD} />
              <Text style={{ fontSize: 13, ...F[600], color: GOLD, flex: 1 }}>{disputes} dispute{disputes === 1 ? '' : 's'} under review</Text>
              <Icon name="arrow" size={15} color={GOLD} />
            </Pressable>
          ) : null}
        </LinearGradient>
      ) : (
        <View style={[card, { padding: 18, gap: 12, alignItems: 'center' }]}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={22} color={C.navy} /></View>
          <Txt bold style={{ textAlign: 'center' }}>Your attendance record is part of the subscription</Txt>
          <Button title="Subscribe" icon="arrow" onPress={() => navigation.navigate('Subscription')} />
        </View>
      )}

      {/* Today: the boarding question when there is one, and both trips of the day */}
      <View style={[card, { padding: 16, gap: 4 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <Text style={h2}>Today</Text>
          <Txt muted small>{todayName}</Txt>
        </View>
        {checked ? (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: alpha(C.live, 0.12), marginBottom: 4 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.live, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={22} color="#fff" strokeWidth={2.6} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt bold>{checked.already ? 'Already checked in' : "You're checked in"}</Txt>
              <Txt muted small>{checked.bus} · {time(checked.at)} · {checked.how}</Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setChecked(null)} hitSlop={10}><Icon name="x" size={18} color={C.muted} /></Pressable>
          </View>
        ) : null}
        {prompt ? (
          <View style={{ padding: 14, borderRadius: 14, backgroundColor: alpha(accentColour('gold'), 0.12), borderWidth: 1, borderColor: alpha(accentColour('gold'), 0.3), gap: 10, marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <Text style={label}>Boarding check · {tripName(prompt.direction)}</Text>
              <Badge tone="live">Bus at your stop</Badge>
            </View>
            <Text style={h2}>Are you on {busName(prompt.fleetCode)}?</Text>
            <Text style={[label, { marginTop: -4 }]}>{[prompt.stopName ?? prompt.routeName, time(prompt.boardedAt)].filter(Boolean).join(' · ')}</Text>
            <ErrorText>{error}</ErrorText>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Yes, I'm on board" icon="check" disabled={answering} onPress={() => answer('YES')} style={{ flex: 1 }} />
              <Button title="Not today" variant="ghost" disabled={answering} onPress={() => answer('NO')} />
            </View>
          </View>
        ) : null}
        <TodayRow dir="UP" rec={todayOf('UP')} first />
        <TodayRow dir="DOWN" rec={todayOf('DOWN')} />
      </View>

      {/* Check in yourself, if the bus did not ask */}
      <View style={[card, { padding: 16, gap: 12 }]}>
        <View style={{ gap: 2 }}>
          <Text style={h2}>Check in</Text>
          <Txt muted small>If the bus didn't ask you, use one of these.</Txt>
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line2 }}>
          {[['qr', 'Scan QR', 'qr'], ['code', 'Code', 'keypad'], ['gps', 'Automatic', 'locate']].map(([k, name, icon]) => {
            const sel = method === k;
            const fg = sel ? C.ink : C.muted;
            return (
              <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: sel }} onPress={() => { setMethod(k); setError(null); }}
                style={{ flex: 1, height: 42, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: sel ? (C.dark ? '#2B3A5C' : C.card) : 'transparent', ...(sel ? shadow : null) }}>
                <Icon name={icon} size={16} color={fg} />
                <Text style={{ fontSize: 13.5, ...F[600], color: fg }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{name}</Text>
              </Pressable>
            );
          })}
        </View>

        {method === 'qr' ? (
          <>
            <ScanViewport error={scanError} onRetry={() => setScanError(null)} onScan={(payload) => checkIn({ payload })} />
            <Txt muted small style={{ textAlign: 'center' }}>No camera? Use "Code" and type the 6 digits under the QR.</Txt>
          </>
        ) : null}
        {method === 'code' ? (
          <>
            <Txt muted small>Type the route and the 6-digit code shown under the QR on the driver's phone.</Txt>
            <Row>
              <TextField label="Route" value={routeCode} onChangeText={setRouteCode} style={{ flex: 1 }} autoCapitalize="characters" />
              <TextField label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} style={{ flex: 1.3 }} />
            </Row>
            <ErrorText>{prompt ? null : error}</ErrorText>
            <Button title="Check in" icon="check" onPress={typed} />
          </>
        ) : null}
        {method === 'gps' ? <AutoPanel token={token} user={user} navigation={navigation} bare /> : null}
        {message ? <Txt muted small>{message}</Txt> : null}
        {queue.length > 0 ? <Badge tone="delayed">{`${queue.length} scan${queue.length === 1 ? '' : 's'} waiting for the network`}</Badge> : null}
      </View>

      {history ? <History token={token} entitlement={entitlement} navigation={navigation} focusId={typeof history === 'number' ? history : null} onClose={() => setHistory(null)} /> : null}
    </Screen>
  );
}
