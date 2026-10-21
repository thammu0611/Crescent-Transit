import { useCallback, useEffect, useRef, useState } from 'react';

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
