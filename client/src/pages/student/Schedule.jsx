import { useEffect, useMemo, useState } from 'react';
import { estimateArrival } from '../../../../shared/eta.js';
import { dayText } from '../../components/DayBanner.jsx';
import Icon from '../../components/Icon.jsx';
import { Badge } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { etaText } from '../../lib/format.js';
import { formatMinutes, nowMinutes, parseTime, prettyTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import { useNow } from '../../lib/useNow.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const moved = (text, shift) => {
  const t = parseTime(text);
  return shift && t != null ? formatMinutes(t + shift) : prettyTime(text);
};

/** This week, Monday first. */
function week() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { key: iso(d), dow: DOW[d.getDay()], n: d.getDate(), weekend: d.getDay() === 0 || d.getDay() === 6, today: iso(d) === iso(today) };
  });
}

/** One stop on the timeline: time, a dot on the line, the stop's name and its chips. */
function Stop({ time, name, kind, first, last, busBetween, chips, lineDone, lineBus }) {
  return (
    <li className={`sch-row ${kind}${busBetween ? ' has-bus' : ''}`}>
      <time className="sch-time tabular">{time}</time>
      <span className="sch-rail" aria-hidden="true">
        <span className={`sch-line${first ? ' none' : lineDone ? ' done' : ''}`} />
        <span className="sch-dot" />
        <span className={`sch-line grow${last ? ' none' : lineBus ? ' bus' : lineDone ? ' done' : ''}`} />
      </span>
      <span className="sch-main">
        <span className="sch-name">{name}</span>
        {chips ? <span className="sch-chips">{chips}</span> : null}
        {busBetween ? <span className="sch-bus"><Icon name="bus" size={14} />{busBetween}</span> : null}
      </span>
    </li>
  );
}

/**
 * The route timetable, as in the phone app: direction switch (to / from
 * campus), the week, and the stops as a timeline with your stop, the live bus
 * and its arrival estimate.
 */
export default function Schedule() {
  const { token, user, entitlement } = useSession();
  const days = useMemo(week, []);
  const [dayKey, setDayKey] = useState(days.find((d) => d.today)?.key ?? days[0].key);
  const [dir, setDir] = useState(nowMinutes() >= 13 * 60 ? 'down' : 'up');
  const cal = useAsync(() => api('/api/calendar'), []);
  const routes = useAsync(() => api('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  useEffect(() => { if (!code && routes.data?.length) setCode(routes.data[0].code); }, [routes.data, code]);
  const route = useAsync(() => (code ? api(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const { buses } = useLive(token, code, Boolean(entitlement?.active && code));
  const now = useNow(15000);

  const r = route.data;
  const special = [cal.data?.today, ...(cal.data?.upcoming ?? [])].find((d) => d?.day === dayKey) ?? null;
  const isToday = days.find((d) => d.key === dayKey)?.today;
  const bus = isToday && dir === 'up' ? buses.find((b) => b.freshness !== 'offline' && b.routeCode === code) : null;
  const here = bus?.nearestStop?.seq;
  const mine = code === user?.homeRouteCode ? user?.homeStopSeq : null;
  const stops = r?.stops ?? [];
  const eta = bus && mine && r ? estimateArrival(stops, bus, mine, r.segmentMinutes, { now, segmentSource: r.segmentsLearned ? 'segment-history' : 'timetable' }) : null;
  const arrive = r ? formatMinutes((parseTime(r.departure_time) ?? 0) + (r.duration_minutes ?? 0) + (special?.morning_shift ?? 0)) : '—';
  const morning = moved(r?.departure_time, special?.morning_shift);
  const evening = moved(r?.evening_departure, special?.evening_shift);
  const nextSeq = isToday && !bus ? stops.find((s) => (parseTime(s.scheduled_time) ?? -1) >= nowMinutes())?.seq : null;

  // The rows for the chosen direction.
  let rows = [];
  if (r && dir === 'up') {
    rows = stops.map((s, i) => {
      const passed = Boolean(here && s.seq <= here);
      const chips = [];
      if (s.seq === mine) {
        chips.push(<Badge key="m" tone="info">Your stop</Badge>);
        if (eta && !eta.passed) chips.push(<Badge key="e" tone="live">Bus in {etaText(eta)}</Badge>);
        else if (eta?.passed) chips.push(<Badge key="e" tone="offline">Bus has passed</Badge>);
      }
      if (s.seq === nextSeq && s.seq !== mine) chips.push(<Badge key="n" tone="info">Next</Badge>);
      return {
        key: s.seq, time: moved(s.scheduled_time, special?.morning_shift), name: s.name,
        kind: s.seq === mine ? 'mine' : passed ? 'passed' : 'up', chips: chips.length ? chips : null,
        busBetween: bus && s.seq === here ? `Bus ${code} is between here and the next stop` : null,
        lineDone: Boolean(here && s.seq <= here) && i > 0, lineBus: Boolean(bus && s.seq === here),
      };
    });
    rows.push({ key: 'campus', time: arrive, name: `Campus · ${r.end_point ?? 'BSACIST'}`, kind: 'end' });
  } else if (r) {
    rows = [{ key: 'campus', time: evening, name: `Campus · ${r.end_point ?? 'BSACIST'}`, kind: 'end' },
      ...[...stops].reverse().map((s) => ({ key: s.seq, time: '', name: s.name, kind: s.seq === mine ? 'mine' : 'up', chips: s.seq === mine ? [<Badge key="m" tone="info">Your stop</Badge>] : null }))];
  }

  return (
    <main className="page app-page sch">
      <header className="sch-head">
        <h1>Schedule</h1>
        <a className="btn ghost" href="#/map"><Icon name="map" size={17} /> Stops on map</a>
      </header>

      <div className="sch-dir" role="tablist" aria-label="Direction">
        <button type="button" role="tab" aria-selected={dir === 'up'} className={dir === 'up' ? 'on' : ''} onClick={() => setDir('up')}>To campus · {morning}</button>
        <button type="button" role="tab" aria-selected={dir === 'down'} className={dir === 'down' ? 'on' : ''} onClick={() => setDir('down')}>From campus · {evening}</button>
      </div>

      <div className="sch-week" role="listbox" aria-label="Day">
        {days.map((d) => (
          <button type="button" key={d.key} role="option" aria-selected={d.key === dayKey} aria-label={`${d.dow} ${d.n}${d.today ? ', today' : ''}`}
            className={`sch-day${d.key === dayKey ? ' on' : ''}${d.weekend ? ' weekend' : ''}${d.today ? ' today' : ''}`} onClick={() => setDayKey(d.key)}>
            <span>{d.dow}</span>
            <b>{d.n}</b>
          </button>
        ))}
      </div>

      {special ? (
        <div role="alert" className={`sch-special${special.no_service ? ' off' : ''}`}>
          <Icon name="clock" size={18} />
          <span><b>{special.title}</b><small>{dayText(special)}{special.note ? ` · ${special.note}` : ''}</small></span>
        </div>
      ) : null}

      {r == null ? (
        <section className="sch-card" aria-busy="true" aria-label="Loading timetable">
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="sch-skel"><span /><i /><span /></div>)}
        </section>
      ) : (
        <section className="sch-card" aria-label={`Route ${r.code} stops`}>
          <div className="sch-card-head">
            <p>Route {r.code} · {r.name}</p>
            <label className="sch-change">
              Change
              <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Route">
                {(routes.data ?? []).map((x) => <option key={x.code} value={x.code}>Route {x.code} · {x.name}</option>)}
              </select>
            </label>
          </div>
          {special?.no_service ? (
            <div className="sch-empty">
              <Icon name="clock" size={26} />
              <b>No buses this day</b>
              <span>{special.title}. Pick another day to see the timetable.</span>
            </div>
          ) : (
            <ol className="sch-list">
              {rows.map((row, i) => <Stop key={row.key} {...row} first={i === 0} last={i === rows.length - 1} />)}
            </ol>
          )}
          {dir === 'down' && !special?.no_service ? <p className="sch-note">The evening bus stops in reverse order. Times for each stop are not printed in the timetable.</p> : null}
        </section>
      )}
    </main>
  );
}
