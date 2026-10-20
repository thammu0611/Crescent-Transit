import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { longDate, nowMinutes, parseTime, prettyTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import Icon from '../../components/Icon.jsx';

/**
 * The route timetable as a schedule (reference design): a dark date header with
 * the route picker, the morning run stop by stop with the bus's live position
 * marked "Active", and the evening run from campus.
 */
export default function Schedule() {
  const { token, user, entitlement } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  useEffect(() => { if (!code && routes.data?.length) setCode(routes.data[0].code); }, [routes.data, code]);
  const route = useAsync(() => (code ? api(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const { buses } = useLive(token, code, Boolean(entitlement?.active && code));
  const bus = buses.find((b) => b.freshness !== 'offline');
  const here = bus?.nearestStop?.seq;
  const mine = code === user?.homeRouteCode ? user?.homeStopSeq : null;
  const now = nowMinutes();
  const stops = route.data?.stops ?? [];
  // The next stop in the timetable, used when no bus is live.
  const nextSeq = stops.find((s) => (parseTime(s.scheduled_time) ?? -1) >= now)?.seq;

  return (
    <main className="page app-page">
      <header className="app-title">
        <a href="#/" className="back" aria-label="Back"><Icon name="back" size={18} /></a>
        <h1>Schedule</h1>
      </header>
      <a className="btn indigo" href="#/map"><Icon name="pin" size={17} /> View bus stoppage points</a>

      <section className="schedule-card">
        <div className="schedule-head">
          <span>{longDate()}</span>
          <label className="route-pill">
            <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Route">
              {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>Route {r.code}</option>)}
            </select>
            <Icon name="down" size={16} />
          </label>
        </div>
        <div className="schedule-body">
          <span className="leg">{route.data?.start_point ?? '…'} to Campus</span>
          {route.data == null ? <div className="skeleton-block" /> : (
            <ol className="timeline">
              {stops.map((s) => {
                const active = bus ? s.seq === here : s.seq === nextSeq;
                return (
                  <li key={s.seq} className={`${active ? 'active' : ''} ${s.seq === mine ? 'mine' : ''} ${bus && here && s.seq < here ? 'passed' : ''}`}>
                    <time className="tabular">{prettyTime(s.scheduled_time)}</time>
                    <span className="stop-name">
                      {s.name}
                      {active && <em>{bus ? 'Bus here' : 'Next'}</em>}
                      {s.seq === mine && <em className="you">Your stop</em>}
                    </span>
                    <span className="bus-tag">Bus {route.data.code}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <span className="leg">Campus to {route.data?.start_point ?? '…'}</span>
          <ol className="timeline">
            <li className={parseTime(route.data?.evening_departure) >= now ? 'active' : ''}>
              <time className="tabular">{prettyTime(route.data?.evening_departure)}</time>
              <span className="stop-name">Departs BSACIST campus<small>Stops in reverse order; evening stop times are not printed in the timetable.</small></span>
              <span className="bus-tag">Bus {route.data?.code}</span>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
