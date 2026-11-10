import { useEffect, useState } from 'react';
import { api, getSocket } from '../../lib/api.js';
import { METHOD_TEXT, dateTime, time } from '../../lib/format.js';
import { greeting, longDate } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import Icon from '../../components/Icon.jsx';
import RouteMiniMap from '../../components/RouteMiniMap.jsx';
import { Block, ColumnChart, Donut, Figure, HBars, SERIES, ViewCard, dayLabel } from '../../components/adminkit.jsx';
import { Badge, Empty, ListCard, SearchBox, Segmented, Stat } from '../../components/ui.jsx';

// The four shortcuts, each in its own colour from the site's palette.
const SHORTCUTS = [
  ['#/trips', 'clock', 'Trips', 'Drivers and trip history', 'navy'],
  ['#/attendance', 'check', 'Attendance', 'Bus registers by date', 'green'],
  ['#/reports', 'chart', 'Reports', 'Charts and exports', 'blue'],
  ['#/notices', 'bell', 'Announce', 'Post an alert to riders', 'red'],
];

const titleCase = (k) => k.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const ACTIVITY = {
  trip_started: { icon: 'arrow', color: 'var(--chart-green)', text: (a) => `Trip started · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  trip_ended: { icon: 'check', color: 'var(--chart-navy)', text: (a) => `Trip completed · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  incident: { icon: 'alert', color: 'var(--chart-red)', text: (a) => titleCase(a.who ?? 'Incident'), sub: (a) => [a.fleet_code ?? (a.route_code && `route ${a.route_code}`), a.detail].filter(Boolean).join(' · ') || 'No details given' },
};

/** The transport office's home: fleet now, today's figures, trends, trips running and recent activity. */
export default function Dashboard() {
  const { token } = useSession();
  const kpis = useAsync(() => api('/api/admin/kpis', { token }), [token]);
  const overview = useAsync(() => api('/api/admin/overview?days=7', { token }), [token]);
  const trips = useAsync(() => api('/api/admin/trips?status=active', { token }), [token]);
  const quality = useAsync(() => api('/api/admin/service-quality', { token }), [token]);
  const { buses, ready } = useLive(token, null, true);
  const [trend, setTrend] = useState('present');
  const [tripQuery, setTripQuery] = useState('');
  const [activityQuery, setActivityQuery] = useState('');

  useEffect(() => {
    const id = setInterval(() => { kpis.reload(); trips.reload(); }, 15000);
    const slow = setInterval(() => overview.reload(), 60000);
    const socket = getSocket(token);
    const onIncident = () => { kpis.reload(); overview.reload(); };
    socket.on('incident', onIncident);
    return () => { clearInterval(id); clearInterval(slow); socket.off('incident', onIncident); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const k = kpis.data ?? {};
  const o = overview.data;
  const tot = o?.totals ?? {};
  const counts = buses.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {});
  const idle = Math.max(0, (tot.buses_active ?? 0) - buses.length);
  const series = o?.series?.map((d) => ({ label: dayLabel(d.date), value: d[trend] }));
  const weekTotal = o?.series?.reduce((n, d) => n + d[trend], 0);
  const has = (needle, values) => !needle || values.some((v) => v && String(v).toLowerCase().includes(needle));
  const tripNeedle = tripQuery.trim().toLowerCase();
  const shownTrips = trips.data?.filter((t) => has(tripNeedle, [t.route_code, t.route_name, t.fleet_code, t.driver_name]));
  const activityNeedle = activityQuery.trim().toLowerCase();
  const shownActivity = o?.activity.filter((a) => has(activityNeedle, [ACTIVITY[a.kind].text(a), ACTIVITY[a.kind].sub(a)]));

  return (
    <main className="page app-page wide-app">
      <header className="app-greet">
        <div>
          <span className="greet-sub">{greeting()},</span>
          <h1>Transport office</h1>
          <span className="greet-meta"><Icon name="clock" size={14} /> {longDate()}</span>
        </div>
        <a className="bell" href="#/notices" aria-label="Alerts and incidents">
          <Icon name="bell" size={20} />
          {k.openIncidents > 0 && <span className="dot-count">{k.openIncidents}</span>}
        </a>
      </header>

      <div className="kit-stack">
        <div className="kit-grid-3">
          <section className="kit-fleet">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="kit-fleet-label">FLEET NOW</span>
              <span className="kit-meta" style={{ color: 'rgba(255,255,255,0.8)' }}><i className="pulse" /> Live</span>
            </div>
            <div className="kit-fleet-big">
              <b className="tabular">{ready ? buses.length : '—'}</b>
              <span>buses on trip<small>of {tot.buses ?? '—'} in the fleet</small></span>
            </div>
            <div className="kit-fleet-pills">
              <span><i style={{ background: '#61ce70' }} /> {counts.live ?? 0} live</span>
              <span><i style={{ background: '#b9832a' }} /> {counts.delayed ?? 0} delayed</span>
              <span><i style={{ background: '#8b909b' }} /> {counts.offline ?? 0} offline</span>
            </div>
            <hr />
            <div className="kit-figures light">
              <Figure value={tot.trips_today} label="Trips today" />
              <Figure value={tot.scheduled_today} label="Scheduled" />
              <Figure value={k.onTimePct == null ? '—' : `${k.onTimePct}%`} label="On time" />
            </div>
          </section>

          <div className="kit-stack">
            <div className="kit-stats two">
              <Stat icon="users" label="Present today · Inbound / Outbound" value={`${k.presentUpToday} / ${k.presentDownToday}`} tone="live" />
              <Stat icon="card" label="Active passes" value={tot.subscribers} />
              <Stat icon="alert" label="Open incidents" value={k.openIncidents} tone={k.openIncidents ? 'danger' : ''} />
              <Stat icon="check" label="Awaiting review" value={k.awaitingReview} tone={k.awaitingReview ? 'delayed' : ''} />
              <Stat icon="sparkle" label="Trip rating, 30 days" value={quality.data ? (quality.data.rating == null ? '—' : `${quality.data.rating} / 5`) : null} tone="live" />
              <Stat icon="alert" label="Open complaints" value={quality.data?.open_complaints} tone={quality.data?.open_complaints ? 'danger' : ''} />
            </div>
          </div>
        </div>

        <nav className="kit-shortcuts" aria-label="Shortcuts">
          {SHORTCUTS.map(([href, icon, label, hint, tone]) => (
            <a key={href} className={`kit-shortcut tone-${tone}`} href={href}>
              <span className="ks-icon"><Icon name={icon} size={20} /></span>
              <span className="ks-text"><b>{label}</b><small>{hint}</small></span>
              <span className="ks-go"><Icon name="arrow" size={15} /></span>
            </a>
          ))}
        </nav>

        <div className="kit-grid-2">
          <Block
            title={trend === 'present' ? 'Riders, last 7 days' : 'Trips, last 7 days'}
            caption={weekTotal == null ? ' ' : `${weekTotal} ${trend === 'present' ? 'students boarded' : 'trips run'} this week`}
            actions={<Segmented value={trend} onChange={setTrend} options={[{ value: 'present', label: 'Riders' }, { value: 'trips', label: 'Trips' }]} />}
          >
            <ColumnChart data={series} color={trend === 'present' ? 'var(--chart-navy)' : 'var(--chart-green)'} />
          </Block>
          <Block title="Fleet status" caption="Buses on trip by signal, and active buses waiting" actions={<a className="btn ghost inline" href="#/map"><Icon name="map" size={14} />Fleet map</a>}>
            {ready && o ? (
              <Donut
                caption="buses"
                center={tot.buses_active ?? buses.length}
                segments={[
                  { label: 'Live', value: counts.live ?? 0, color: 'var(--chart-green)' },
                  { label: 'Delayed signal', value: counts.delayed ?? 0, color: '#b9832a' },
                  { label: 'Offline', value: counts.offline ?? 0, color: '#8b909b' },
                  { label: 'Not on trip', value: idle, color: '#d9dee8' },
                ]}
              />
            ) : <div className="skeleton-block short" />}
          </Block>
        </div>

        <div className="kit-grid-2">
          <section className="map-card">
            <span className="map-chip">Live fleet</span>
            <RouteMiniMap buses={buses} labels tall />
            <div className="map-card-bar">
              <span><Icon name="bus" size={17} /> {buses.length} bus{buses.length === 1 ? '' : 'es'} reporting</span>
              <a className="btn light inline" href="#/map">Open fleet map</a>
            </div>
          </section>
          <div className="kit-stack">
            <Block title="How students boarded" caption="Last 7 days, by attendance method">
              {o == null ? <div className="skeleton-block short" /> : o.methods.length === 0 ? <p className="muted">No boardings recorded this week.</p> : (
                <Donut caption="boardings" segments={o.methods.map((m, i) => ({ label: METHOD_TEXT[m.method] ?? m.method, value: m.n, color: SERIES[i % SERIES.length] }))} />
              )}
            </Block>
            <Block title="Busiest routes" caption="Students boarded in the last 7 days">
              <HBars rows={o?.routes} label={(r) => `${r.code} · ${r.name}`} value={(r) => r.riders} />
            </Block>
          </div>
        </div>

        <h2 className="kit-section-title">Operations</h2>
        <div className="kit-stats">
          <Stat icon="signal" label="Avg update delay" value={k.avgUpdateDelayS == null ? '—' : `${k.avgUpdateDelayS}s`} hint="Device time to server time, last hour" />
          <Stat icon="shield" label="GPS rejects today" value={k.gpsFailuresToday} tone={k.gpsFailuresToday ? 'delayed' : ''} />
          <Stat icon="user" label="Active drivers" value={tot.drivers} />
          <Stat icon="route" label="Active routes" value={tot.routes} />
        </div>

        <div className="kit-grid-2 top">
          <ViewCard
            icon="bus"
            title="Trips running now"
            summary={trips.data == null ? 'Loading…' : trips.data.length === 0 ? 'No trips running' : `${trips.data.length} trip${trips.data.length === 1 ? '' : 's'} · ${trips.data.reduce((n, t) => n + (Number(t.attendance) || 0), 0)} riders on board`}
            badge={trips.data?.some((t) => t.flagged) ? <Badge tone="danger">Flagged</Badge> : null}
            actions={<SearchBox value={tripQuery} onChange={setTripQuery} placeholder="Search route, bus or driver" />}
          >
            {shownTrips == null ? <div className="skeleton-block short" /> : shownTrips.length === 0 ? <Empty>{tripNeedle ? 'No trips match.' : 'No trips running.'}</Empty> : (
              <div className="kit-list cols-2">
                {shownTrips.map((t) => (
                  <ListCard
                    key={t.id}
                    href="#/trips"
                    tone={t.flagged ? 'alert' : 'live'}
                    lead={<span className="route-code">{t.route_code}</span>}
                    title={t.route_name}
                    lines={[`${t.fleet_code} · ${t.driver_name ?? 'No driver'}`, t.flagged ? t.flag_reason : `Since ${time(t.started_at)}`]}
                    count={t.attendance}
                    countLabel="RIDERS"
                  />
                ))}
              </div>
            )}
          </ViewCard>

          <ViewCard
            icon="list"
            title="Recent activity"
            summary={o == null ? 'Loading…' : o.activity.length ? `${ACTIVITY[o.activity[0].kind].text(o.activity[0])} · ${dateTime(o.activity[0].at)}` : 'No activity yet'}
            actions={<SearchBox value={activityQuery} onChange={setActivityQuery} placeholder="Search route, bus or person" />}
          >
            {shownActivity == null ? <div className="skeleton-block short" /> : shownActivity.length === 0 ? <Empty>{activityNeedle ? 'No activity matches.' : 'No activity yet.'}</Empty> : (
              <div className="kit-list cols-2">
                {shownActivity.map((a, idx) => {
                  const kind = ACTIVITY[a.kind];
                  return (
                    <ListCard
                      key={`${a.kind}-${a.at}-${idx}`}
                      href={a.kind === 'incident' ? '#/notices' : '#/trips'}
                      lead={<span className="kit-row-icon" style={{ background: `color-mix(in srgb, ${kind.color} 12%, transparent)`, color: kind.color }}><Icon name={kind.icon} size={18} /></span>}
                      title={kind.text(a)}
                      lines={[kind.sub(a), dateTime(a.at)]}
                    />
                  );
                })}
              </div>
            )}
          </ViewCard>
        </div>
      </div>
    </main>
  );
}
