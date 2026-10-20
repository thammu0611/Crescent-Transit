import { useEffect, useMemo, useState } from 'react';
import { getSocket } from './api.js';
import { useNow } from './useNow.js';
import { freshnessOf } from '../../../shared/freshness.js';

/**
 * Live buses on one route (or all routes), kept current over the socket.
 * Returns { buses, denied, ready } - denied is set when the server refuses live data
 * (no subscription / not signed in), so the screen can show the free view.
 */
export function useLive(token, routeCode, enabled = true) {
  const [byId, setById] = useState({});
  const [denied, setDenied] = useState(null);
  const [ready, setReady] = useState(false); // true once the first snapshot (or refusal) arrives
  const now = useNow(5000);

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket(token);
    const subscribe = () => socket.emit('subscribe', { route: routeCode || null });
    const onSnapshot = (list) => { setReady(true); setDenied(null); setById(Object.fromEntries(list.map((b) => [b.busId, b]))); };
    const onDenied = ({ code }) => { setReady(true); setDenied(code); setById({}); };
    const onLocation = (b) => setById((prev) => (!routeCode || b.routeCode === routeCode ? { ...prev, [b.busId]: b } : prev));
    const onEnded = ({ busId }) => setById((prev) => { const n = { ...prev }; delete n[busId]; return n; });
    socket.on('connect', subscribe);
    socket.on('snapshot', onSnapshot);
    socket.on('live:denied', onDenied);
    socket.on('bus:location', onLocation);
    socket.on('bus:trip-ended', onEnded);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('snapshot', onSnapshot);
      socket.off('live:denied', onDenied);
      socket.off('bus:location', onLocation);
      socket.off('bus:trip-ended', onEnded);
    };
  }, [token, routeCode, enabled]);

  const buses = useMemo(
    () => Object.values(byId).map((b) => ({ ...b, freshness: freshnessOf(b.recordedAt, now) })),
    [byId, now],
  );
  return { buses, denied, ready };
}
