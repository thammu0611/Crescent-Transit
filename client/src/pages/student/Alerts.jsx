import { useMemo, useState } from 'react';
import { isUnread as unreadIn, studentAlerts, unreadCount as countUnread } from '../../../../shared/alerts.js';
import Icon from '../../components/Icon.jsx';
import { Badge, ErrorText } from '../../components/ui.jsx';
import { markAlertsRead, useAlertsRead } from '../../lib/alertsRead.js';
import { api } from '../../lib/api.js';
import { time } from '../../lib/format.js';
import { formatMinutes, parseTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { usePolling } from '../../lib/usePolling.js';

// Longer than this, a closed card shows two lines and "Read more".
const LONG = 90;

/** Click or Enter/Space opens a card; links and buttons inside it keep their own action. */
const opener = (onOpen) => ({
  role: 'button',
  tabIndex: 0,
  onClick: (e) => { if (!e.target.closest('a, button')) onOpen(); },
  onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } },
});

// Filters by what the notice is about, not by who sent it.
const FILTERS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'delays', label: 'Delays', kinds: ['DELAY', 'BREAKDOWN'] },
  { key: 'attendance', label: 'Attendance', kinds: ['ATTENDANCE'] },
  { key: 'news', label: 'Announcements', kinds: ['ANNOUNCEMENT', 'ROUTE_CHANGE'] },
  { key: 'safety', label: 'Safety', kinds: ['EMERGENCY'] },
];
const LOOK = {
  DELAY: { icon: 'clock', tone: 'amber' },
  BREAKDOWN: { icon: 'alert', tone: 'amber' },
  ROUTE_CHANGE: { icon: 'route', tone: 'blue' },
  ANNOUNCEMENT: { icon: 'bell', tone: 'blue' },
  EMERGENCY: { icon: 'shield', tone: 'violet' },
  ATTENDANCE: { icon: 'check', tone: 'green' },
};
const METHOD = { GPS: 'Phone GPS', QR: 'Bus QR code', MANUAL: 'Marked by staff', BEACON: 'Beacon', STOP: 'Boarding check' };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const delayOf = (n) => Number(String(n.message ?? n.title).match(/(\d+)\s*min/)?.[1]) || null;
const dayKey = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Repeated delay updates for one route on one day become a single thread: the
 * latest update first, then a short timeline of the earlier ones.
 */
function group(items) {
  const out = [];
  const threads = new Map();
  for (const n of items) {
    if (n.kind === 'DELAY' && n.route_code) {
      const k = `${n.route_code}|${dayKey(n.created_at)}`;
      const t = threads.get(k);
      if (t) { t.updates.push(n); continue; }
      const thread = { id: `t${n.id}`, thread: true, latest: n, updates: [n], created_at: n.created_at };
      threads.set(k, thread);
      out.push(thread);
    } else {
      out.push({ id: n.id, thread: false, latest: n, updates: [n], created_at: n.created_at });
    }
  }
  return out;
}

function Thread({ item, unread, stopName, stopTime, onRead }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const toggle = () => { setFull((f) => !f); if (unread) onRead(item.updates.map((u) => String(u.id))); };
  const n = item.latest;
  const all = item.updates;
  const shown = open ? all : all.slice(0, 3);
  const late = delayOf(n);
  const at = stopTime != null && late != null ? formatMinutes(stopTime + late) : null;
  return (
    <article className={`ntf-card ntf-thread${full ? ' open' : ''}`} aria-expanded={full} {...opener(toggle)}>
      <div className="ntf-top">
        <span className="ntf-icon amber"><Icon name="clock" size={20} /></span>
        <div className="ntf-text">
          <b>{late ? `Bus ${n.route_code} delayed by ${late} min` : n.title}</b>
          <small>Updated {time(n.created_at)} · Route {n.route_code}{all.length > 1 ? ` · ${all.length} updates` : ''}</small>
        </div>
        {unread ? <span className="ntf-dot" aria-label="Unread" /> : null}
      </div>
      <div className="ntf-chips">
        <Badge tone="delayed">{late ? `Delayed ${late} min` : 'Delayed'}</Badge>
        {at ? <Badge tone="info">At your stop {at}</Badge> : null}
      </div>
      <p className="ntf-body">{stopName ? `Affects ${stopName}. ` : ''}{n.message}</p>
      {String(n.message ?? '').length > LONG && <span className="ntf-more">{full ? 'Show less' : 'Read more'}</span>}
      {all.length > 1 ? (
        <ol className="ntf-updates">
          {shown.map((u, k) => (
            <li key={u.id} className={k === 0 ? 'latest' : ''}>
              <i />
              <time className="tabular">{time(u.created_at)}</time>
              <span>{delayOf(u) ? `+${delayOf(u)} min` : u.message}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="ntf-actions">
        {all.length > 3 ? <button type="button" onClick={() => setOpen((o) => !o)}>{open ? 'Show fewer updates' : `Show ${all.length - 3} earlier updates`}</button> : <span />}
        <a href="#/map">Track bus <Icon name="arrow" size={16} /></a>
      </div>
    </article>
  );
}

function Single({ n, unread, onRead }) {
  const look = LOOK[n.kind] ?? LOOK.ANNOUNCEMENT;
  const [full, setFull] = useState(false);
  const toggle = () => { setFull((f) => !f); if (unread) onRead([String(n.id)]); };
  return (
    <article className={`ntf-card ntf-single${full ? ' open' : ''}`} aria-expanded={full} {...opener(toggle)}>
      <span className={`ntf-icon ${look.tone}`}><Icon name={look.icon} size={20} /></span>
      <div className="ntf-text">
        <div className="ntf-line"><b>{n.title}</b><time>{time(n.created_at)}</time>{unread ? <span className="ntf-dot" aria-label="Unread" /> : null}</div>
        <p className="ntf-body">{n.message}</p>
        {String(n.message ?? '').length > LONG && <span className="ntf-more">{full ? 'Show less' : 'Read more'}</span>}
      </div>
    </article>
  );
}

/** Notifications, as in the phone app: grouped delay threads, filters, day headers and unread dots. */
export default function Alerts() {
  const { token, entitlement, user } = useSession();
  const entitled = Boolean(entitlement?.active);
  const list = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  // Attendance marks become notices too ("Marked present · to campus").
  const marks = useAsync(() => (entitled ? api(`/api/attendance/me?month=${thisMonth()}`, { token }) : Promise.resolve(null)), [token, entitled]);
  const home = useAsync(() => (user?.homeRouteCode ? api(`/api/routes/${encodeURIComponent(user.homeRouteCode)}`) : Promise.resolve(null)), [user?.homeRouteCode]);
  const myStop = home.data?.stops?.find((x) => x.seq === user?.homeStopSeq);
  const read = useAlertsRead(token);
  const [filter, setFilter] = useState('all');
  const [markError, setMarkError] = useState(null);
  // New alerts arrive while the page is open.
  usePolling(() => { list.reload(); marks.reload(); }, 60000);

  const all = useMemo(() => studentAlerts(list.data, marks.data?.records, METHOD), [list.data, marks.data]);
  const isUnread = (n) => unreadIn(n, read);
  const unreadCount = countUnread(all, read);
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
  const items = group(kinds ? all.filter((n) => kinds.includes(n.kind)) : all);
  const count = (f) => (f.kinds ? all.filter((n) => f.kinds.includes(n.kind)).length : all.length);
  const mark = (body) => {
    setMarkError(null);
    markAlertsRead(token, body).catch((err) => setMarkError(`Could not mark as read: ${err.message}`));
  };
  const markRead = () => mark({ all: true });
  const readOne = (ids) => mark({ ids });

  let lastDay = null;
  return (
    <main className="page app-page ntf">
      <header className="app-title">
        <a href="#/" className="back" aria-label="Back"><Icon name="back" size={18} /></a>
        <h1>Notifications</h1>
        {unreadCount > 0 && <button className="clear" onClick={markRead}>Mark all read</button>}
      </header>
      <div className="ntf-filters" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button type="button" key={f.key} role="tab" aria-selected={f.key === filter} className={f.key === filter ? 'on' : ''} onClick={() => setFilter(f.key)}>
            {f.label} <span>{count(f)}</span>
          </button>
        ))}
      </div>
      <ErrorText>{markError}</ErrorText>
      {!entitled && <p className="muted">Showing the notice board. Route alerts (delays, breakdowns, route changes) come with the subscription.</p>}
      {list.data == null ? (
        <div className="ntf-list"><div className="skeleton-block" /><div className="skeleton-block short" /></div>
      ) : items.length === 0 ? (
        <div className="ntf-empty">
          <span className="ntf-icon blue big"><Icon name={filter === 'safety' ? 'shield' : 'bell'} size={30} /></span>
          <h3>{filter === 'safety' ? 'No safety alerts' : "You're all caught up"}</h3>
          <p className="muted">{filter === 'safety' ? 'If there is a safety notice for your route or campus, it shows here straight away.' : 'New alerts for your route will appear here.'}</p>
        </div>
      ) : (
        <div className="ntf-list">
          {items.map((it) => {
            const day = dayLabel(it.created_at);
            const head = day !== lastDay;
            lastDay = day;
            const mineRoute = it.latest.route_code === user?.homeRouteCode;
            return (
              <div key={it.id} className="ntf-item">
                {head ? <h2 className="ntf-day">{day}</h2> : null}
                {it.thread
                  ? <Thread item={it} unread={it.updates.some(isUnread)} stopName={mineRoute ? myStop?.name : null} stopTime={mineRoute ? parseTime(myStop?.scheduled_time) : null} onRead={readOne} />
                  : <Single n={it.latest} unread={isUnread(it.latest)} onRead={readOne} />}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
