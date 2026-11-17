import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import BaseTiles from '../components/BaseTiles.jsx';
import QRCode from 'qrcode';
import { api, ApiError } from '../lib/api.js';
import { OCCUPANCY, time } from '../lib/format.js';
import { useServerInfo } from '../lib/serverInfo.js';
import { useSession } from '../lib/session.jsx';
import GreetHeader from '../components/GreetHeader.jsx';
import Icon from '../components/Icon.jsx';
import { Badge, ErrorText, Modal, Notice, SearchBox } from '../components/ui.jsx';
import { ViewCard, ViewList } from '../components/adminkit.jsx';
import { FoundItem, FuelEntry, PassScanner, PreTripCheck } from '../components/DriverTools.jsx';
import DayBanner from '../components/DayBanner.jsx';
import { useT } from '../lib/i18n.js';
import { PathWalker } from '../../../shared/geo.js';
import { projectOnRoute } from '../../../shared/eta.js';
import { DIRECTIONS, DIRECTION_PATH, DIRECTION_TEXT, travelOrder } from '../../../shared/direction.js';
import { useNow } from '../lib/useNow.js';

const MAX_BUFFER = 200;

/** Show the whole route when the screen opens. */
function FitRoute({ route }) {
  const map = useMap();
  useEffect(() => {
    if (route?.stops.length) map.fitBounds(route.stops.map((s) => [s.lat, s.lng]), { padding: [40, 40] });
  }, [map, route]);
  return null;
}

function Follow({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.panTo([position.lat, position.lng], { animate: true });
  }, [map, position?.lat, position?.lng]);
  return null;
}

/** Breakdown, delay, emergency and SOS as large tiles (doc B.7 "Problem" state). */
function ProblemTiles({ token, disabled }) {
  const t = useT();
  const [kind, setKind] = useState(null);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const send = async () => {
    setError(null);
    try {
      let where = {};
      if ('geolocation' in navigator) {
        where = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 4000 }),
        );
      }
      await api('/api/driver/incidents', { token, body: { kind, message: message || undefined, ...where } });
      setDone(`${kind.toLowerCase()} reported to the transport office${kind !== 'SOS' ? ' and to students on this route' : ''}.`);
      setKind(null);
      setMessage('');
      navigator.vibrate?.([80, 40, 80]);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="panel">
      <h3><Icon name="alert" size={17} className="panel-icon" />{t('Report a problem')}</h3>
      <div className="tiles">
        {[['BREAKDOWN', t('Breakdown')], ['DELAY', t('Delay')], ['EMERGENCY', t('Emergency')], ['SOS', 'SOS']].map(([k, label]) => (
          <button key={k} className={`tile ${k === 'SOS' ? 'sos' : ''}`} disabled={disabled && k !== 'SOS'} onClick={() => { setKind(k); setDone(null); }}>{label}</button>
        ))}
      </div>
      <Notice>{done}</Notice>
      {kind && (
        <Modal title={`Report ${kind.toLowerCase()}`} onClose={() => setKind(null)}>
          <label className="field">
            <span>What happened? (optional)</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('e.g. Flat tyre near Guindy')} />
          </label>
          <ErrorText>{error}</ErrorText>
          <button className={`btn ${kind === 'SOS' || kind === 'EMERGENCY' ? 'danger' : 'primary'}`} onClick={send}>{t('Send now')}</button>
        </Modal>
      )}
    </div>
  );
}

/** The rotating in-bus code (QR and six digits) for students without GPS (doc 9.7). */
function BoardingCode({ token }) {
  const t = useT();
  const [code, setCode] = useState(null);
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const c = await api('/api/driver/boarding-code', { token });
        setCode(c);
        setQr(await QRCode.toDataURL(c.qrPayload, { margin: 1, width: 180 }));
        timer = setTimeout(load, Math.max(2, c.expiresInS) * 1000);
      } catch {
        timer = setTimeout(load, 10000);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, [token]);
  if (!code) return null;
  return (
    <div className="boarding-code">
      {qr && <img src={qr} alt={`Boarding QR code, code ${code.code}`} width={150} height={150} />}
      <div>
        <span className="muted">{t('Students without GPS scan this, or type')}</span>
        <b className="tabular big-code">{code.code}</b>
        <span className="muted">{t('Changes every minute')}</span>
      </div>
    </div>
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
  const mark = async (e) => {
    e.preventDefault();
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
      icon="check"
      title="On board"
      summary={!data ? t('Loading…') : onBoard.length ? `${onBoard.length} student${onBoard.length === 1 ? '' : 's'} on board · mark one by hand` : 'Nobody recorded yet · mark one by hand'}
      badge={<Badge tone={data && data.capacity && data.onBoard > data.capacity ? 'danger' : 'live'}>{data?.onBoard ?? 0} / {data?.capacity ?? '—'} seats</Badge>}
    >
      {onBoard.length === 0 ? <p className="muted">{t('Nobody recorded yet.')}</p> : (
        <ul className="boarded">
          {onBoard.map((r) => (
            <li key={r.attendance_id}>
              <span>{r.full_name}<small>{r.register_no ?? r.username}</small></span>
              <span className="muted">{r.method} · {time(r.boarded_at)}{r.boarding_stop ? ` · ${r.boarding_stop}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={mark}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (no phone or GPS)" aria-label={t('Student username')} required />
        <button className="btn ghost">{t('Mark on board')}</button>
      </form>
      <ErrorText>{error}</ErrorText>
    </ViewCard>
  );
}

const ONBOARD = ['CONFIRMED', 'ON_BOARD', 'PROVISIONAL'];

/** Every student whose home route is this bus's route, by stop, with details and today's boarding. */
function StudentList({ token, tripId }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const load = useCallback(() => api('/api/driver/students', { token }).then(setData).catch((e) => setError(e.message)), [token]);
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load, tripId]);
  const mark = (st) => api('/api/attendance/manual', { token, body: { tripId, username: st.username } }).then(load).catch((e) => setError(e.message));
  const students = data?.students ?? [];
  const boarded = students.filter((s) => s.attendance && ONBOARD.includes(s.attendance.status) && !s.attendance.alightedAt).length;
  const groups = [];
  const needle = query.trim().toLowerCase();
  const shown = students.filter((st) => !needle || [st.fullName, st.registerNo, st.username, st.department, st.stopName].some((v) => v && String(v).toLowerCase().includes(needle)));
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
      badge={<Badge tone={tripId && boarded ? 'live' : 'info'}>{tripId ? `${boarded}/${students.length} boarded` : `${students.length}`}</Badge>}
      actions={students.length > 6 ? <SearchBox value={query} onChange={setQuery} placeholder={t('Search name, register no or stop')} /> : null}
    >
      {data && !students.length && <p className="muted">{t('No students have this route as their home route yet.')}</p>}
      {groups.map((g) => (
        <div key={g.key} className="driver-stop">
          <div className="driver-stop-head"><Icon name="pin" size={13} /><b>{g.name}</b><small>{g.time ?? ''}</small></div>
          <ul className="driver-students">
            {g.rows.map((st) => {
              const a = st.attendance;
              const on = a && ONBOARD.includes(a.status) && !a.alightedAt;
              return (
                <li key={st.id}>
                  <span className="driver-student-main">
                    <b>{st.fullName}</b>
                    <small>{[st.registerNo ?? st.username, st.department].filter(Boolean).join(' · ')}{st.phone ? <> · <a href={`tel:${st.phone}`}>{st.phone}</a></> : null}</small>
                  </span>
                  <Badge tone={st.passActive ? 'live' : 'danger'}>{st.passActive ? t('Pass') : t('No pass')}</Badge>
                  {on ? <Badge tone="live">On board</Badge> : tripId ? <button type="button" className="btn ghost inline driver-mark" onClick={() => mark(st)}>{t('Mark')}</button> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ErrorText>{error}</ErrorText>
    </ViewCard>
  );
}

export default function DriverApp() {
  const { token, user, signOut } = useSession();
  // The simulated bus, the bad-fix buttons and the transmission log are demo tools.
  const demo = Boolean(useServerInfo()?.demoMode);
  const now = useNow(15000);
  const [route, setRoute] = useState(null);
  const [trip, setTrip] = useState(null);
  // The bus's own GPS tracker is the main source; the phone's GPS is an optional backup.
  const [source, setSource] = useState('tracker'); // 'tracker' | 'gps' | 'simulate'
  const [busGps, setBusGps] = useState(null);
  const choseSource = useRef(false);
  const pickSource = (value) => { choseSource.current = true; setSource(value); };
  useEffect(() => {
    if (busGps && !busGps.tracker && source === 'tracker' && !choseSource.current) setSource('gps');
  }, [busGps, source]);
  useEffect(() => {
    if (!token) return undefined;
    let timer;
    let cancelled = false;
    const load = async () => {
      try { const g = await api('/api/driver/bus-gps', { token }); if (!cancelled) setBusGps(g); } catch { /* retry */ }
      if (!cancelled) timer = setTimeout(load, 5000);
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token]);
  // The bus tracker starts a trip by itself when the bus moves off: pick it up here.
  const trackerTripId = busGps?.position?.tripId ?? null;
  useEffect(() => {
    if (trip || !trackerTripId) return;
    api('/api/driver/trip', { token })
      .then(({ trip: t }) => { if (t) { setTrip(t); setOccupancy(t.occupancy ?? null); } })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, trackerTripId, token]);
  const t = useT();
  const [intervalS, setIntervalS] = useState(10);
  // The run the next trip will be: the driver's choice, else what the time of day suggests.
  const [suggested, setSuggested] = useState(null);
  const [picked, setPicked] = useState(null);
  const direction = picked ?? suggested ?? 'UP';
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

  const logout = () => {
    signOut();
    window.location.hash = '#/';
  };

  const addLog = (entry) => setLog((prev) => [{ ...entry, at: new Date() }, ...prev].slice(0, 12));

  // Load the driver's route and any trip that is still running.
  useEffect(() => {
    if (!token || !user?.routeCode) return;
    api(`/api/routes/${encodeURIComponent(user.routeCode)}`).then(setRoute);
    api('/api/driver/trip', { token })
      .then(({ trip: t, suggestedDirection }) => { setTrip(t); setOccupancy(t?.occupancy ?? null); setSuggested(suggestedDirection); })
      .catch((err) => (err instanceof ApiError && err.status === 401 ? logout() : setError(err.message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.routeCode]);

  // A trip can end without this phone: at the geofence, or by the transport office.
  useEffect(() => {
    if (!trip) return undefined;
    const id = setInterval(() => {
      api('/api/driver/trip', { token }).then(({ trip: t }) => { if (!t) setTrip(null); }).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, token]);

  // The simulated bus walks the stops in the order this run reaches them.
  useEffect(() => {
    if (route) walkerRef.current = new PathWalker(travelOrder(route.stops, trip?.direction).map((s) => ({ lat: s.lat, lng: s.lng })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, trip?.direction]);

  // Phone-only bus (no tracker), no trip yet: send where this device is every 10 s
  // while the page is open. When the bus leaves the depot in trip hours the
  // server starts the trip by itself (server/autostart.js).
  const phoneOnly = Boolean(busGps && !busGps.tracker);
  const [autoWait, setAutoWait] = useState(null);
  useEffect(() => {
    if (trip || !phoneOnly || !token || !('geolocation' in navigator)) { setAutoWait(null); return undefined; }
    const pending = [];
    let watch = null;
    let cancelled = false;
    // Only with permission already given: waiting must not pop up a prompt.
    const begin = () => {
      watch = navigator.geolocation.watchPosition((p) => {
        pending.push({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          speedKmh: p.coords.speed == null ? undefined : Math.round(p.coords.speed * 36) / 10,
          recordedAt: new Date(p.timestamp).toISOString(),
        });
        if (pending.length > 24) pending.splice(0, pending.length - 24);
      }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    };
    (navigator.permissions?.query({ name: 'geolocation' }) ?? Promise.resolve({ state: 'prompt' }))
      .then((s) => { if (!cancelled && s.state === 'granted') begin(); })
      .catch(() => {});
    const timer = setInterval(async () => {
      if (!pending.length) return;
      const fixes = pending.splice(0);
      try {
        const r = await api('/api/driver/standby', { token, body: { fixes } });
        if (r.trip) {
          setSource('gps');
          setTrip(r.trip);
          setOccupancy(r.trip.occupancy ?? null);
        } else setAutoWait(r.waiting ?? null);
      } catch {
        // No signal: the next batch tries again.
      }
    }, 10000);
    return () => { cancelled = true; if (watch != null) navigator.geolocation.clearWatch(watch); clearInterval(timer); };
  }, [trip, phoneOnly, token]);

  // Phone GPS: keep the most recent fix; the send loop picks it up.
  useEffect(() => {
    if (!trip || source !== 'gps') return;
    if (!('geolocation' in navigator)) {
      setGpsError(t('This browser has no GPS access.'));
      return;
    }
    setGpsError(null);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        latestGpsRef.current = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
          speedKmh: p.coords.speed === null ? undefined : Math.round(p.coords.speed * 3.6 * 10) / 10,
          heading: p.coords.heading === null || Number.isNaN(p.coords.heading) ? undefined : Math.round(p.coords.heading),
          recordedAt: new Date(p.timestamp).toISOString(),
        };
        setPosition(latestGpsRef.current);
      },
      (err) => setGpsError(`GPS error: ${err.message}. Location needs https or localhost and permission.`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [trip, source]);

  // A browser stops the GPS when the screen sleeps: keep it awake during a trip.
  const sendingFromPhone = Boolean(trip) && source !== 'tracker';
  useEffect(() => {
    if (!sendingFromPhone || !navigator.wakeLock) return undefined;
    let lock = null;
    let done = false;
    const hold = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((l) => { if (done) l.release(); else lock = l; }).catch(() => {});
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', hold);
      lock?.release().catch(() => {});
    };
  }, [sendingFromPhone]);

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
    return {
      lat: p.lat,
      lng: p.lng,
      speedKmh: p.done ? 0 : Math.round(speed),
      heading: Math.round(p.heading),
      accuracyM: 8,
      recordedAt: new Date().toISOString(),
    };
  }, [source, intervalS]);

  const send = useCallback(
    async (fixes, label) => {
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
          if (err.status === 401) logout();
          if (err.status === 409) setTrip(null);
          addLog({ fix: fixes.at(-1), ok: false, text: err.message, label });
          return true; // the server answered; do not buffer
        }
        return false; // network failure
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  // Send loop: one fix per interval, plus anything buffered while offline.
  useEffect(() => {
    if (!trip || source === 'tracker') return;
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
    if (source === 'gps' && !('geolocation' in navigator)) {
      setError(t('Location permission is needed before a trip can start.'));
      return;
    }
    try {
      const { trip: t } = await api('/api/driver/trips', { token, body: { direction } });
      distanceRef.current = 0;
      setCounts({ sent: 0, accepted: 0, rejected: 0 });
      setLog([]);
      setTrip(t);
      setOccupancy(t.occupancy ?? null);
      navigator.vibrate?.(120);
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
    setPicked(null);
    api('/api/driver/trip', { token }).then((r) => setSuggested(r.suggestedDirection)).catch(() => {});
    navigator.vibrate?.([120, 60, 120]);
  };

  const tapOccupancy = async (o) => {
    try {
      await api('/api/driver/occupancy', { token, body: { occupancy: o } });
      setOccupancy(o);
      navigator.vibrate?.(30);
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
      <main className="center-page">
        <div className="panel login">
          <h2>{t('No bus assigned')}</h2>
          <p className="muted">{t('Ask the transport office to assign a bus to your account.')}</p>
          <button className="btn ghost" onClick={logout}>Sign out</button>
        </div>
      </main>
    );
  }

  const tracker = busGps?.tracker ?? null;
  const trackerReporting = Boolean(busGps?.reporting);
  const useTracker = source === 'tracker';
  const phoneTransmitting = lastOkAt && Date.now() - lastOkAt.getTime() < intervalS * 2000;
  const transmitting = useTracker ? trackerReporting : phoneTransmitting;
  // The bus tracker's position when it is the source (or when the phone stands by for it).
  const shown = (useTracker || standby) && busGps?.position ? busGps.position : useTracker ? null : position;
  const ago = (iso) => {
    if (!iso) return 'never';
    const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return sec < 60 ? `${sec} s ago` : sec < 3600 ? `${Math.floor(sec / 60)} min ago` : `${Math.floor(sec / 3600)} h ago`;
  };
  let statusText;
  if (!trip) statusText = useTracker ? t('The bus GPS tracker shares the location while a trip is running.') : t('Location is shared only while a trip is running.');
  else if (useTracker) {
    if (trackerReporting) statusText = t('Bus GPS tracker is sharing live location');
    else if (!tracker) statusText = t('No GPS tracker on this bus. Choose phone GPS under Location.');
    else statusText = `Bus GPS tracker is not reporting (last heard ${ago(tracker.lastSeenAt)}). Switch Location to phone GPS.`;
  } else if (standby) statusText = t('The bus GPS tracker is sharing the location. This phone stands by and takes over if the tracker stops.');
  else if (buffered > 0) statusText = `No network · ${buffered} fix(es) saved, will send when back`;
  else statusText = transmitting ? t('Sharing live location from this phone') : t('Waiting for phone GPS…');
  // Where the bus is along its route: the next stop ahead and how many are left.
  const ordered = route ? travelOrder(route.stops, trip?.direction ?? direction) : [];
  const proj = route && shown ? projectOnRoute(ordered, shown) : null;
  const nextIndex = proj ? Math.min(ordered.length - 1, proj.segment + 1) : 0;
  const nextStop = proj ? ordered[nextIndex] : null;
  const stopsLeft = route ? ordered.length - 1 - nextIndex : 0;
  const mins = trip ? Math.max(0, Math.floor((now - new Date(trip.started_at).getTime()) / 60000)) : 0;
  const elapsed = mins >= 1440 ? `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h` : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

  return (
    <main className="driver-layout">
      <div className="driver-greet"><GreetHeader title={t('My trip')} /></div>
      <section className="driver-controls">
        <section className="route-card drive-card">
          <div className="route-pick static">
            <Icon name="bus" size={20} />
            <span className="pick-text"><b>{user.fleetCode}</b><small>Route {user.routeCode} · {user.routeName}</small></span>
            <span className={`trip-chip ${trip ? 'on' : ''}`}>{trip ? t('On trip') : t('Ready')}</span>
          </div>

          {trip ? (
            <>
              <span className="route-card-label">{t('Next stop')}</span>
              <div className="next-stop">
                <b>{nextStop?.name ?? '—'}</b>
                <small>{nextStop ? `${stopsLeft} stop${stopsLeft === 1 ? '' : 's'} ${trip.direction === 'DOWN' ? 'left' : 'to campus'} · scheduled ${nextStop.scheduled_time ?? ''}` : useTracker ? t('Waiting for the bus GPS tracker') : t('Waiting for the first GPS fix')}</small>
              </div>
              <div className="drive-stats">
                <div><b className="tabular">{Math.round(shown?.speedKmh ?? 0)}</b><span>km/h</span></div>
                <div><b className="tabular">{elapsed}</b><span>on trip</span></div>
                {useTracker ? <div><b>{trackerReporting ? t('Live') : 'Off'}</b><span>bus GPS</span></div> : <div><b className="tabular">{counts.accepted}</b><span>fixes sent</span></div>}
              </div>
            </>
          ) : (
            <>
              <span className="route-card-label">{t('Before you start')}</span>
              <ul className="runs">
                <li><span>{t('Direction')}</span><b className="small-b">{t(DIRECTION_PATH[direction])}</b></li>
                <li><span>{t('First stop')}</span><b className="small-b">{ordered[0]?.name ?? '…'}</b></li>
                {direction === 'UP' && <li><span>{t('Departs')}</span><b className="tabular">{route?.departure_time ?? '—'}</b></li>}
              </ul>
            </>
          )}

          {trip && <span className="route-card-label">{t(DIRECTION_TEXT[trip.direction])}</span>}
          <div className="route-live">
            <span className={`pulse ${trip ? (transmitting || standby ? '' : 'delayed') : 'offline'}`} />
            <span>{statusText}</span>
          </div>
          {trip?.started_by === 'tracker' && <p className="muted">{t('This trip was started automatically by the bus GPS tracker.')}</p>}

          <div className={`tracker-line${busGps && !tracker ? ' none' : ''}`}>
            <span><Icon name="signal" size={14} /> {t('Bus GPS tracker')}</span>
            {!busGps ? <Badge tone="offline">Checking…</Badge> : !tracker ? <Badge tone="danger">{t('Not fitted')}</Badge> : !tracker.active ? <Badge tone="danger">Disabled</Badge> : trackerReporting ? <Badge tone="live">{t('Reporting')}</Badge> : tracker.online ? <Badge tone="delayed">{t('Online, no fix')}</Badge> : <Badge tone="delayed">Offline</Badge>}
            <small>{tracker ? `${tracker.label ?? tracker.uniqueId} · last heard ${ago(tracker.lastSeenAt)}` : busGps ? (useTracker ? t('Ask the transport office to fit one.') : t('This phone shares the location instead.')) : ''}</small>
          </div>
          {useTracker && trip && !trackerReporting && <button type="button" className="btn light inline" onClick={() => pickSource('gps')}><Icon name="phone" size={14} /> {t('Use phone GPS as backup')}</button>}
          <div className="drive-settings">
            {!trip && (
              <label>
                <span>{t('This trip')}</span>
                <select value={direction} onChange={(e) => setPicked(e.target.value)}>
                  {DIRECTIONS.map((d) => <option key={d} value={d}>{t(DIRECTION_TEXT[d])}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>{t('Location')}</span>
              <select value={source} onChange={(e) => pickSource(e.target.value)}>
                <option value="tracker">{t('Bus GPS tracker')}</option>
                <option value="gps">{tracker ? t('Phone GPS (backup)') : t('Phone GPS')}</option>
                {demo && <option value="simulate">Simulate along route</option>}
              </select>
            </label>
            {!useTracker && (
              <label>
                <span>{t('Send every')}</span>
                <select value={intervalS} onChange={(e) => setIntervalS(Number(e.target.value))}>
                  {[5, 10, 15].map((s) => <option key={s} value={s}>{s} s</option>)}
                </select>
              </label>
            )}
          </div>
          {gpsError && <p className="error">{gpsError}</p>}
          {error && <p className="error">{error}</p>}

          {trip ? (
            <button className="btn end-trip" onClick={endTrip}><Icon name="x" size={18} /> {t('End trip')}</button>
          ) : (
            <>
              <button className="btn start-trip" onClick={startTrip} disabled={!route}><Icon name="arrow" size={18} /> {t('Start trip')}</button>
              {phoneOnly && <p className="muted small auto-start-hint">{t('Forgot to press Start? The trip starts by itself when the bus leaves the depot.')}{autoWait ? ` (${t(autoWait)})` : ''}</p>}
            </>
          )}
          {trip?.started_by === 'auto' && <p className="muted small">{t('This trip started by itself when the bus left the depot.')}</p>}
        </section>

        {trip && (
          <div className="panel">
            <h3><Icon name="users" size={17} className="panel-icon" />{t('Crowd level after this stop')}</h3>
            <div className="occupancy-row">
              {Object.entries(OCCUPANCY).map(([k, o]) => (
                <button key={k} className={`occ ${o.tone} ${occupancy === k ? 'on' : ''}`} onClick={() => tapOccupancy(k)}>{o.label}</button>
              ))}
            </div>
          </div>
        )}

        {trip && (
          <div className="panel">
            <h3><Icon name="qr" size={17} className="panel-icon" />{t('Boarding code')}</h3>
            <BoardingCode token={token} />
          </div>
        )}
        <ViewList label="Driver tools">
          <PreTripCheck token={token} />
          <PassScanner token={token} tripRunning={Boolean(trip)} />
          <StudentList token={token} tripId={trip?.id ?? null} />
          {trip && <BoardedList token={token} tripId={trip.id} />}
          <FuelEntry token={token} />
          <FoundItem token={token} />
        </ViewList>
        <ProblemTiles token={token} disabled={!trip} />

        {demo && trip && (
          <details className="panel">
            <summary><b>Test server validation</b></summary>
            <p className="muted">Sends one invalid fix. The server must reject it and keep the bus position unchanged.</p>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => sendBadFix('zero')}>0,0 fix</button>
              <button className="btn ghost" onClick={() => sendBadFix('jump')}>12 km jump</button>
              <button className="btn ghost" onClick={() => sendBadFix('accuracy')}>900 m accuracy</button>
              <button className="btn ghost" onClick={() => sendBadFix('future')}>Future time</button>
            </div>
          </details>
        )}

        {demo && (
        <details className="panel">
          <summary><b>Transmission log</b></summary>
          {log.length === 0 && <p className="muted">{t('Start a trip to begin sending locations.')}</p>}
          <ul className="tx-log">
            {log.map((l, i) => (
              <li key={i} className={l.ok ? 'ok' : 'bad'}>
                <time>{l.at.toLocaleTimeString()}</time>
                <span>{l.fix ? `${l.fix.lat.toFixed(5)}, ${l.fix.lng.toFixed(5)}` : ''}</span>
                <b>{l.text}</b>
                {l.label && <em>{l.label}</em>}
              </li>
            ))}
          </ul>
        </details>
        )}
      </section>

      <section className="map-wrap">
        <MapContainer center={[route?.stops[0]?.lat ?? 12.8737, route?.stops[0]?.lng ?? 80.0823]} zoom={13} className="map">
          <BaseTiles />
          {route && <Polyline positions={route.stops.map((s) => [s.lat, s.lng])} pathOptions={{ color: 'var(--chart-navy)', weight: 5, opacity: 0.75 }} />}
          {route?.stops.map((s) => (
            <CircleMarker key={s.seq} center={[s.lat, s.lng]} radius={5} pathOptions={{ color: 'var(--chart-navy)', weight: 2, fillColor: '#f7bc31', fillOpacity: 1 }} />
          ))}
          {shown && (
            <CircleMarker center={[shown.lat, shown.lng]} radius={11} pathOptions={{ color: '#fff', weight: 3, fillColor: 'var(--chart-green)', fillOpacity: 1 }} />
          )}
          <FitRoute route={route} />
          <Follow position={shown} />
        </MapContainer>
      </section>
    </main>
  );
}
