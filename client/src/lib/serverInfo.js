import { useEffect, useState } from 'react';
import { api } from './api.js';

// What the server says about itself (/api/health), fetched once per page load:
// demoMode shows the demo accounts and demo tools; outside it they are hidden.
let pending = null;

export function useServerInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    pending ??= api('/api/health').catch(() => { pending = null; return null; });
    pending.then((v) => { if (live) setInfo(v); });
    return () => { live = false; };
  }, []);
  return info;
}
