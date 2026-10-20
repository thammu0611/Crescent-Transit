import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import BaseTiles from '../components/BaseTiles.jsx';
import L from 'leaflet';
import BusMarker from '../components/BusMarker.jsx';
import RouteLayer from '../components/RouteLayer.jsx';
import { Badge } from '../components/ui.jsx';
import { api, getSocket } from '../lib/api.js';
import { etaText, OCCUPANCY } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { useNow } from '../lib/useNow.js';
import { ageLabel, freshnessOf } from '../../../shared/freshness.js';
import { estimateArrival } from '../../../shared/eta.js';

const CAMPUS = { lat: 12.8737, lng: 80.0823 };
const STATE_LABEL = { live: 'Live', delayed: 'Delayed', offline: 'Offline' };

const campusIcon = L.divIcon({ className: '', html: '<div class="campus-marker">BSACIST</div>', iconSize: [76, 26], iconAnchor: [38, 13] });

/** Moves the map when the user picks a route or a bus. */
function MapFocus({ route, focusBus }) {
  const map = useMap();
  useEffect(() => {
    if (focusBus) map.flyTo([focusBus.lat, focusBus.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    else if (route?.stops.length) map.flyToBounds(route.stops.map((s) => [s.lat, s.lng]), { padding: [40, 40], duration: 0.8 });
    // Only re-focus when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route?.code, focusBus?.busId]);
  return null;
}

/** What a student without a subscription sees instead of live positions (doc 8.4). */
function Paywall({ reason }) {
  return (
    <div className="panel paywall">
      <h2>Live tracking is for subscribers</h2>
      <p className="muted">
        {reason === 'LOGIN_REQUIRED' ? 'Sign in to see live buses.' : 'Live bus positions, arrival estimates and alerts come with the ₹60 monthly subscription.'}
        {' '}The route list, stops and timetable stay free.
      </p>
      <a className="btn primary inline" href={reason === 'LOGIN_REQUIRED' ? '#/login' : '#/pay'}>{reason === 'LOGIN_REQUIRED' ? 'Sign in' : 'Subscribe for ₹60'}</a>
    </div>
  );
}

export default function LiveMap() {
  const { token, user } = useSession();
  const [routes, setRoutes] = useState([]);
  const [routeCode, setRouteCode] = useState(user?.role === 'student' ? user.homeRouteCode ?? '' : '');
  const [stopSeq, setStopSeq] = useState(user?.role === 'student' ? user.homeStopSeq ?? null : null);
  const [route, setRoute] = useState(null);
  const [buses, setBuses] = useState({}); // busId -> snapshot
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState(null);
  const [error, setError] = useState(null);
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
    const onFreshness = ({ busId, freshness }) =>
      setBuses((prev) => (prev[busId] ? { ...prev, [busId]: { ...prev[busId], freshness } } : prev));
    const onEnded = ({ busId }) =>
      setBuses((prev) => {
        const next = { ...prev };
        delete next[busId];
        return next;
      });

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
  // if this browser misses the server's state-change event.
  const list = useMemo(
    () =>
      Object.values(buses)
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
  };

  return (
    <main className="live-layout">
      <aside className="sidebar">
        {denied ? <Paywall reason={denied} /> : null}
        <div className="panel">
          <div className="panel-row">
            <h2>{user?.role === 'admin' ? 'Fleet' : 'Live buses'}</h2>
            <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
          </div>
          <div className="stat-row">
            <div className="stat"><b>{list.length}</b><span>on trip</span></div>
            <div className="stat live"><b>{counts.live ?? 0}</b><span>live</span></div>
            <div className="stat delayed"><b>{counts.delayed ?? 0}</b><span>delayed</span></div>
            <div className="stat offline"><b>{counts.offline ?? 0}</b><span>offline</span></div>
          </div>
          <label className="field">
            <span>Route</span>
            <select value={routeCode} onChange={(e) => { setRouteCode(e.target.value); setSelectedBusId(null); setStopSeq(null); }}>
              <option value="">All {routes.length} routes</option>
              {routes.map((r) => (
                <option key={r.code} value={r.code}>{r.code} · {r.name}</option>
              ))}
            </select>
          </label>
          {route && (
            <label className="field">
              <span>Estimate arrival at</span>
              <select value={stopSeq ?? ''} onChange={(e) => setStopSeq(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Choose a stop</option>
                {route.stops.map((s) => <option key={s.seq} value={s.seq}>{s.seq}. {s.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="error">{error}</p>}
        </div>

        <ul className="bus-list" aria-live="polite">
          {list.length === 0 && !denied && (
            <li className="empty">
              No bus on this {routeCode ? 'route' : 'network'} is on a trip right now.
              <small>A driver starts a trip from the driver app, or run <code>npm run simulate</code>.</small>
            </li>
          )}
          {list.map((b) => (
            <li key={b.busId}>
              <button className={`bus-card fresh-${b.freshness}${b.busId === selectedBusId ? ' selected' : ''}`} aria-pressed={b.busId === selectedBusId} onClick={() => selectBus(b.busId)}>
                <div className="bus-card-top">
                  <strong>{b.fleetCode}</strong>
                  <span className="btn-row">
                    {b.occupancy && <Badge tone={OCCUPANCY[b.occupancy].tone}>{OCCUPANCY[b.occupancy].label}</Badge>}
                    <Badge tone={b.freshness}>{STATE_LABEL[b.freshness]}</Badge>
                  </span>
                </div>
                <div className="bus-card-route">{b.routeName}</div>
                {stop && b.routeCode === route?.code && (
                  <div className={`eta-line ${b.eta?.confidence ?? 'none'}`}>
                    <span>Estimated arrival at {stop.name}</span>
                    <b className="tabular">{b.freshness === 'offline' ? 'Bus offline' : etaText(b.eta)}</b>
                  </div>
                )}
                <div className="bus-card-meta">
                  <span>Updated {ageLabel(b.recordedAt, now)}</span>
                  <span>{b.freshness === 'offline' ? 'last seen' : `${Math.round(b.speedKmh ?? 0)} km/h`}</span>
                </div>
                {b.nearestStop && (
                  <div className="bus-card-stop">
                    {b.freshness === 'offline' ? 'Last seen near' : 'Near'} <b>{b.nearestStop.name}</b> ({b.nearestStop.distanceM} m)
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        {route && (
          <div className="panel stops">
            <h3>Route {route.code} · {route.stops.length} boarding points</h3>
            <p className="muted">
              {route.bus_type} · {route.capacity} seats · departs {route.departure_time} ·
              ETA from {route.segmentsLearned ? `${route.segmentsLearned} learned segments + timetable` : 'the timetable'}
            </p>
            <ol>
              {route.stops.map((s) => (
                <li key={s.seq} className={`${selected?.nearestStop?.seq === s.seq ? 'here' : ''}${s.seq === stopSeq ? ' mine' : ''}`}>
                  <span>{s.name}{s.geo_source === 'interpolated' && <em> approx.</em>}</span>
                  <time>{s.scheduled_time}</time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      <section className="map-wrap">
        <MapContainer center={[13.0, 80.17]} zoom={11} className="map" preferCanvas={false}>
          <BaseTiles />
          <Marker position={[CAMPUS.lat, CAMPUS.lng]} icon={campusIcon}>
            <Tooltip>B.S. Abdur Rahman Crescent Institute of Science &amp; Technology</Tooltip>
          </Marker>
          <RouteLayer route={route} highlightSeq={stopSeq ?? selected?.nearestStop?.seq} />
          {list.map((b) => (
            <BusMarker key={b.busId} bus={b} selected={b.busId === selectedBusId} onSelect={selectBus} />
          ))}
          <MapFocus route={route} focusBus={selected} />
        </MapContainer>
        <div className="legend">
          <span><i className="dot live" /> Live ≤ 30 s</span>
          <span><i className="dot delayed" /> Delayed ≤ 2 min</span>
          <span><i className="dot offline" /> Offline &gt; 2 min</span>
          <span><i className="dot stop" /> Stop</span>
          <span><i className="dot approx" /> Approx. stop</span>
        </div>
      </section>
    </main>
  );
}
