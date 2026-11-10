// What the server says about itself (/api/health), fetched once - as the web
// app's lib/serverInfo.js: demoMode shows the demo accounts and demo tools.
// `undefined` while loading, `null` when the server could not be reached.
import { useEffect, useState } from 'react';
import { api } from './api.js';

let pending = null;

export function useServerInfo() {
  const [info, setInfo] = useState(undefined);
  useEffect(() => {
    let live = true;
    pending ??= api('/api/health').catch(() => { pending = null; return null; });
    pending.then((v) => { if (live) setInfo(v); });
    return () => { live = false; };
  }, []);
  return info;
}

/** Forget the cached answer (after the server address changes). */
export const resetServerInfo = () => { pending = null; };
