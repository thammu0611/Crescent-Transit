import { useEffect, useState } from 'react';
import { api, getSocket } from '../../lib/api.js';
import { METHOD_TEXT, dateTime, time } from '../../lib/format.js';
import { greeting, longDate } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import Icon from '../../components/Icon.jsx';
import RouteMiniMap from '../../components/RouteMiniMap.jsx';
import { Block, ColumnChart, Donut, Figure, HBars, SERIES, dayLabel } from '../../components/adminkit.jsx';
import { Badge, FoldPanel, Segmented, Stat } from '../../components/ui.jsx';

const URGENT = ['SOS', 'EMERGENCY', 'BREAKDOWN', 'CAPACITY_BREACH'];
const titleCase = (k) => k.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const ACTIVITY = {
  trip_started: { icon: 'arrow', color: '#2b8a3e', text: (a) => `Trip started · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  trip_ended: { icon: 'check', color: '#1c315e', text: (a) => `Trip completed · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  incident: { icon: 'alert', color: '#a02022', text: (a) => titleCase(a.who ?? 'Incident'), sub: (a) => [a.fleet_code ?? (a.route_code && `route ${a.route_code}`), a.detail].filter(Boolean).join(' · ') || 'No details given' },
};

/** The transport office's home: fleet now, today's figures, trends and what needs attention. */
export default function Dashboard() {
  const { token } = useSession();
  const kpis = useAsync(() => api('/api/admin/kpis', { token }), [token]);
  const overview = useAsync(() => api('/api/admin/overview?days=7', { token }), [token]);
  const incidents = useAsync(() => api('/api/admin/incidents?status=OPEN', { token }), [token]);
  const trips = useAsync(() => api('/api/admin/trips?status=active', { token }), [token]);
  const { buses, ready } = useLive(token, null, true);
  const [trend, setTrend] = useState('present');

  useEffect(() => {
    const id = setInterval(() => { kpis.reload(); trips.reload(); }, 15000);
    const slow = setInterval(() => overview.reload(), 60000);
    const socket = getSocket(token);
    const onIncident = () => { incidents.reload(); kpis.reload(); overview.reload(); };
    socket.on('incident', onIncident);
    return () => { clearInterval(id); clearInterval(slow); socket.off('incident', onIncident); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const k = kpis.data ?? {};
  const o = overview.data;
  const tot = o?.totals ?? {};
  const counts = buses.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {});
  const idle = Math.max(0, (tot.buses_active ?? 0) - buses.length);
  const open = incidents.data ?? null;
  const series = o?.series?.map((d) => ({ label: dayLabel(d.date), value: d[trend] }));
  const weekTotal = o?.series?.reduce((n, d) => n + d[trend], 0);

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
              <Stat icon="users" label="Students present" value={k.presentToday} tone="live" />
              <Stat icon="card" label="Active passes" value={tot.subscribers} />
              <Stat icon="alert" label="Open incidents" value={k.openIncidents} tone={k.openIncidents ? 'danger' : ''} />
              <Stat icon="check" label="Awaiting review" value={k.awaitingReview} tone={k.awaitingReview ? 'delayed' : ''} />
            </div>
          </div>
        </div>

        <nav className="kit-shortcuts" aria-label="Shortcuts">
          <a className="kit-shortcut" href="#/trips"><span><Icon name="clock" size={18} /></span>Trips</a>
          <a className="kit-shortcut" href="#/attendance"><span><Icon name="check" size={18} /></span>Attendance</a>
          <a className="kit-shortcut" href="#/reports"><span><Icon name="chart" size={18} /></span>Reports</a>
          <a className="kit-shortcut" href="#/notices"><span><Icon name="bell" size={18} /></span>Announce</a>
        </nav>

        <div className="kit-grid-2">
          <Block
            title={trend === 'present' ? 'Riders, last 7 days' : 'Trips, last 7 days'}
            caption={weekTotal == null ? ' ' : `${weekTotal} ${trend === 'present' ? 'students boarded' : 'trips run'} this week`}
            actions={<Segmented value={trend} onChange={setTrend} options={[{ value: 'present', label: 'Riders' }, { value: 'trips', label: 'Trips' }]} />}
          >
            <ColumnChart data={series} color={trend === 'present' ? '#1c315e' : '#2b8a3e'} />
          </Block>
          <Block title="Fleet status" caption="Buses on trip by signal, and active buses waiting" actions={<a className="btn ghost inline" href="#/map"><Icon name="map" size={14} />Fleet map</a>}>
            {ready && o ? (
              <Donut
                caption="buses"
                center={tot.buses_active ?? buses.length}
                segments={[
                  { label: 'Live', value: counts.live ?? 0, color: '#2b8a3e' },
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
          <section className="soft-card">
            <div className="soft-card-head">
              <h3><Icon name="bus" size={17} /> Trips running now</h3>
              <a href="#/trips">All trips</a>
            </div>
            {trips.data == null ? <div className="skeleton-block short" /> : trips.data.length === 0 ? <p className="muted">No trips running.</p> : (
              <ul className="trip-list">
                {trips.data.map((t) => (
                  <li key={t.id}>
                    <span className="route-code">{t.route_code}</span>
                    <span className="trip-main"><b>{t.route_name}</b><small>{t.fleet_code} · {t.driver_name ?? 'No driver'} · since {time(t.started_at)}</small></span>
                    {t.flagged && <Badge tone="danger">{t.flag_reason}</Badge>}
                    <span className="trip-riders"><b className="tabular">{t.attendance}</b><small>riders</small></span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="kit-stack">
            <FoldPanel
              icon="alert"
              title="Needs attention"
              summary={open == null ? 'Loading…' : open.length === 0 && !k.awaitingReview ? 'All quiet on the fleet' : [k.awaitingReview ? `${k.awaitingReview} to review` : null, open.length ? `${open.length} open incident${open.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              badge={open && (open.length + (k.awaitingReview ? 1 : 0)) > 0 ? <Badge tone="danger">{open.length + (k.awaitingReview ?? 0)}</Badge> : null}
            >
              {open == null ? <div className="skeleton-block short" /> : open.length === 0 && !k.awaitingReview ? (
                <p className="muted">Nothing needs attention. All quiet on the fleet.</p>
              ) : (
                <ul className="feed">
                  {k.awaitingReview > 0 && (
                    <li className="hot">
                      <span className="feed-icon"><Icon name="check" size={15} /></span>
                      <span><b>{k.awaitingReview} attendance record{k.awaitingReview === 1 ? '' : 's'} to review</b><small>Provisional records and disputes need a decision.</small><a className="feed-link" href="#/attendance">Review now →</a></span>
                    </li>
                  )}
                  {open.slice(0, 5).map((i) => (
                    <li key={i.id} className={URGENT.includes(i.kind) ? 'urgent' : 'warn'}>
                      <span className="feed-icon"><Icon name={i.kind === 'SOS' ? 'phone' : 'alert'} size={15} /></span>
                      <span>
                        <b>{titleCase(i.kind)}{i.fleet_code ? ` · ${i.fleet_code}` : i.route_code ? ` · route ${i.route_code}` : ''}</b>
                        <small>{i.message ?? 'No details given.'}</small>
                        <time>{i.source}{i.username ? ` ${i.username}` : ''} · {dateTime(i.created_at)}</time>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <a className="link" href="#/notices">See all alerts and incidents →</a>
            </FoldPanel>

            <FoldPanel
              icon="list"
              title="Recent activity"
              summary={o == null ? 'Loading…' : o.activity.length ? `${ACTIVITY[o.activity[0].kind].text(o.activity[0])} · ${dateTime(o.activity[0].at)}` : 'No activity yet'}
            >
              {o == null ? <div className="skeleton-block short" /> : o.activity.length === 0 ? <p className="muted">No activity yet.</p> : (
                <ul className="kit-timeline">
                  {o.activity.map((a, idx) => {
                    const kind = ACTIVITY[a.kind];
                    return (
                      <li key={`${a.kind}-${a.at}-${idx}`}>
                        <span className="kit-timeline-icon" style={{ background: `${kind.color}1f`, color: kind.color }}><Icon name={kind.icon} size={14} /></span>
                        <span><b>{kind.text(a)}</b><small>{kind.sub(a)}</small></span>
                        <time>{dateTime(a.at)}</time>
                      </li>
                    );
                  })}
                </ul>
              )}
            </FoldPanel>
          </div>
        </div>
      </div>
    </main>
  );
}
