import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, useWindowDimensions, Vibration, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Icon from '../components/Icon.js';
import { Dot, MapBox, RouteLayer } from '../components/maps';
import {
  Badge, Button, Collapsible, ErrorText, FoldCard, GradientCard, LivePulse, Notice, Panel, Row, Screen, SearchBox, Segmented, Sheet, Text,
  TextField, Txt,
} from '../components/ui.js';
import { api, ApiError } from '../lib/api.js';
import { OCCUPANCY, time } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';
import { PathWalker, projectOnRoute } from '../lib/rules.js';
import { useSession } from '../lib/session.js';
import { C, F, G, TONE, shadow } from '../theme.js';

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

/** Breakdown, delay, emergency and SOS as large tiles (doc B.7 "Problem" state). */
function ProblemTiles({ token, disabled }) {
  const [kind, setKind] = useState(null);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const where = await currentWhere();
      await api('/api/driver/incidents', { token, body: { kind, message: message || undefined, ...where } });
      setDone(`${kind.toLowerCase()} reported to the transport office${kind !== 'SOS' ? ' and to students on this route' : ''}.`);
      setKind(null);
      setMessage('');
      Vibration.vibrate([0, 80, 40, 80]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Report a problem" icon="alert">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[['BREAKDOWN', 'Breakdown'], ['DELAY', 'Delay'], ['EMERGENCY', 'Emergency'], ['SOS', 'SOS']].map(([k, label]) => {
          const off = disabled && k !== 'SOS';
          return (
            <Pressable
              key={k}
              disabled={off}
              onPress={() => { setKind(k); setDone(null); setError(null); }}
              style={{ flexBasis: '47%', flexGrow: 1, minHeight: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: k === 'SOS' ? C.danger : C.navy50, opacity: off ? 0.4 : 1 }}
            >
              <Text style={{ ...F[800], fontSize: 16, color: k === 'SOS' ? '#fff' : C.navy }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Notice>{done}</Notice>
      {kind && (
        <Sheet title={`Report ${kind.toLowerCase()}`} onClose={() => setKind(null)}>
          <View style={{ gap: 12 }}>
            <TextField label="What happened? (optional)" value={message} onChangeText={setMessage} placeholder="e.g. Flat tyre near Guindy" />
            <ErrorText>{error}</ErrorText>
            <Button title="Send now" variant={kind === 'SOS' || kind === 'EMERGENCY' ? 'danger' : 'primary'} busy={busy} onPress={send} />
          </View>
        </Sheet>
      )}
    </Panel>
  );
}

/** The rotating in-bus code (QR and six digits) for students without GPS (doc 9.7). */
function BoardingCode({ token }) {
  const [code, setCode] = useState(null);
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const c = await api('/api/driver/boarding-code', { token });
        setCode(c);
        timer = setTimeout(load, Math.max(2, c.expiresInS) * 1000);
      } catch {
        timer = setTimeout(load, 10000);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, [token]);
  if (!code) return <Txt muted>Loading code…</Txt>;
  return (
    <Row gap={14}>
      <View style={{ padding: 6, backgroundColor: '#fff', borderRadius: 8 }}>
        <QRCode value={code.qrPayload} size={140} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt muted small>Students without GPS scan this, or type</Txt>
        <Text style={{ fontSize: 30, ...F[800], letterSpacing: 3, color: C.ink, fontVariant: ['tabular-nums'] }}>{code.code}</Text>
        <Txt muted small>Changes every minute</Txt>
      </View>
    </Row>
  );
}

/** Students recorded on board, and marking one by hand (doc 4.2). */
function BoardedList({ token, tripId }) {
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
    // Folded until opened, like "Students on this bus"; the seat count stays visible.
    <FoldCard
      icon="users"
      title="On board"
      summary={!data ? 'Loading…' : onBoard.length ? `${onBoard.length} student${onBoard.length === 1 ? '' : 's'} on board · mark one by hand` : 'Nobody recorded yet · mark one by hand'}
      badge={<Badge tone={data && data.capacity && data.onBoard > data.capacity ? 'danger' : 'live'}>{data?.onBoard ?? 0} / {data?.capacity ?? '—'} seats</Badge>}
    >
      {onBoard.length === 0 ? <Txt muted>Nobody recorded yet.</Txt> : onBoard.map((r) => (
        <View key={r.attendance_id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
          <Txt bold>{r.full_name} <Txt muted small>{r.register_no ?? r.username}</Txt></Txt>
          <Txt muted small>{r.method} · {time(r.boarded_at)}{r.boarding_stop ? ` · ${r.boarding_stop}` : ''}</Txt>
        </View>
      ))}
      <Row>
        <TextField value={username} onChangeText={setUsername} placeholder="Student username (no phone / no GPS)" autoCapitalize="none" style={{ flex: 1 }} accessibilityLabel="Student username" onSubmitEditing={mark} />
        <Button title="Mark" variant="ghost" onPress={mark} />
      </Row>
      <ErrorText>{error}</ErrorText>
    </FoldCard>
  );
}

/** Every student whose home route is this bus's route, by stop, with their details and today's boarding. */
function StudentList({ token, tripId }) {
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
    if (!g) groups.push((g = { key, name: st.stopName ?? 'No stop chosen', time: st.stopTime, rows: [] }));
    g.rows.push(st);
  }
  return (
    <FoldCard
      icon="users"
      title="Students on this bus"
      summary={!data ? 'Loading…' : !students.length ? 'No students on this route yet' : `${students.length} students · ${groups.length} stop${groups.length === 1 ? '' : 's'}`}
      badge={<Badge tone={tripId && boarded ? 'live' : 'info'}>{tripId ? `${boarded}/${students.length}` : `${students.length}`}</Badge>}
    >
      {!data && !error ? <Txt muted>Loading students…</Txt> : null}
      {data && students.length === 0 ? <Txt muted>No students have this route as their home route yet.</Txt> : null}
      {students.length > 6 ? <SearchBox value={query} onChange={setQuery} placeholder="Search name, register no, stop" /> : null}
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
                  {onBoard ? <Badge tone="live">On board</Badge> : a?.alightedAt ? <Badge tone="offline">Got off</Badge> : tripId ? <Badge tone="delayed">Not boarded</Badge> : null}
                </Row>
                {expanded && (
                  <View style={{ gap: 6, marginTop: 8 }}>
                    <Row wrap>
                      <Badge tone={st.passActive ? 'live' : 'danger'}>{st.passActive ? 'Bus pass active' : 'No active pass'}</Badge>
                      {a ? <Badge tone="info">{a.method}{a.boardedAt ? ` · ${time(a.boardedAt)}` : ''}</Badge> : null}
                    </Row>
                    <Txt small>Username: {st.username}</Txt>
                    {st.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${st.phone}`)} accessibilityRole="link">
                        <Row><Icon name="phone" size={14} color={C.indigo} /><Txt small style={{ color: C.indigo }}>{st.phone}</Txt></Row>
                      </Pressable>
                    ) : <Txt muted small>No phone number on file</Txt>}
                    {st.email ? <Row><Icon name="mail" size={14} color={C.faint} /><Txt small muted>{st.email}</Txt></Row> : null}
                    {tripId && !onBoard ? <Button small variant="ghost" title="Mark on board" icon="check" busy={marking === st.id} onPress={() => mark(st)} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </FoldCard>
  );
}

export default function DriverApp() {
  const { token, user, signOut } = useSession();
  const { height } = useWindowDimensions();
  const now = useNow(15000);
  const [route, setRoute] = useState(null);
  const [trip, setTrip] = useState(null);
  // The bus's own GPS tracker is the main source; the phone's GPS is an optional backup.
  const [source, setSource] = useState('tracker'); // 'tracker' | 'gps' | 'simulate'
  const [busGps, setBusGps] = useState(null); // { tracker, reporting, position } from the server
  const [intervalS, setIntervalS] = useState(10);
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState(null);
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
    api(`/api/routes/${encodeURIComponent(user.routeCode)}`).then((r) => {
      setRoute(r);
      walkerRef.current = new PathWalker(r.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
    }).catch((err) => setError(err.message));
    api('/api/driver/trip', { token })
      .then(({ trip: t }) => { setTrip(t); setOccupancy(t?.occupancy ?? null); })
      .catch((err) => (err instanceof ApiError && err.status === 401 ? signOut() : setError(err.message)));
  }, [token, user?.routeCode, signOut]);

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

  // Phone GPS (optional backup): keep the most recent fix; the send loop picks it up.
  useEffect(() => {
    if (!trip || source !== 'gps') return undefined;
    let sub = null;
    let cancelled = false;
    (async () => {
      setGpsError(null);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setGpsError('Location permission is needed to share the bus position. Allow it in the phone settings.');
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
    return () => { cancelled = true; sub?.remove(); };
  }, [trip, source]);

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
    if (!trip || source === 'tracker') return undefined;
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
  }, [trip, source, intervalS, nextFix, send]);

  const startTrip = async () => {
    setError(null);
    if (source === 'gps') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setError('Location permission is needed before a trip can start.');
    }
    try {
      const { trip: t } = await api('/api/driver/trips', { token, method: 'POST' });
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
    try {
      await api(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
    } catch (err) {
      setError(err.message);
    }
    bufferRef.current = [];
    setBuffered(0);
    setStandby(false);
    setTrip(null);
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
        <Panel title="No bus assigned" icon="bus">
          <Txt muted>Ask the transport office to assign a bus to your account.</Txt>
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
  const proj = route && shownPosition ? projectOnRoute(route.stops, shownPosition) : null;
  const nextIndex = proj ? Math.min(route.stops.length - 1, proj.segment + 1) : 0;
  const nextStop = proj ? route.stops[nextIndex] : null;
  const stopsLeft = route ? route.stops.length - 1 - nextIndex : 0;
  const mins = trip ? Math.max(0, Math.floor((now - new Date(trip.started_at).getTime()) / 60000)) : 0;
  const elapsed = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const statusTone = !trip ? C.offline : standby ? C.live : buffered > 0 || !transmitting ? C.delayed : C.live;
  let statusText;
  if (!trip) statusText = useTracker ? 'The bus GPS tracker shares the location while a trip is running.' : 'Location is shared only while a trip is running.';
  else if (useTracker) {
    if (trackerReporting) statusText = 'Bus GPS tracker is sharing live location';
    else if (!tracker) statusText = 'No GPS tracker is fitted on this bus. Switch on phone GPS below.';
    else statusText = `Bus GPS tracker is not reporting (last heard ${ago(tracker.lastSeenAt, now)}). Switch on phone GPS below.`;
  } else if (standby) statusText = 'The bus GPS tracker is sharing the location. This phone stands by and takes over if the tracker stops.';
  else if (buffered > 0) statusText = `No network · ${buffered} fix(es) saved, will send when back`;
  else statusText = transmitting ? 'Sharing live location from this phone' : 'Waiting for phone GPS…';

  return (
    <Screen>
      <View style={{ height: Math.round(height * 0.3), borderRadius: 18, overflow: 'hidden', ...shadow }}>
        <MapBox fitPoints={route?.stops ?? []} fitKey={route?.code}>
          <RouteLayer stops={route?.stops} />
          <Dot point={shownPosition} color={C.live} />
        </MapBox>
      </View>

      <GradientCard colors={trip ? G.emerald : G.navy}>
        <Row>
          <Icon name="bus" size={20} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', ...F[800], fontSize: 17 }}>{user.fleetCode}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>Route {user.routeCode} · {user.routeName}</Text>
          </View>
          <Text style={{ color: trip ? C.emerald700 : C.navy, backgroundColor: trip ? '#fff' : C.gold, ...F[800], paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' }}>{trip ? 'On trip' : 'Ready'}</Text>
        </Row>
        {trip ? (
          <>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, ...F[700] }}>NEXT STOP</Text>
            <Text style={{ color: '#fff', fontSize: 22, ...F.display }}>{nextStop?.name ?? '—'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)' }}>{nextStop ? `${stopsLeft} stop${stopsLeft === 1 ? '' : 's'} to campus · scheduled ${nextStop.scheduled_time ?? ''}` : useTracker ? 'Waiting for the bus GPS tracker' : 'Waiting for the first GPS fix'}</Text>
            <Row style={{ justifyContent: 'space-around', marginTop: 4 }}>
              {[[Math.round(shownPosition?.speedKmh ?? 0), 'km/h'], [elapsed, 'on trip'], useTracker ? [trackerReporting ? 'Live' : 'Off', 'bus GPS'] : [counts.accepted, 'fixes sent']].map(([v, l]) => (
                <View key={l} style={{ alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 24, ...F.display, fontVariant: ['tabular-nums'] }}>{v}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{l}</Text>
                </View>
              ))}
            </Row>
          </>
        ) : (
          <>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, ...F[700] }}>BEFORE YOU START</Text>
            <Row style={{ justifyContent: 'space-between' }}><Text style={{ color: '#fff' }}>First stop</Text><Text style={{ color: '#fff', ...F[700], flexShrink: 1, textAlign: 'right' }}>{route?.stops[0]?.name ?? '…'}</Text></Row>
            <Row style={{ justifyContent: 'space-between' }}><Text style={{ color: '#fff' }}>Departs</Text><Text style={{ color: '#fff', ...F[700] }}>{route?.departure_time ?? '—'}</Text></Row>
          </>
        )}
        <Row style={{ backgroundColor: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 12 }}>
          {trip && (standby || (transmitting && buffered === 0)) ? <LivePulse size={10} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusTone }} />}
          <Text style={{ color: '#fff', flex: 1 }}>{statusText}</Text>
        </Row>
        {trip?.started_by === 'tracker' ? <Text style={{ color: '#fff', opacity: 0.85 }}>This trip was started automatically by the bus GPS tracker.</Text> : null}
      </GradientCard>

      <Panel>
        <Row>
          <Icon name="signal" size={16} color={C.navy} />
          <Txt bold style={{ flex: 1 }}>Bus GPS tracker</Txt>
          {!busGps ? <Badge tone="offline">Checking…</Badge>
            : !tracker ? <Badge tone="danger">Not fitted</Badge>
              : !tracker.active ? <Badge tone="danger">Disabled</Badge>
                : trackerReporting ? <Badge tone="live">Reporting</Badge>
                  : tracker.online ? <Badge tone="delayed">Online, no fix</Badge>
                    : <Badge tone="delayed">Offline</Badge>}
        </Row>
        {tracker ? <Txt muted small>{tracker.label ?? tracker.uniqueId} · last heard {ago(tracker.lastSeenAt, now)}</Txt>
          : busGps ? <Txt muted small>Ask the transport office to fit and register a GPS tracker for this bus. Until then use phone GPS.</Txt> : null}
        <Txt bold>Location source</Txt>
        <Segmented value={source} onChange={setSource} options={[{ value: 'tracker', label: 'Bus GPS' }, { value: 'gps', label: 'Phone' }, { value: 'simulate', label: 'Simulate' }]} />
        {useTracker ? (
          <>
            <Txt muted small>The bus GPS tracker sends the location by itself; this phone does not need GPS. Phone GPS is an optional backup.</Txt>
            {trip && !trackerReporting ? <Button small variant="ghost" icon="phone" title="Use phone GPS as backup" onPress={() => setSource('gps')} /> : null}
          </>
        ) : (
          <>
            <Txt bold>Send every</Txt>
            <Segmented value={intervalS} onChange={setIntervalS} options={[5, 10, 15].map((sec) => ({ value: sec, label: `${sec} s` }))} />
            <Txt muted small>{source === 'gps' ? 'Backup only: while the bus GPS tracker reports, this phone stands by. ' : ''}Keep this screen open while driving: the phone shares location only while the app is in the foreground.</Txt>
          </>
        )}
        <ErrorText>{gpsError}</ErrorText>
        <ErrorText>{error}</ErrorText>
        {trip ? (
          <Button title="End trip" variant="danger" icon="x" onPress={endTrip} style={{ minHeight: 60 }} />
        ) : (
          <Button title="Start trip" variant="emerald" icon="arrow" onPress={startTrip} disabled={!route} style={{ minHeight: 60 }} />
        )}
      </Panel>

      {trip && (
        <Panel title="Crowd level after this stop" icon="users">
          <Row>
            {Object.entries(OCCUPANCY).map(([k, o]) => {
              const on = occupancy === k;
              return (
                <Pressable key={k} onPress={() => tapOccupancy(k)} style={{ flex: 1, minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: TONE[o.tone].fg, backgroundColor: on ? TONE[o.tone].fg : TONE[o.tone].bg }}>
                  <Text style={{ ...F[800], color: on ? '#fff' : TONE[o.tone].fg }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </Row>
        </Panel>
      )}
      {trip && <Panel title="Boarding code" icon="qr"><BoardingCode token={token} /></Panel>}
      <StudentList token={token} tripId={trip?.id ?? null} />
      {trip && <BoardedList token={token} tripId={trip.id} />}

      <ProblemTiles token={token} disabled={!trip} />

      {trip && (
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

      <Panel>
        <Collapsible title="Transmission log">
          {log.length === 0 && <Txt muted>Start a trip to begin sending locations.</Txt>}
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
    </Screen>
  );
}
