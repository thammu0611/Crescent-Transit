import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChangePasswordSheet } from '../components/ChangePassword.js';
import { ViewCard, ViewList } from '../components/adminkit.js';
import Appearance from '../components/Appearance.js';
import DayBanner from '../components/DayBanner.js';
import { FoundItem, FuelEntry, PassScanner, PreTripCheck } from '../components/DriverTools.js';
import { useT } from '../lib/offline.js';
import QRCode from 'react-native-qrcode-svg';
import Icon from '../components/Icon.js';
import { Dot, MapBox, RouteLayer } from '../components/maps';
import {
  accentColour, alpha, Badge, Button, CardTint, Collapsible, confirm, ErrorText, LivePulse, Notice, Panel, PillIconButton, Row, Screen, SearchBox, Segmented, Sheet, Text,
  TextField, Txt,
} from '../components/ui.js';
import { api, ApiError } from '../lib/api.js';
import {
  backgroundAvailable, driverGpsRunning, openBatterySettings, openLocationSettings, startDriverGps, stopDriverGps, subscribeDriverGps,
} from '../lib/driverGps.js';
import { OCCUPANCY, time } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';
import { DIRECTION_NAME, PathWalker, projectOnRoute, travelOrder } from '../lib/rules.js';
import { useServerInfo } from '../lib/serverInfo.js';
import { useSession } from '../lib/session.js';
import { C, F, R, TONE, shadow } from '../theme.js';

const MAX_BUFFER = 200;
const BUS_GPS_POLL_MS = 5000;
const ONBOARD = ['CONFIRMED', 'ON_BOARD', 'PROVISIONAL'];

/** "2 min ago" for the last time the bus tracker was heard from. */
const ago = (iso, now) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};

const card = { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, ...shadow };
// A coloured card's border and clipping (the wash and edge come from CardTint / RowTint).
const tinted = (colour) => ({ borderColor: alpha(colour, 0.25), overflow: 'hidden' });
const metaLabel = { fontSize: 13, lineHeight: 18, ...F[500], color: C.muted };
const dist = (a, b) => {
  if (!a || !b) return null;
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
};
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  // A trip left running for a day or more (it is closed by the server after a few hours).
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

async function currentWhere() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return {};
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return {};
  }
}

/** "Report issue": breakdown, delay or emergency, sent to the office and the route's students. */
function ReportIssue({ token, onClose, onSent }) {
  const t = useT();
  const [kind, setKind] = useState('DELAY');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const where = await currentWhere();
      await api('/api/driver/incidents', { token, body: { kind, message: message || undefined, ...where } });
      Vibration.vibrate([0, 80, 40, 80]);
      onSent(`${kind === 'DELAY' ? 'Delay' : kind === 'BREAKDOWN' ? 'Breakdown' : 'Emergency'} reported to the transport office and to students on this route.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Report issue" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'DELAY', label: t('Delay') }, { value: 'BREAKDOWN', label: t('Breakdown') }, { value: 'EMERGENCY', label: t('Emergency') }]} />
        <TextField label="What happened? (optional)" value={message} onChangeText={setMessage} placeholder={t('e.g. Flat tyre near Guindy')} />
        <ErrorText>{error}</ErrorText>
        <Button title={t('Send now')} variant={kind === 'EMERGENCY' ? 'danger' : 'primary'} busy={busy} onPress={send} />
      </View>
    </Sheet>
  );
}

/** SOS: press and hold, then a 5-second countdown that sends unless cancelled. */
function SosConfirm({ token, bus, onClose, onSent }) {
  const [left, setLeft] = useState(5);
  const [error, setError] = useState(null);
  const sent = useRef(false);
  const send = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    try {
      const where = await currentWhere();
      await api('/api/driver/incidents', { token, body: { kind: 'SOS', ...where } });
      Vibration.vibrate([0, 200, 100, 200, 100, 200]);
      onSent('SOS sent. The transport office and campus security have your location.');
    } catch (err) {
      sent.current = false;
      setError(err.message);
    }
  }, [token, onSent]);
  useEffect(() => {
    if (error) return undefined;
    if (left <= 0) { send(); return undefined; }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, send, error]);
  return (
    <Sheet onClose={onClose}>
      <View style={{ gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: C.danger50, alignItems: 'center', justifyContent: 'center' }}><Icon name="siren" size={28} color={C.danger} /></View>
        <Text style={{ fontSize: 22, lineHeight: 28, ...F.displayBold, color: C.ink }}>Send SOS to campus security?</Text>
        <Txt muted>The transport office and campus security get an alert with {bus}'s live location. Use this only in an emergency.</Txt>
        {!error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: C.raised }}>
            <Icon name="clock" size={18} color={C.muted} />
            <Txt style={{ flex: 1 }}>{left > 0 ? `Sends automatically in ${left} s unless you cancel` : 'Sending…'}</Txt>
          </View>
        ) : <ErrorText>{error}</ErrorText>}
        <Button title="Send SOS now" variant="danger" onPress={send} style={{ minHeight: 56 }} />
        <Button title="Cancel" variant="ghost" onPress={onClose} />
        <Pressable accessibilityRole="button" onPress={() => Linking.openURL('tel:100').catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}>
          <Icon name="phone" size={18} color={C.link} />
          <Text style={{ color: C.link, fontSize: 15, ...F[600] }}>Call police · 100</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** The rotating in-bus code (six digits and a QR) for students without GPS (doc 9.7). */
function BoardingCode({ token }) {
  const t = useT();
  const [code, setCode] = useState(null);
  const [big, setBig] = useState(false);
  const now = useNow(1000);
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const c = await api('/api/driver/boarding-code', { token });
        setCode({ ...c, until: Date.now() + c.expiresInS * 1000, span: Math.max(c.expiresInS, 60) });
        timer = setTimeout(load, Math.max(2, c.expiresInS) * 1000);
      } catch {
        timer = setTimeout(load, 10000);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, [token]);
  const left = code ? Math.max(0, Math.round((code.until - now) / 1000)) : 0;
  const digits = code ? String(code.code) : '';
  return (
    <View style={[card, tinted(accentColour('gold')), { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
      <CardTint color={accentColour('gold')} radius={R.lg} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={metaLabel}>Boarding code · show to students</Text>
        <Text style={{ fontSize: 34, lineHeight: 40, ...F.displayBold, letterSpacing: 4, color: C.ink, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
          {code ? `${digits.slice(0, 3)} ${digits.slice(3)}` : '··· ···'}
        </Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: C.raised, overflow: 'hidden' }}>
          <View style={{ height: 4, borderRadius: 2, width: `${code ? (left / code.span) * 100 : 0}%`, backgroundColor: C.navy }} />
        </View>
        <Text style={metaLabel}>{code ? `Changes in ${left} s` : t('Loading code…')}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Show the QR code large" onPress={() => setBig(true)} disabled={!code}
        style={{ width: 76, height: 76, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}>
        {code ? <QRCode value={code.qrPayload} size={58} /> : <Icon name="qr" size={34} color="#0F172A" />}
      </Pressable>
      {big && code ? (
        <Sheet title="Boarding code" onClose={() => setBig(false)}>
          <View style={{ alignItems: 'center', gap: 14, paddingBottom: 8 }}>
            <View style={{ padding: 14, backgroundColor: '#fff', borderRadius: 18 }}><QRCode value={code.qrPayload} size={240} /></View>
            <Text style={{ fontSize: 34, ...F.displayBold, letterSpacing: 4, color: C.ink }}>{digits.slice(0, 3)} {digits.slice(3)}</Text>
            <Txt muted>{t('Students without GPS scan this, or type')} the code. Changes in {left} s.</Txt>
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

/** Students recorded on board, and marking one by hand (doc 4.2). */
function BoardedList({ token, tripId }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState(null);
  const load = useCallback(() => api(`/api/trips/${tripId}/attendance`, { token }).then(setData).catch((e) => setError(e.message)), [token, tripId]);
  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);
  const mark = async () => {
    if (!username.trim()) return;
    setError(null);
    try {
      await api('/api/attendance/manual', { token, body: { tripId, username: username.trim() } });
      setUsername('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const onBoard = data?.records.filter((r) => ['CONFIRMED', 'ON_BOARD', 'PROVISIONAL'].includes(r.status) && !r.alighted_at) ?? [];
  return (
    <ViewCard
      icon="users"
      title="On board"
      summary={!data ? t('Loading…') : onBoard.length ? `${onBoard.length} student${onBoard.length === 1 ? '' : 's'} on board · mark one by hand` : 'Nobody recorded yet · mark one by hand'}
      badge={<Badge tone={data && data.capacity && data.onBoard > data.capacity ? 'danger' : 'live'}>{data?.onBoard ?? 0} / {data?.capacity ?? '—'} seats</Badge>}
    >
      {onBoard.length === 0 ? <Txt muted>{t('Nobody recorded yet.')}</Txt> : onBoard.map((r) => (
        <View key={r.attendance_id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
          <Txt bold>{r.full_name} <Txt muted small>{r.register_no ?? r.username}</Txt></Txt>
          <Txt muted small>{r.method} · {time(r.boarded_at)}{r.boarding_stop ? ` · ${r.boarding_stop}` : ''}</Txt>
        </View>
      ))}
      <Row>
        <TextField value={username} onChangeText={setUsername} placeholder="Student username (no phone / no GPS)" autoCapitalize="none" style={{ flex: 1 }} accessibilityLabel="Student username" onSubmitEditing={mark} />
        <Button title={t('Mark')} variant="ghost" onPress={mark} />
      </Row>
      <ErrorText>{error}</ErrorText>
    </ViewCard>
  );
}

/** Every student whose home route is this bus's route, by stop, with their details and today's boarding. */
function StudentList({ token, tripId }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null); // student id whose details are shown
  const [marking, setMarking] = useState(null);
  const load = useCallback(() => api('/api/driver/students', { token }).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), [token]);
  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load, tripId]);
  const mark = async (st) => {
    setMarking(st.id);
    setError(null);
    try {
      await api('/api/attendance/manual', { token, body: { tripId, username: st.username } });
      Vibration.vibrate(30);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarking(null);
    }
  };
  const students = data?.students ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? students.filter((st) => [st.fullName, st.registerNo, st.username, st.department, st.stopName, st.phone].some((v) => v && String(v).toLowerCase().includes(q))) : students;
  const boarded = students.filter((st) => st.attendance && ONBOARD.includes(st.attendance.status) && !st.attendance.alightedAt).length;
  // Group by stop, in route order (the server sorts by stop).
  const groups = [];
  for (const st of shown) {
    const key = st.stopSeq ?? 'none';
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, name: st.stopName ?? t('No stop chosen'), time: st.stopTime, rows: [] }));
    g.rows.push(st);
  }
  return (
    <ViewCard
      icon="users"
      title="Students on this bus"
      summary={!data ? t('Loading…') : !students.length ? t('No students on this route yet') : `${students.length} students · ${groups.length} stop${groups.length === 1 ? '' : 's'}`}
      badge={<Badge tone={tripId && boarded ? 'live' : 'info'}>{tripId ? `${boarded}/${students.length}` : `${students.length}`}</Badge>}
    >
      {!data && !error ? <Txt muted>{t('Loading students…')}</Txt> : null}
      {data && students.length === 0 ? <Txt muted>{t('No students have this route as their home route yet.')}</Txt> : null}
      {students.length > 6 ? <SearchBox value={query} onChange={setQuery} placeholder={t('Search name, register no, stop')} /> : null}
      {groups.map((g) => (
        <View key={g.key} style={{ gap: 2 }}>
          <Row style={{ marginTop: 6 }}>
            <Icon name="pin" size={14} color={C.navy} />
            <Txt bold style={{ flex: 1 }} numberOfLines={1}>{g.name}</Txt>
            <Txt muted small style={{ flexShrink: 0, paddingRight: 2 }}>{g.time ? `${g.time} · ` : ''}{g.rows.length} {g.rows.length === 1 ? 'student' : 'students'}</Txt>
          </Row>
          {g.rows.map((st) => {
            const a = st.attendance;
            const onBoard = a && ONBOARD.includes(a.status) && !a.alightedAt;
            const expanded = open === st.id;
            return (
              <Pressable key={st.id} onPress={() => setOpen(expanded ? null : st.id)} style={{ paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line2 }} accessibilityRole="button" accessibilityState={{ expanded }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt bold>{st.fullName}</Txt>
                    <Txt muted small>{[st.registerNo ?? st.username, st.department].filter(Boolean).join(' · ')}</Txt>
                  </View>
                  {onBoard ? <Badge tone="live">On board</Badge> : a?.alightedAt ? <Badge tone="offline">{t('Got off')}</Badge> : tripId ? <Badge tone="delayed">{t('Not boarded')}</Badge> : null}
                </Row>
                {expanded && (
                  <View style={{ gap: 6, marginTop: 8 }}>
                    <Row wrap>
                      <Badge tone={st.passActive ? 'live' : 'danger'}>{st.passActive ? t('Bus pass active') : t('No active pass')}</Badge>
                      {a ? <Badge tone="info">{a.method}{a.boardedAt ? ` · ${time(a.boardedAt)}` : ''}</Badge> : null}
                    </Row>
                    <Txt small>Username: {st.username}</Txt>
                    {st.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${st.phone}`)} accessibilityRole="link">
                        <Row><Icon name="phone" size={14} color={C.indigo} /><Txt small style={{ color: C.indigo }}>{st.phone}</Txt></Row>
                      </Pressable>
                    ) : <Txt muted small>{t('No phone number on file')}</Txt>}
                    {st.email ? <Row><Icon name="mail" size={14} color={C.faint} /><Txt small muted>{st.email}</Txt></Row> : null}
                    {tripId && !onBoard ? <Button small variant="ghost" title={t('Mark on board')} icon="check" busy={marking === st.id} onPress={() => mark(st)} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </ViewCard>
  );
}

export default function DriverApp() {
  const { token, user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const now = useNow(1000);
  const [issue, setIssue] = useState(false);
  const [sos, setSos] = useState(false);
  const [notice, setNotice] = useState(null);
  const [password, setPassword] = useState(false);
  const [seats, setSeats] = useState(null); // { onBoard, capacity }
  // The simulated bus, the bad-fix buttons and the transmission log are demo tools.
  const demo = Boolean(useServerInfo()?.demoMode);
  const [route, setRoute] = useState(null);
  const [trip, setTrip] = useState(null);
  // The bus's own GPS tracker is the main source; the phone's GPS is an optional backup.
  const [source, setSource] = useState('tracker'); // 'tracker' | 'gps' | 'simulate'
  const [busGps, setBusGps] = useState(null); // { tracker, reporting, position } from the server
  const [intervalS, setIntervalS] = useState(10);
  const t = useT();
  // The run the next trip will be: the driver's choice, else what the time of day suggests.
  const [suggested, setSuggested] = useState(null);
  const [picked, setPicked] = useState(null);
  const direction = picked ?? suggested ?? 'UP';
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  // 'background': positions keep flowing with the phone locked. 'foreground': only with this screen open.
  const [gpsMode, setGpsMode] = useState(null);
  const [gpsNeed, setGpsNeed] = useState(null); // what is stopping background sharing
  const [log, setLog] = useState([]);
  const [counts, setCounts] = useState({ sent: 0, accepted: 0, rejected: 0 });
  const [buffered, setBuffered] = useState(0);
  const [lastOkAt, setLastOkAt] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [error, setError] = useState(null);
  const [standby, setStandby] = useState(false); // the bus's GPS tracker is reporting instead

  const bufferRef = useRef([]); // fixes waiting for the network to come back
  const sendingRef = useRef(false); // a slow request must not overlap the next tick
  const latestGpsRef = useRef(null);
  const lastSentAtRef = useRef(null);
  const walkerRef = useRef(null);
  const distanceRef = useRef(0);

  const addLog = (entry) => setLog((prev) => [{ ...entry, at: new Date() }, ...prev].slice(0, 12));

  // Load the driver's route and any trip that is still running.
  useEffect(() => {
    if (!token || !user?.routeCode) return;
    api(`/api/routes/${encodeURIComponent(user.routeCode)}`).then(setRoute).catch((err) => setError(err.message));
    api('/api/driver/trip', { token })
      .then(({ trip: t, suggestedDirection }) => { setTrip(t); setOccupancy(t?.occupancy ?? null); setSuggested(suggestedDirection); })
      .catch((err) => (err instanceof ApiError && err.status === 401 ? signOut() : setError(err.message)));
  }, [token, user?.routeCode, signOut]);

  // How many are on board, for the trip card.
  useEffect(() => {
    if (!trip) { setSeats(null); return undefined; }
    const load = () => api(`/api/trips/${trip.id}/attendance`, { token }).then((d) => setSeats({ onBoard: d.onBoard, capacity: d.capacity })).catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [trip?.id, token]);

  // A trip can end without this phone: at the geofence, or by the transport office.
  useEffect(() => {
    if (!trip) return undefined;
    const id = setInterval(() => {
      api('/api/driver/trip', { token }).then(({ trip: t }) => { if (!t) setTrip(null); }).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [trip?.id, token]);

  // The simulated bus walks the stops in the order this run reaches them.
  useEffect(() => {
    if (route) walkerRef.current = new PathWalker(travelOrder(route.stops, trip?.direction).map((s) => ({ lat: s.lat, lng: s.lng })));
  }, [route, trip?.direction]);

  // Bus GPS tracker: where the server last heard from the unit fitted in the bus.
  useEffect(() => {
    if (!token || !user?.busId) return undefined;
    let timer;
    let cancelled = false;
    const load = async () => {
      try {
        const g = await api('/api/driver/bus-gps', { token });
        if (!cancelled) setBusGps(g);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return signOut();
      }
      if (!cancelled) timer = setTimeout(load, BUS_GPS_POLL_MS);
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token, user?.busId, signOut]);

  // The bus tracker starts a trip by itself when the bus moves off: pick it up here.
  const trackerTripId = busGps?.position?.tripId ?? null;
  useEffect(() => {
    if (trip || !trackerTripId) return;
    api('/api/driver/trip', { token })
      .then(({ trip: t }) => { if (t) { setTrip(t); setOccupancy(t.occupancy ?? null); } })
      .catch(() => {});
  }, [trip, trackerTripId, token]);

  // Phone-only bus, no trip yet: send where the phone is every 10 s while this
  // screen is open. When the bus leaves the depot in trip hours the server starts
  // the trip by itself (server/autostart.js), so a forgotten Start costs nothing.
  const [autoWait, setAutoWait] = useState(null);
  const phoneOnly = Boolean(busGps && !busGps.tracker);
  useEffect(() => {
    if (trip || !phoneOnly || !token) { setAutoWait(null); return undefined; }
    let sub = null;
    let timer = null;
    let cancelled = false;
    const pending = [];
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 }, (p) => {
        pending.push({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          speedKmh: p.coords.speed == null || p.coords.speed < 0 ? undefined : Math.round(p.coords.speed * 36) / 10,
          recordedAt: new Date(p.timestamp).toISOString(),
        });
        if (pending.length > 24) pending.splice(0, pending.length - 24);
      });
      if (cancelled) { sub.remove(); return; }
      timer = setInterval(async () => {
        if (!pending.length) return;
        const fixes = pending.splice(0);
        try {
          const r = await api('/api/driver/standby', { token, body: { fixes } });
          if (r.trip) {
            distanceRef.current = 0;
            setCounts({ sent: 0, accepted: 0, rejected: 0 });
            setSource('gps');
            setTrip(r.trip);
            setOccupancy(r.trip.occupancy ?? null);
            if (r.started) Vibration.vibrate([0, 200, 80, 200]);
          } else setAutoWait(r.waiting ?? null);
        } catch {
          // No signal: the next batch tries again.
        }
      }, 10000);
    })();
    return () => { cancelled = true; sub?.remove(); clearInterval(timer); };
  }, [trip, phoneOnly, token]);

  // No tracker fitted to this bus: the phone is the only source, so it is the default.
  const choseSource = useRef(false);
  const pickSource = (value) => {
    choseSource.current = true;
    setSource(value);
  };
  useEffect(() => {
    if (busGps && !busGps.tracker && source === 'tracker' && !choseSource.current) setSource('gps');
  }, [busGps, source]);
  // The app was reopened while a trip's GPS kept running behind it.
  useEffect(() => {
    driverGpsRunning().then((running) => { if (running) setSource('gps'); });
  }, []);

  // Keep the screen on while the phone is sending and the driver has the app open.
  const sendingFromPhone = Boolean(trip) && source !== 'tracker';
  useEffect(() => {
    if (!sendingFromPhone) return undefined;
    activateKeepAwakeAsync('driver-trip').catch(() => {});
    return () => { deactivateKeepAwake('driver-trip').catch(() => {}); };
  }, [sendingFromPhone]);

  // What the background task reports while the screen is open.
  useEffect(() => subscribeDriverGps((event) => {
    if (event.type === 'fix') setPosition(event.fix);
    if (event.type === 'offline') setBuffered(event.buffered);
    if (event.type === 'ended' && event.status === 409) setTrip(null);
    if (event.type === 'ended' && event.status === 401) signOut();
    if (event.type === 'result') {
      const { result, fixes, buffered: left, failed } = event;
      setBuffered(left);
      if (failed) return;
      setStandby(Boolean(result.standby));
      if (result.standby) return;
      setCounts((c) => ({ sent: c.sent + fixes.length, accepted: c.accepted + (result.accepted ?? 0), rejected: c.rejected + (result.rejected ?? 0) }));
      if (result.accepted) setLastOkAt(new Date());
      (result.results ?? []).forEach((r, i) => addLog({ fix: fixes[i], ok: r.accepted, text: r.accepted ? 'Accepted' : `${r.reason}: ${r.detail}` }));
    }
  }), [signOut]);

  // Phone GPS: in the background when the phone allows it, or else while this
  // screen is open, keeping the most recent fix for the send loop.
  useEffect(() => {
    if (!trip || source !== 'gps') return undefined;
    let sub = null;
    let cancelled = false;
    let background = false;
    (async () => {
      setGpsError(null);
      setGpsNeed(null);
      const started = await startDriverGps({ token, intervalS }).catch((err) => ({ ok: false, reason: 'error', message: err.message }));
      if (cancelled) {
        if (started.ok) stopDriverGps();
        return undefined;
      }
      if (started.reason === 'denied') return setGpsError(t('Location permission is needed to share the bus position. Allow it in the phone settings.'));
      if (started.ok) {
        background = true;
        setGpsMode('background');
        return undefined;
      }
      setGpsMode('foreground');
      setGpsNeed(started.reason === 'background' ? 'allow' : started.reason === 'unavailable' ? 'build' : 'error');
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
          (p) => {
            latestGpsRef.current = {
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracyM: p.coords.accuracy == null ? undefined : Math.round(p.coords.accuracy),
              speedKmh: p.coords.speed == null || p.coords.speed < 0 ? undefined : Math.round(p.coords.speed * 3.6 * 10) / 10,
              heading: p.coords.heading == null || p.coords.heading < 0 || Number.isNaN(p.coords.heading) ? undefined : Math.round(p.coords.heading),
              recordedAt: new Date(p.timestamp).toISOString(),
            };
            setPosition(latestGpsRef.current);
          },
          (reason) => setGpsError(`GPS error: ${reason}`),
        );
        if (cancelled) sub.remove();
      } catch (err) {
        setGpsError(`GPS error: ${err.message}`);
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      if (background) stopDriverGps();
      setGpsMode(null);
    };
    // Only the trip's id matters: occupancy changes must not restart the GPS.
  }, [trip?.id, source, intervalS, token]);

  const nextFix = useCallback(() => {
    if (source === 'gps') {
      const fix = latestGpsRef.current;
      // Nothing new from the GPS since the last send: skip instead of repeating.
      if (!fix || fix.recordedAt === lastSentAtRef.current) return null;
      return fix;
    }
    const walker = walkerRef.current;
    if (!walker) return null;
    const speed = 28 + Math.random() * 12;
    distanceRef.current = Math.min(walker.length, distanceRef.current + (speed / 3.6) * intervalS);
    const p = walker.at(distanceRef.current);
    return { lat: p.lat, lng: p.lng, speedKmh: p.done ? 0 : Math.round(speed), heading: Math.round(p.heading), accuracyM: 8, recordedAt: new Date().toISOString() };
  }, [source, intervalS]);

  const send = useCallback(async (fixes, label) => {
    try {
      const result = await api('/api/driver/locations', { token, body: { fixes } });
      setStandby(Boolean(result.standby));
      if (result.standby) return true; // not an error: the tracker covers this bus
      setCounts((c) => ({ sent: c.sent + fixes.length, accepted: c.accepted + result.accepted, rejected: c.rejected + result.rejected }));
      if (result.accepted) setLastOkAt(new Date());
      result.results.forEach((r, i) =>
        addLog({ fix: fixes[i], ok: r.accepted, text: r.accepted ? (r.reanchored ? 'Accepted (re-anchored)' : 'Accepted') : `${r.reason}: ${r.detail}`, label }),
      );
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) signOut();
        if (err.status === 409) setTrip(null);
        addLog({ fix: fixes.at(-1), ok: false, text: err.message, label });
        return true; // the server answered; do not buffer
      }
      return false; // network failure
    }
  }, [token, signOut]);

  // Send loop: one fix per interval, plus anything buffered while offline.
  // Not needed while the bus GPS tracker is the source: it reports by itself.
  useEffect(() => {
    if (!trip || source === 'tracker' || gpsMode === 'background') return undefined;
    const tick = async () => {
      const fix = nextFix();
      if (fix) {
        setPosition(fix);
        lastSentAtRef.current = fix.recordedAt;
        bufferRef.current = [...bufferRef.current, fix].slice(-MAX_BUFFER);
      }
      if (bufferRef.current.length === 0 || sendingRef.current) return;
      sendingRef.current = true;
      const batch = bufferRef.current;
      try {
        const delivered = await send(batch, batch.length > 1 ? `batch of ${batch.length}` : null);
        if (delivered) bufferRef.current = bufferRef.current.slice(batch.length);
      } finally {
        sendingRef.current = false;
        setBuffered(bufferRef.current.length);
      }
    };
    tick();
    const id = setInterval(tick, intervalS * 1000);
    return () => clearInterval(id);
  }, [trip, source, gpsMode, intervalS, nextFix, send]);

  const startTrip = async () => {
    setError(null);
    if (source === 'gps') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setError(t('Location permission is needed before a trip can start.'));
    }
    try {
      const { trip: t } = await api('/api/driver/trips', { token, body: { direction } });
      distanceRef.current = 0;
      setCounts({ sent: 0, accepted: 0, rejected: 0 });
      setLog([]);
      setTrip(t);
      setOccupancy(t.occupancy ?? null);
      Vibration.vibrate(120);
    } catch (err) {
      setError(err.message);
    }
  };

  const endTrip = async () => {
    if (!(await confirm('End this trip?', 'Location sharing stops and students see the bus as finished.', 'End trip'))) return;
    try {
      await api(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
    } catch (err) {
      setError(err.message);
    }
    bufferRef.current = [];
    setBuffered(0);
    setStandby(false);
    setTrip(null); // ends the GPS too: the last positions go out as it stops
    setPicked(null);
    api('/api/driver/trip', { token }).then((r) => setSuggested(r.suggestedDirection)).catch(() => {});
    Vibration.vibrate([0, 120, 60, 120]);
  };

  const tapOccupancy = async (o) => {
    try {
      await api('/api/driver/occupancy', { token, body: { occupancy: o } });
      setOccupancy(o);
      Vibration.vibrate(30);
    } catch (err) {
      setError(err.message);
    }
  };

  // Demo aid: send a deliberately bad fix and watch the server reject it.
  const sendBadFix = (kind) => {
    const base = position ?? route?.stops[0];
    if (!base) return;
    const recordedAt = new Date().toISOString();
    const fixes = {
      zero: { lat: 0, lng: 0, recordedAt },
      jump: { lat: base.lat + 0.08, lng: base.lng + 0.08, recordedAt },
      accuracy: { lat: base.lat, lng: base.lng, accuracyM: 900, recordedAt },
      future: { lat: base.lat, lng: base.lng, recordedAt: new Date(Date.now() + 10 * 60000).toISOString() },
    }[kind];
    send([fixes], 'test');
  };

  if (!user?.busId) {
    return (
      <Screen>
        <Panel title={t('No bus assigned')} icon="bus">
          <Txt muted>{t('Ask the transport office to assign a bus to your account.')}</Txt>
          <Button title="Sign out" variant="ghost" onPress={signOut} />
        </Panel>
      </Screen>
    );
  }

  const tracker = busGps?.tracker ?? null;
  const trackerReporting = Boolean(busGps?.reporting);
  const useTracker = source === 'tracker';
  const phoneTransmitting = lastOkAt && Date.now() - lastOkAt.getTime() < intervalS * 2000;
  const transmitting = useTracker ? trackerReporting : phoneTransmitting;
  // Show the bus tracker's position when it is the source (or when the phone stands by for it).
  const shownPosition = (useTracker || standby) && busGps?.position ? busGps.position : useTracker ? null : position;
  // Where the bus is along its route: the next stop ahead and how many are left.
  const ordered = route ? travelOrder(route.stops, trip?.direction ?? direction) : [];
  const proj = route && shownPosition ? projectOnRoute(ordered, shownPosition) : null;
  const nextIndex = proj ? Math.min(ordered.length - 1, proj.segment + 1) : 0;
  const nextStop = proj ? ordered[nextIndex] : null;
  const stopsLeft = route ? ordered.length - 1 - nextIndex : 0;
  let statusText;
  if (!trip) statusText = useTracker ? t('The bus GPS tracker shares the location while a trip is running.') : t('Location is shared only while a trip is running.');
  else if (useTracker) {
    if (trackerReporting) statusText = t('Bus GPS tracker is sharing live location');
    else if (!tracker) statusText = t('No GPS tracker is fitted on this bus. Switch on phone GPS below.');
    else statusText = `Bus GPS tracker is not reporting (last heard ${ago(tracker.lastSeenAt, now)}). Switch on phone GPS below.`;
  } else if (standby) statusText = t('The bus GPS tracker is sharing the location. This phone stands by and takes over if the tracker stops.');
  else if (buffered > 0) statusText = `No network · ${buffered} fix(es) saved, will send when back`;
  else statusText = transmitting ? t('Sharing live location from this phone') : t('Waiting for phone GPS…');

  // The GPS line in the trip card: is the location getting out?
  const fixAge = useTracker ? busGps?.position?.recordedAt : lastOkAt?.toISOString();
  let gps;
  if (useTracker) {
    gps = trackerReporting
      ? { tone: 'live', bold: 'Bus GPS live', rest: `sent ${ago(fixAge, now)}` }
      : { tone: 'delayed', bold: tracker ? 'Bus GPS not reporting' : 'No bus GPS fitted', rest: tracker ? `last heard ${ago(tracker.lastSeenAt, now)}` : 'use phone GPS' };
  } else if (!trip) {
    gps = { tone: 'offline', bold: 'Phone GPS', rest: 'starts with the trip' };
  } else if (gpsError) {
    gps = { tone: 'danger', bold: 'Location is off', rest: 'allow it in phone settings' };
  } else if (standby) {
    gps = { tone: 'live', bold: 'Bus GPS live', rest: 'this phone stands by' };
  } else if (buffered > 0) {
    gps = { tone: 'delayed', bold: 'No network', rest: `${buffered} fix(es) saved` };
  } else if (shownPosition && transmitting) {
    gps = { tone: 'live', bold: 'GPS live', rest: `${shownPosition.accuracyM != null ? `±${shownPosition.accuracyM} m · ` : ''}sent ${ago(fixAge, now)}` };
  } else {
    gps = { tone: 'searching', bold: 'Searching for GPS…', rest: 'stand near a window' };
  }
  const gpsColor = { live: C.live, delayed: C.delayed, danger: C.danger, offline: C.muted, searching: C.delayed }[gps.tone];
  const runDir = trip?.direction ?? direction;
  const away = nextStop ? dist(shownPosition, nextStop) : null;
  const leaves = runDir === 'DOWN' ? route?.evening_departure : route?.departure_time;
  const bus = String(user.fleetCode ?? '').replace('BSACIST-', 'Bus ');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen safeTop contentStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt muted small numberOfLines={1}>{user.name} · {user.fleetCode}</Txt>
            <Text accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34, ...F.displayBold, color: C.ink }}>My trip</Text>
          </View>
          <PillIconButton icon="lock" label="Change password" onPress={() => setPassword(true)} />
          <PillIconButton icon="logout" label="Sign out" onPress={async () => (await confirm('Sign out?', 'You can sign in again any time.', 'Sign out')) && signOut()} />
        </View>

        {/* Trip status */}
        <View style={[card, tinted(trip ? C.live : accentColour('navy')), { padding: 18, gap: 14 }]}>
          <CardTint color={trip ? C.live : accentColour('navy')} radius={R.lg} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ minWidth: 48, height: 34, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.navyFill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, ...F.displayBold }}>{user.routeCode}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 17, lineHeight: 22, ...F[700], color: C.ink }} numberOfLines={1}>{user.routeName}</Text>
              <Txt muted small numberOfLines={2}>{runDir === 'DOWN' ? 'From campus' : 'To campus'} · {trip ? (runDir === 'DOWN' ? 'outbound' : 'inbound') : leaves ?? '—'}</Txt>
            </View>
            {trip ? <Badge tone="live">{t('On trip')}</Badge> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 28, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised }}>
                <Icon name="pause" size={12} color={C.muted} />
                <Text style={{ fontSize: 12.5, ...F[600], color: C.ink }}>Not started</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: C.raised }}>
            {gps.tone === 'live' ? <LivePulse size={10} /> : <Icon name={gps.tone === 'searching' ? 'refresh' : 'signal'} size={18} color={gpsColor} />}
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: C.muted }}>
              <Text style={{ ...F[600], color: C.ink }}>{gps.bold}</Text> · {gps.rest}
            </Text>
          </View>
          {trip ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={metaLabel}>Trip time</Text>
                <Text style={{ fontSize: 22, lineHeight: 28, ...F.displayBold, color: C.ink, fontVariant: ['tabular-nums'] }}>{clock(now - new Date(trip.started_at).getTime())}</Text>
              </View>
              <View style={{ flex: 1.1 }}>
                <Text style={metaLabel}>{t('Next stop')}{away != null ? ` · ${away >= 1000 ? `${(away / 1000).toFixed(1)} km` : `${Math.round(away / 10) * 10} m`}` : ''}</Text>
                <Text style={{ fontSize: 15, lineHeight: 20, ...F[700], color: C.ink }} numberOfLines={2}>{nextStop?.name ?? '—'}</Text>
              </View>
              <View style={{ flex: 0.9 }}>
                <Text style={metaLabel}>On board</Text>
                <Text style={{ fontSize: 22, lineHeight: 28, ...F.displayBold, color: seats && seats.capacity && seats.onBoard > seats.capacity ? C.danger : C.ink }}>
                  {seats?.onBoard ?? '—'}<Text style={{ fontSize: 14, ...F[500], color: C.muted }}> / {seats?.capacity ?? route?.capacity ?? '—'}</Text>
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Txt muted>{leaves ? `${runDir === 'DOWN' ? 'Leaves campus' : `Leaves ${ordered[0]?.name ?? 'the first stop'}`} at ${leaves}. ` : ''}Starting the trip shares your location with students on Route {user.routeCode}.</Txt>
              <Segmented value={direction} onChange={setPicked} options={[{ value: 'UP', label: DIRECTION_NAME.UP }, { value: 'DOWN', label: DIRECTION_NAME.DOWN }]} />
              <ErrorText>{error}</ErrorText>
              <Button title="Start trip" icon="play" onPress={startTrip} disabled={!route} style={{ minHeight: 64 }} />
              <Txt muted small style={{ textAlign: 'center' }}>{gps.tone === 'live' || useTracker ? 'Location is ready.' : 'You can start now. Location will connect in a moment.'}</Txt>
              {phoneOnly ? <Txt muted small style={{ textAlign: 'center' }}>{t('Forgot to press Start? The trip starts by itself when the bus leaves the depot.')}{autoWait ? ` (${t(autoWait)})` : ''}</Txt> : null}
            </>
          )}
          {trip?.started_by === 'tracker' ? <Txt muted small>{t('This trip was started automatically by the bus GPS tracker.')}</Txt> : null}
          {trip?.started_by === 'auto' ? <Txt muted small>{t('This trip started by itself when the bus left the depot.')}</Txt> : null}
        </View>

        {trip ? <BoardingCode token={token} /> : null}

        {trip ? (
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 15, ...F[600], color: C.ink, paddingHorizontal: 2 }}>Crowd level after this stop</Text>
            <Row>
              {Object.entries(OCCUPANCY).map(([k, o]) => {
                const on = occupancy === k;
                return (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={k} onPress={() => tapOccupancy(k)} style={({ pressed }) => ({ flex: 1, minHeight: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: on ? 2 : 1, borderColor: on ? TONE[o.tone].fg : alpha(TONE[o.tone].fg, 0.25), backgroundColor: on ? TONE[o.tone].bg : C.card, overflow: 'hidden', opacity: pressed ? 0.85 : 1 })}>
                    {on ? null : <CardTint color={TONE[o.tone].fg} radius={16} />}
                    <Icon name={k === 'FULL' ? 'alert' : 'users'} size={20} color={TONE[o.tone].fg} />
                    <Text style={{ ...F[700], color: TONE[o.tone].fg, fontSize: 14 }}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </Row>
          </View>
        ) : null}

        {trip ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Report issue" icon="alert" variant="ghost" onPress={() => { setNotice(null); setIssue(true); }} style={{ flex: 1, minHeight: 56 }} />
            <Pressable accessibilityRole="button" onPress={endTrip} style={({ pressed }) => [{ flex: 1, minHeight: 56, borderRadius: R.md, borderWidth: 1, borderColor: C.dark ? 'rgba(248,113,113,0.5)' : 'rgba(220,38,38,0.4)', backgroundColor: C.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, pressed && { opacity: 0.85 }]}>
              <Icon name="stop" size={16} color={C.danger} />
              <Text style={{ color: C.danger, fontSize: 16, ...F[600] }}>End trip</Text>
            </Pressable>
          </View>
        ) : null}
        {trip ? <ErrorText>{error}</ErrorText> : null}
        <Notice>{notice}</Notice>

        <DayBanner />

        {/* The driver's tools, grouped: the bus, the riders, and the rest. */}
        <ViewList label="Bus">
        <ViewCard
          icon="signal"
          title={t('Location source')}
          summary={statusText}
          badge={!busGps ? <Badge tone="offline">Checking…</Badge> : useTracker ? (trackerReporting ? <Badge tone="live">{t('Bus GPS')}</Badge> : <Badge tone="delayed">{t('Bus GPS')}</Badge>) : <Badge tone="info">{t('Phone')}</Badge>}
        >
          <Row>
            <Icon name="signal" size={16} color={C.navy} />
            <Txt bold style={{ flex: 1 }}>{t('Bus GPS tracker')}</Txt>
            {!busGps ? <Badge tone="offline">Checking…</Badge>
              : !tracker ? <Badge tone="danger">{t('Not fitted')}</Badge>
                : !tracker.active ? <Badge tone="danger">Disabled</Badge>
                  : trackerReporting ? <Badge tone="live">{t('Reporting')}</Badge>
                    : tracker.online ? <Badge tone="delayed">{t('Online, no fix')}</Badge>
                      : <Badge tone="delayed">Offline</Badge>}
          </Row>
          {tracker ? <Txt muted small>{tracker.label ?? tracker.uniqueId} · last heard {ago(tracker.lastSeenAt, now)}</Txt>
            : busGps ? <Txt muted small>{t('Ask the transport office to fit and register a GPS tracker for this bus. Until then use phone GPS.')}</Txt> : null}
          <Segmented value={source} onChange={pickSource} options={[{ value: 'tracker', label: t('Bus GPS') }, { value: 'gps', label: t('Phone') }, ...(demo ? [{ value: 'simulate', label: 'Simulate' }] : [])]} />
          {useTracker ? (
            <>
              <Txt muted small>The bus GPS tracker sends the location by itself; this phone does not need GPS. Phone GPS is an optional backup.</Txt>
              {trip && !trackerReporting ? <Button small variant="ghost" icon="phone" title={t('Use phone GPS as backup')} onPress={() => pickSource('gps')} /> : null}
            </>
          ) : (
            <>
              <Txt bold>{t('Send every')}</Txt>
              <Segmented value={intervalS} onChange={setIntervalS} options={[5, 10, 15].map((sec) => ({ value: sec, label: `${sec} s` }))} />
              {source !== 'gps' ? <Txt muted small>{t('Demo: a simulated bus drives the route.')}</Txt> : null}
              {source === 'gps' && gpsMode === 'background' ? <Notice>{t('Location keeps sharing with the phone locked or in another app. Do not swipe the app away.')}</Notice> : null}
              {source === 'gps' && gpsNeed === 'allow' ? (
                <>
                  <Notice>{t('Sharing stops when the phone locks. Set location to "Allow all the time" for this app.')}</Notice>
                  <Button small variant="ghost" icon="settings" title={t('Open phone settings')} onPress={openLocationSettings} />
                </>
              ) : null}
              {source === 'gps' && gpsNeed === 'build' ? <Notice>{backgroundAvailable() ? t('Keep this screen open while driving.') : t('Expo Go cannot share location in the background. Keep this screen open, or use the installed app.')}</Notice> : null}
              {source === 'gps' ? <Button small variant="ghost" icon="settings" title={t('Stop the phone closing this app')} onPress={openBatterySettings} /> : null}
            </>
          )}
          <ErrorText>{gpsError}</ErrorText>
          {route ? (
            <View style={{ height: 220, borderRadius: 16, overflow: 'hidden' }}>
              <MapBox fitPoints={route.stops} fitKey={route.code}>
                <RouteLayer stops={route.stops} />
                <Dot point={shownPosition} color={C.live} />
              </MapBox>
            </View>
          ) : null}
        </ViewCard>
        <PreTripCheck token={token} />
        <FuelEntry token={token} />
        </ViewList>
        <ViewList label="Students">
        <PassScanner token={token} tripRunning={Boolean(trip)} />
        <StudentList token={token} tripId={trip?.id ?? null} />
        {trip && <BoardedList token={token} tripId={trip.id} />}
        <FoundItem token={token} />
        </ViewList>
        <Appearance />

        {demo && trip && (
          <Panel>
            <Collapsible title="Test server validation">
              <Txt muted small>Sends one invalid fix. The server must reject it and keep the bus position unchanged.</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <Button small variant="ghost" title="0,0 fix" onPress={() => sendBadFix('zero')} />
                <Button small variant="ghost" title="12 km jump" onPress={() => sendBadFix('jump')} />
                <Button small variant="ghost" title="900 m accuracy" onPress={() => sendBadFix('accuracy')} />
                <Button small variant="ghost" title="Future time" onPress={() => sendBadFix('future')} />
              </View>
            </Collapsible>
          </Panel>
        )}

        {demo && (
          <Panel>
            <Collapsible title="Transmission log">
              {log.length === 0 && <Txt muted>{t('Start a trip to begin sending locations.')}</Txt>}
              {log.map((l, i) => (
                <View key={i} style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
                  <Row>
                    <Txt small muted>{l.at.toLocaleTimeString()}</Txt>
                    <Txt small style={{ flex: 1 }}>{l.fix ? `${l.fix.lat.toFixed(5)}, ${l.fix.lng.toFixed(5)}` : ''}</Txt>
                    {l.label ? <Txt small muted>{l.label}</Txt> : null}
                  </Row>
                  <Txt small bold style={{ color: l.ok ? C.live : C.danger }}>{l.text}</Txt>
                </View>
              ))}
            </Collapsible>
          </Panel>
        )}
      </Screen>

      {/* SOS: always within reach, press and hold so it is never sent by a brush. */}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 16 + insets.bottom }}>
        <Pressable accessibilityRole="button" accessibilityLabel="SOS. Press and hold to send an emergency alert" accessibilityHint="Opens a confirmation that sends in 5 seconds"
          delayLongPress={800} onLongPress={() => { Vibration.vibrate(60); setSos(true); }} onPress={() => setNotice('Press and hold the SOS button to send an emergency alert.')}
          style={({ pressed }) => [{ minHeight: 60, borderRadius: 16, backgroundColor: C.dark ? '#A02022' : '#A02022', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...shadow }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
          <Icon name="siren" size={22} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 17, ...F[700] }}>SOS · press and hold</Text>
        </Pressable>
      </View>

      {issue ? <ReportIssue token={token} onClose={() => setIssue(false)} onSent={(m) => { setIssue(false); setNotice(m); }} /> : null}
      {sos ? <SosConfirm token={token} bus={bus} onClose={() => setSos(false)} onSent={(m) => { setSos(false); setNotice(m); }} /> : null}
      <ChangePasswordSheet visible={password} onClose={() => setPassword(false)} />
    </View>
  );
}
