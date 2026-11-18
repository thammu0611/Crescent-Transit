import { useEffect, useRef } from 'react';

/**
 * Run `fn` every `ms` while the page is on screen. A hidden tab makes no requests,
 * and coming back to the tab (or back online) fetches straight away, so the page
 * never shows minutes-old figures. The data on screen stays while it reloads.
 */
export function usePolling(fn, ms, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let last = Date.now(); // the page has just loaded its data
    const run = () => { last = Date.now(); latest.current(); };
    const id = setInterval(() => { if (!document.hidden) run(); }, ms);
    const back = () => { if (!document.hidden && Date.now() - last > Math.min(ms, 10000)) run(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('online', back);
    };
  }, [ms, enabled]);
}
