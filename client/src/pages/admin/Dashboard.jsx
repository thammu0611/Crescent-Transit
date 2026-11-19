import { useEffect, useState } from 'react';
import { api, getSocket } from '../../lib/api.js';
import { METHOD_TEXT, dateTime, time } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import { usePolling } from '../../lib/usePolling.js';
import GreetHeader from '../../components/GreetHeader.jsx';
import Icon from '../../components/Icon.jsx';
import RouteMiniMap from '../../components/RouteMiniMap.jsx';
import { WeeklyReportBlock } from '../../components/Automations.jsx';
import { Block, ColumnChart, Donut, Figure, HBars, SERIES, ViewCard, ViewList, dayLabel } from '../../components/adminkit.jsx';
import { Badge, Empty, ListCard, SearchBox, Segmented, Stat } from '../../components/ui.jsx';

// Both live lists open the same page, the list of trips: running ones, or all of them.
const RUNNING_TRIPS = '#/trips?tab=trips&status=active';
const ALL_TRIPS = '#/trips?tab=trips';

const titleCase = (k) => k.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const ACTIVITY = {
  trip_started: { icon: 'arrow', color: 'var(--chart-green)', text: (a) => `Trip started · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  trip_ended: { icon: 'check', color: 'var(--chart-navy)', text: (a) => `Trip completed · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  incident: { icon: 'alert', color: 'var(--chart-red)', text: (a) => titleCase(a.who ?? 'Incident'), sub: (a) => [a.fleet_code ?? (a.route_code && `route ${a.route_code}`), a.detail].filter(Boolean).join(' · ') || 'No details given' },
};

/** The transport office's home: fleet now, today's figures, trends, trips running and recent activity. */
export default function Dashboard() {
  const { token, user } = useSession();
  // Expired papers and overdue service, to insist on at the top of the page.
  const care = useAsync(() => api('/api/admin/fleet-care', { token }), [token]);
  const careAlerts = (care.data ?? []).flatMap((b) => [
    ...b.documents.filter((d) => d.state === 'EXPIRED').map((d) => `${b.fleetCode} ${({ INSURANCE: 'insurance', FITNESS: 'fitness', PERMIT: 'permit', PUC: 'PUC' })[d.kind]} expired`),
    ...(b.serviceState === 'DUE' ? [`${b.fleetCode} service overdue`] : []),
  ]);
  const kpis = useAsync(() => api('/api/admin/kpis', { token }), [token]);
  const overview = useAsync(() => api('/api/admin/overview?days=7', { token }), [token]);
  const trips = useAsync(() => api('/api/admin/trips?status=active', { token }), [token]);
  const quality = useAsync(() => api('/api/admin/service-quality', { token }), [token]);
  const { buses, ready } = useLive(token, null, true);
  const [trend, setTrend] = useState('present');
  const [tripQuery, setTripQuery] = useState('');
  const [activityQuery, setActivityQuery] = useState('');

  // Figures refresh on their own while the page is open (not while the tab is hidden).
  usePolling(() => { kpis.reload(); trips.reload(); }, 15000);
  usePolling(() => overview.reload(), 60000);
  useEffect(() => {
    const socket = getSocket(token);
    const onIncident = () => { kpis.reload(); overview.reload(); };
    // A student boarding moves today's figures: reload once things settle, not once per student.
    let soon = null;
    const onBoarding = () => { soon ??= setTimeout(() => { soon = null; kpis.reload(); trips.reload(); }, 2000); };
    socket.on('incident', onIncident);
    socket.on('attendance:changed', onBoarding);
    return () => { clearTimeout(soon); socket.off('incident', onIncident); socket.off('attendance:changed', onBoarding); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const k = kpis.data ?? {};
  const o = overview.data;
  const onBoardNow = trips.data?.reduce((n, t) => n + (Number(t.attendance) || 0), 0);
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
      <GreetHeader
        title="Transport office"
        right={(
          <a className="bell" href="#/notices" aria-label="Alerts and incidents">
            <Icon name="bell" size={20} />
            {(k.openReported ?? k.openIncidents) > 0 && <span className="dot-count">{k.openReported ?? k.openIncidents}</span>}
          </a>
        )}
      />
      {careAlerts.length > 0 && (
        <a className="care-alarm" href="#/care" role="alert">
          <span className="care-alarm-icon"><Icon name="alert" size={20} /></span>
          <span className="care-alarm-text">
            <b>{careAlerts.length} bus{careAlerts.length === 1 ? ' needs' : 'es need'} attention now</b>
            <small>{careAlerts.slice(0, 3).join(' · ')}{careAlerts.length > 3 ? ` · and ${careAlerts.length - 3} more` : ''}</small>
          </span>
          <span className="care-alarm-go">Open Bus care <Icon name="arrow" size={15} /></span>
        </a>
      )}

      <div className="kit-stack">
        <div className="kit-grid-3">
          <section className="kit-fleet">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="kit-fleet-label">FLEET NOW</span>
              <span className="kit-meta" style={{ color: 'rgba(255,255,255,0.8)' }}><i className="pulse" /> Live</span>
            </div>
            <div className="kit-fleet-big">
              <b className="tabular">{ready ? buses.length : '—'}</b>
              <span>buses on trip<small>{`of ${tot.buses ?? '—'} in the fleet`}</small></span>
            </div>
            <div className="kit-fleet-pills">
              <span><i style={{ background: '#61ce70' }} /> {counts.live ?? 0} live</span>
              <span><i style={{ background: '#b9832a' }} /> {counts.delayed ?? 0} delayed</span>
              <span><i style={{ background: '#8b909b' }} /> {counts.offline ?? 0} offline</span>
            </div>
            {/* The buses on the road right now: each opens the fleet map. */}
            <div className='kit-fleet-buses'>
              {ready && buses.length === 0 && <p className='kit-fleet-empty'>No bus is on a trip right now.</p>}
              {[...buses].sort((x, y) => String(x.routeCode).localeCompare(String(y.routeCode), undefined, { numeric: true })).slice(0, 6).map((b) => (
                <a key={b.busId} className={`kit-fleet-bus ${b.freshness}`} href='#/map' title={b.nearestStop?.name ? `Near ${b.nearestStop.name}` : undefined}>
                  <i />
                  <b>{b.routeCode}</b>
                  <span>{b.nearestStop?.name ? `Near ${b.nearestStop.name}` : b.fleetCode}</span>
                  <small className='tabular'>{b.freshness === 'offline' ? 'offline' : `${Math.round(b.speedKmh ?? 0)} km/h`}</small>
                </a>
              ))}
              {buses.length > 6 && <a className='kit-fleet-more' href='#/map'>{`+${buses.length - 6} more on the map`}</a>}
            </div>
            <hr />
            <div className="kit-figures light">
              <Figure value={tot.trips_today} label="Trips today" />
              <Figure value={tot.scheduled_today} label="Scheduled" />
              <Figure value={onBoardNow ?? '—'} label="On board now" />
              <Figure value={k.onTimePct == null ? '—' : `${k.onTimePct}%`} label="On time" />
            </div>
          </section>

          <div className="kit-stack">
            <div className="kit-stats two">
              <Stat icon="users" label="Students boarded today" value={k.presentToday} hint={k.presentToday == null ? undefined : `${k.presentUpToday} to college · ${k.presentDownToday} from college`} tone="live" color="green" />
              <Stat icon="card" label="Active passes" value={tot.subscribers} color="gold" />
              <Stat icon="alert" label={k.openAutomatic ? `Open incidents · ${k.openAutomatic} automatic` : 'Open incidents'} value={k.openReported ?? k.openIncidents} tone={(k.openReported ?? k.openIncidents) ? 'danger' : ''} color="red" />
              <Stat icon="check" label="Awaiting review" value={k.awaitingReview} tone={k.awaitingReview ? 'delayed' : ''} color="violet" />
              <Stat icon="sparkle" label="Trip rating, 30 days" value={quality.data ? (quality.data.rating == null ? 'None yet' : `${quality.data.rating} / 5`) : null} tone="live" color="teal" />
              <Stat icon="alert" label="Open complaints" value={quality.data?.open_complaints} tone={quality.data?.open_complaints ? 'danger' : ''} color="rose" />
            </div>
          </div>
        </div>

        <div className="kit-grid-2">
          <Block
            title={trend === 'present' ? 'Riders, last 7 days' : 'Trips, last 7 days'}
            caption={weekTotal == null ? ' ' : `${weekTotal} ${trend === 'present' ? 'students boarded' : 'trips run'} this week`}
            actions={<Segmented value={trend} onChange={setTrend} options={[{ value: 'present', label: 'Riders' }, { value: 'trips', label: 'Trips' }]} />}
          >
            <ColumnChart data={series} color={trend === 'present' ? 'var(--chart-navy)' : 'var(--chart-green)'} />
          </Block>
          <Block title="Bus tracking status" caption="Active buses by GPS signal, and those not on a trip" actions={<a className="btn ghost inline" href="#/map"><Icon name="map" size={14} />Fleet map</a>}>
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
          <Stat icon="signal" label="Avg update delay" value={k.avgUpdateDelayS == null ? '—' : `${k.avgUpdateDelayS}s`} hint="Device time to server time, last hour" color="teal" />
          <Stat icon="shield" label="GPS rejects today" value={k.gpsFailuresToday} tone={k.gpsFailuresToday ? 'delayed' : ''} color="amber" />
          <Stat icon="user" label="Active drivers" value={tot.drivers} color="violet" />
          <Stat icon="route" label="Active routes" value={tot.routes} color="navy" />
        </div>

        <ViewList label="Live operations">
          <ViewCard
            icon="bus"
            title="Trips running now"
            summary={trips.data == null ? 'Loading…' : trips.data.length === 0 ? 'No trips running' : `${trips.data.length} trip${trips.data.length === 1 ? '' : 's'} · ${onBoardNow} students on board`}
            badge={trips.data?.some((t) => t.flagged) ? <Badge tone="danger">Flagged</Badge> : null}
            actions={<SearchBox value={tripQuery} onChange={setTripQuery} placeholder="Search route, bus or driver" />}
          >
            {shownTrips == null ? <div className="skeleton-block short" /> : shownTrips.length === 0 ? <Empty>{tripNeedle ? 'No trips match.' : 'No trips running.'}</Empty> : (
              <div className="kit-list cols-2">
                {shownTrips.map((t) => (
                  <ListCard
                    key={t.id}
                    href={RUNNING_TRIPS}
                    tone={t.flagged ? 'alert' : 'live'}
                    lead={<span className="route-code">{t.route_code}</span>}
                    title={t.route_name}
                    lines={[`${t.fleet_code} · ${t.driver_name ?? 'No driver'}`, t.flagged ? t.flag_reason : `Since ${time(t.started_at)}`]}
                    count={t.attendance}
                    countLabel="ON BOARD"
                  />
                ))}
              </div>
            )}
            <a className="btn ghost inline kit-see-all" href={RUNNING_TRIPS}>Open the trips list <Icon name="arrow" size={14} /></a>
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
                      href={a.kind === 'incident' ? '#/notices' : ALL_TRIPS}
                      lead={<span className="kit-row-icon soft-tint" style={{ color: kind.color }}><Icon name={kind.icon} size={18} /></span>}
                      title={kind.text(a)}
                      lines={[kind.sub(a), dateTime(a.at)]}
                    />
                  );
                })}
              </div>
            )}
            <a className="btn ghost inline kit-see-all" href={ALL_TRIPS}>Open the trips list <Icon name="arrow" size={14} /></a>
          </ViewCard>
        </ViewList>

        <WeeklyReportBlock />
      </div>
    </main>
  );
}
