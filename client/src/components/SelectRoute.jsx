import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useAsync } from '../lib/useAsync.js';
import { prettyTime } from '../lib/schedule.js';
import Icon from './Icon.jsx';
import { ErrorText } from './ui.jsx';

/**
 * "Select your route": chosen once, changeable any time in Settings. Every day
 * after that the home screen shows this route's bus.
 */
export default function SelectRoute({ onDone, compact = false }) {
  const { token, user, refresh } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  const [stopSeq, setStopSeq] = useState(user?.homeStopSeq ?? '');
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const route = useAsync(() => (code ? api(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const list = useMemo(
    () => (routes.data ?? []).filter((r) => !q || `${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase())),
    [routes.data, q],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me', { token, method: 'PATCH', body: { homeRouteCode: code, homeStopSeq: stopSeq ? Number(stopSeq) : null } });
      await refresh();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`select-route ${compact ? 'compact' : ''}`}>
      {!compact && (
        <header>
          <span className="hero-badge"><Icon name="route" size={26} /></span>
          <h2>Select your route</h2>
          <p>Choose the route you travel on. Every day you will see where its bus is and when it reaches your stop. You can change it any time.</p>
        </header>
      )}
      <label className="search-box">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search route number or area" aria-label="Search routes" />
      </label>
      <div className="route-tiles" role="radiogroup" aria-label="Routes">
        {list.map((r) => (
          <button key={r.code} role="radio" aria-checked={code === r.code} className={`route-tile ${code === r.code ? 'on' : ''}`} onClick={() => { setCode(r.code); setStopSeq(''); }}>
            <span className="tile-icon"><Icon name="bus" size={20} /></span>
            <b>Route {r.code}</b>
            <small>{r.name}</small>
          </button>
        ))}
      </div>
      {route.data && (
        <div className="route-summary">
          <p className="stops-line">{route.data.stops.map((s) => s.name).join('  ·  ')}</p>
          <label className="field">
            <span>Your boarding stop</span>
            <select value={stopSeq} onChange={(e) => setStopSeq(e.target.value)}>
              <option value="">Choose your stop</option>
              {route.data.stops.map((s) => <option key={s.seq} value={s.seq}>{s.name} · {prettyTime(s.scheduled_time)}</option>)}
            </select>
          </label>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <button className="btn dark" disabled={!code || !stopSeq || busy} onClick={save}>
        {busy ? 'Saving…' : 'Continue'} <Icon name="arrow" size={16} />
      </button>
    </section>
  );
}
