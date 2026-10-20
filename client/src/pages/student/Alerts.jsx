import { useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';

const KEY = 'ubts.alertsCleared';
const readCleared = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};

/** Notifications (reference design): newest highlighted, "Clear all" hides what you've read. */
export default function Alerts() {
  const { token, entitlement } = useSession();
  const entitled = Boolean(entitlement?.active);
  const { data } = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const [cleared, setCleared] = useState(readCleared);
  const items = (data ?? []).filter((n) => new Date(n.created_at).getTime() > cleared);
  const clear = () => {
    const t = Date.now();
    try { localStorage.setItem(KEY, String(t)); } catch { /* per-tab only */ }
    setCleared(t);
  };

  return (
    <main className="page app-page">
      <header className="app-title">
        <a href="#/" className="back" aria-label="Back"><Icon name="back" size={18} /></a>
        <h1>Notifications</h1>
        {items.length > 0 && <button className="clear" onClick={clear}>Clear all</button>}
      </header>
      {!entitled && <p className="muted">Showing the notice board. Route alerts (delays, breakdowns, route changes) come with the subscription.</p>}
      {data == null ? <div className="skeleton-block" /> : items.length === 0 ? (
        <div className="empty-hero">
          <span className="hero-badge"><Icon name="bell" size={26} /></span>
          <h3>You're all caught up</h3>
          <p className="muted">New alerts for your route will appear here.</p>
        </div>
      ) : (
        <ul className="feed big">
          {items.map((n, i) => (
            <li key={n.id} className={i === 0 ? 'hot' : n.kind !== 'ANNOUNCEMENT' ? 'warn' : ''}>
              <span className="feed-icon"><Icon name={n.kind === 'ANNOUNCEMENT' ? 'bell' : n.kind === 'ROUTE_CHANGE' ? 'route' : 'alert'} size={16} /></span>
              <span>
                <b>{n.title}</b>
                <small>{n.message}</small>
                <time>{dateTime(n.created_at)}{n.route_code ? ` · Route ${n.route_code}` : ''}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
