import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from './api.js';
import { freshnessOf } from './rules.js';

/** Current time, refreshed every `ms` so "updated x s ago" labels keep moving. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Load data on mount and whenever `deps` change; `reload()` fetches again.
 * Returns { data, error, loading, reload, setData }.
 */
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (n === seq.current) setData(result);
    } catch (err) {
      if (n === seq.current) setError(err);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Wrap an action: tracks busy state and the last error / success message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await fn();
      if (success) setMessage(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, message, run, setError, setMessage };
}

/** Pull-to-refresh over several useAsync results. */
export function useRefresh(...loaders) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(loaders.filter(Boolean).map((l) => l.reload?.() ?? l()));
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, loaders);
  return { refreshing, onRefresh };
}

/**
 * Live buses on one route (or all routes), kept current over the socket.
 * Returns { buses, denied, ready, connected }.
 */
export function useLive(token, routeCode, enabled = true) {
  const [byId, setById] = useState({});
  const [denied, setDenied] = useState(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const now = useNow(5000);

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket(token);
    const subscribe = () => socket.emit('subscribe', { route: routeCode || null });
    const onConnect = () => { setConnected(true); subscribe(); };
    const onDisconnect = () => setConnected(false);
    const onSnapshot = (list) => { setReady(true); setDenied(null); setById(Object.fromEntries(list.map((b) => [b.busId, b]))); };
    const onDenied = ({ code }) => { setReady(true); setDenied(code); setById({}); };
    const onLocation = (b) => setById((prev) => (!routeCode || b.routeCode === routeCode ? { ...prev, [b.busId]: b } : prev));
    const onEnded = ({ busId }) => setById((prev) => { const n = { ...prev }; delete n[busId]; return n; });
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('snapshot', onSnapshot);
    socket.on('live:denied', onDenied);
    socket.on('bus:location', onLocation);
    socket.on('bus:trip-ended', onEnded);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
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
  return { buses, denied, ready, connected };
}
