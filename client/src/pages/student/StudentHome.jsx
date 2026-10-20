import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { date, dateTime, etaText, OCCUPANCY, time } from '../../lib/format.js';
import { dailyRuns, formatMinutes, greeting } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { useLive } from '../../lib/useLive.js';
import Icon from '../../components/Icon.jsx';
import RouteMiniMap from '../../components/RouteMiniMap.jsx';
import SelectRoute from '../../components/SelectRoute.jsx';
import { Badge, ErrorText, Field, FoldPanel, Modal, Notice } from '../../components/ui.jsx';
import { haversineMeters } from '../../../../shared/geo.js';
import { estimateArrival, LEAVE_ALERT_M, leavePlan } from '../../../../shared/eta.js';
import { ageLabel } from '../../../../shared/freshness.js';

/** The emerald route card: which route, the two daily runs, and the live bus. */
function RouteCard({ routes, route, routeCode, setRouteCode, stopSeq, bus, eta, entitled, loading }) {
  const runs = dailyRuns(route, stopSeq);
  return (
    <section className="route-card">
      <label className="route-pick">
        <Icon name="bus" size={20} />
        <select value={routeCode} onChange={(e) => setRouteCode(e.target.value)} aria-label="Route">
          {routes.map((r) => <option key={r.code} value={r.code}>Route no. {r.code} · {r.name}</option>)}
        </select>
        <Icon name="down" size={18} />
      </label>
      <span className="route-card-label">Next bus time</span>
      <ul className="runs">
        {!route && [0, 1].map((i) => <li key={i}><span className="line-skeleton" /><span className="line-skeleton short" /></li>)}
        {runs.map((r) => (
          <li key={r.key} className={r.next ? 'next' : r.done ? 'done' : ''}>
            <span>{r.label}</span>
            <b className="tabular">{formatMinutes(r.minutes)}</b>
          </li>
        ))}
      </ul>
      <div className="route-live">
        {loading ? (
          <><span className="pulse offline" /> Checking live status…</>
        ) : !entitled ? (
          <><Icon name="shield" size={15} /> Live position and arrival estimate come with the ₹60 subscription.</>
        ) : bus ? (
          <>
            <span className={`pulse ${bus.freshness}`} />
            <span>{bus.fleetCode} · {bus.freshness === 'offline' ? 'offline' : eta?.passed ? 'passed your stop' : `arrives in ${etaText(eta)}`}</span>
          </>
        ) : (
          <><Icon name="clock" size={15} /> No bus running on this route right now.</>
        )}
      </div>
    </section>
  );
}

/** Map preview with "Tap to track" (live tracking opens the full map). */
function MapPreview({ route, buses, stopSeq, entitled, loading }) {
  return (
    <section className="map-card">
      <span className="map-chip">Route {route?.code ?? ''} map</span>
      <RouteMiniMap route={route} buses={entitled ? buses : []} highlightSeq={stopSeq} />
      <div className="map-card-bar">
        <span><Icon name="bus" size={17} /> {loading ? 'Checking buses…' : entitled ? `${buses.length} bus${buses.length === 1 ? '' : 'es'} available` : 'Live tracking locked'}</span>
        {!loading && <a className="btn light inline" href={entitled ? '#/map' : '#/pay'}>{entitled ? 'Tap to track' : 'Subscribe'}</a>}
      </div>
    </section>
  );
}

/** "Bus contact": who is driving, and a number to call (doc 4.3). */
function BusContact({ bus, route }) {
  return (
    <section className="contact-card">
      <span className="route-card-label">Bus contact</span>
      {bus ? (
        <div className="contact-row">
          <span className="contact-avatar">{(bus.driverName ?? 'D').replace(/^(Mr|Mrs|Ms)\.?\s*/i, '').slice(0, 1)}</span>
          <span className="contact-text"><b>{bus.driverName ?? 'Driver'}</b><small>{bus.fleetCode} · Route {bus.routeCode}</small></span>
          {bus.occupancy && <Badge tone={OCCUPANCY[bus.occupancy].tone}>{OCCUPANCY[bus.occupancy].label}</Badge>}
        </div>
      ) : (
        <div className="contact-row">
          <span className="contact-avatar"><Icon name="bus" size={18} /></span>
          <span className="contact-text"><b>{route ? `BSACIST-${route.code}` : 'Your bus'}</b><small>Driver details appear when the trip starts</small></span>
        </div>
      )}
      <a className="contact-row call" href="tel:+914422751347">
        <span className="contact-avatar"><Icon name="phone" size={17} /></span>
        <span className="contact-text"><b>Transport office</b><small>+91 44 2275 1347</small></span>
        <Icon name="arrow" size={16} />
      </a>
    </section>
  );
}

function AlertsPreview({ token, entitled }) {
  const { data } = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const items = (data ?? []).slice(0, 3);
  return (
    <FoldPanel
      icon="bell"
      title="Notifications"
      summary={data == null ? 'Loading…' : data.length ? data[0].title : "You're all caught up"}
      badge={data?.length ? <Badge tone="info">{data.length > 9 ? '9+' : data.length}</Badge> : null}
    >
      {data == null ? <div className="skeleton-block short" /> : items.length === 0 ? <p className="muted">You're all caught up.</p> : (
        <ul className="feed">
          {items.map((n, i) => (
            <li key={n.id} className={i === 0 ? 'hot' : n.kind !== 'ANNOUNCEMENT' ? 'warn' : ''}>
              <span className="feed-icon"><Icon name={n.kind === 'ANNOUNCEMENT' ? 'bell' : 'alert'} size={15} /></span>
              <span><b>{n.title}</b><small>{n.message}</small><time>{dateTime(n.created_at)}</time></span>
            </li>
          ))}
        </ul>
      )}
      <a className="link" href="#/alerts">See all notifications →</a>
    </FoldPanel>
  );
}

/** What the boarding question is and when it comes (server/boarding.js), folded. */
function BoardingInfo({ user, stop }) {
  const on = user.boardingReminders;
  return (
    <FoldPanel
      icon="bus"
      title="Boarding check"
      summary={on ? `Asked when your bus leaves ${stop?.name ?? 'your stop'}` : 'Switched off'}
      badge={<Badge tone={on ? 'live' : 'offline'}>{on ? 'On' : 'Off'}</Badge>}
    >
      {on ? (
        <p className="muted">When your bus's GPS shows it leaving <b>{stop?.name ?? 'your stop'}</b>, you'll get a "Did you board?" popup, repeated every 10 minutes until you answer. "Yes" marks your attendance.</p>
      ) : (
        <p className="muted">You won't be asked when your bus leaves your stop. Turn it on in Settings.</p>
      )}
      <a className="link" href="#/settings">{stop ? 'Change in Settings →' : 'Choose your boarding stop →'}</a>
    </FoldPanel>
  );
}

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const leaveHeadline = (plan) => (plan.leaveInMin <= 0 ? 'Leave now' : `Leave by ${time(plan.leaveAt)}`);
const arrivalRange = (plan) => (time(plan.arriveFrom) === time(plan.arriveTo) ? time(plan.arriveFrom) : `${time(plan.arriveFrom)} – ${time(plan.arriveTo)}`);

function Toggle({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`leave-switch${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }} />;
}

/**
 * "When to leave home", from the bus's live GPS. Within 2 km of the stop it is
 * a prominent card; further away a compact one with a switch that alerts the
 * student when the bus reaches 2 km. Clicking either opens the details.
 */
function LeaveHome({ plan, bus, stop, armed, onArm, onOpen }) {
  if (!bus) {
    return (
      <div className="leave-card" style={{ cursor: 'default' }}>
        <div className="leave-card-row">
          <span className="kit-fold-icon"><Icon name="clock" size={17} /></span>
          <span className="leave-card-text"><b>When to leave home</b><small>Appears once your bus starts its trip and its GPS is live.</small></span>
        </div>
      </div>
    );
  }
  if (!plan) return null;
  if (plan.state === 'passed') {
    return (
      <div className="leave-card" style={{ cursor: 'default' }}>
        <div className="leave-card-row">
          <span className="kit-fold-icon"><Icon name="check" size={17} /></span>
          <span className="leave-card-text"><b>Your bus has passed {stop?.name ?? 'your stop'}</b><small>{bus.fleetCode} · check the schedule for the next run</small></span>
        </div>
      </div>
    );
  }
  if (plan.state === 'near') {
    return (
      <button type="button" className="leave-card near" onClick={onOpen}>
        <span className="leave-eyebrow"><i className="pulse" /> Bus is {km(plan.distanceM)} from {stop?.name ?? 'your stop'}</span>
        <span className="leave-big">{leaveHeadline(plan)}</span>
        <span className="leave-sub">{plan.leaveInMin > 0 ? `In ${plan.leaveInMin} min · ` : ''}bus arrives {arrivalRange(plan)} · {plan.walkMin} min walk{plan.walkAssumed ? ' (assumed)' : ''}</span>
        <span className="leave-more">Details →</span>
      </button>
    );
  }
  return (
    <div className="leave-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="leave-card-row">
        <span className="kit-fold-icon"><Icon name="clock" size={17} /></span>
        <span className="leave-card-text"><b>When to leave home</b><small>Bus is {km(plan.distanceM)} away · arrives about {time(plan.arriveTo)}</small></span>
        <Icon name="arrow" size={16} />
      </div>
      <div className="leave-card-arm">
        <span>{armed ? `On: you'll be alerted when the bus is ${km(LEAVE_ALERT_M)} away` : `Alert me when the bus is ${km(LEAVE_ALERT_M)} away`}</span>
        <Toggle on={armed} onChange={onArm} label="Alert me when the bus is 2 km away" />
      </div>
    </div>
  );
}

/** Everything behind the leave-home estimate, live from the bus GPS. */
function LeaveDetails({ plan, bus, stop, me, onLocate, armed, onArm, onClose, locError }) {
  return (
    <Modal title="When to leave home" onClose={onClose} width={520}>
      {plan && plan.state !== 'passed' ? (
        <div className="kit-stack" style={{ gap: 14 }}>
          <div className={`leave-hero${plan.state === 'near' ? ' near' : ''}`}>
            <b>{leaveHeadline(plan)}</b>
            <span className="muted">{plan.leaveInMin > 0 ? `In ${plan.leaveInMin} min. ` : ''}Leave {plan.walkMin} min before the bus's earliest arrival so you are at the stop first.</span>
          </div>
          <dl className="kit-kv">
            <div><dt>Your stop</dt><dd>{stop?.name ?? '—'}</dd></div>
            <div><dt>Bus</dt><dd>{bus.fleetCode} · GPS {ageLabel(bus.recordedAt)}</dd></div>
            <div><dt>Distance</dt><dd>{km(plan.distanceM)} along the route · {plan.stopsRemaining} stop{plan.stopsRemaining === 1 ? '' : 's'} away</dd></div>
            <div><dt>Arrives</dt><dd>{arrivalRange(plan)}{plan.confidence === 'low' ? ' (weak signal)' : ''}</dd></div>
            <div><dt>Walk</dt><dd>{plan.walkAssumed ? `${plan.walkMin} min (assumed)` : `${plan.walkMin} min from your location`}</dd></div>
          </dl>
          {!me && <button className="btn ghost inline" onClick={onLocate}><Icon name="pin" size={14} /> Use my location for the walk</button>}
          <ErrorText>{locError}</ErrorText>
          <div className="leave-card-arm" style={{ borderTop: 0, paddingTop: 0 }}>
            <span>Alert me when the bus is {km(LEAVE_ALERT_M)} from my stop</span>
            <Toggle on={armed} onChange={onArm} label="Alert me when the bus is 2 km away" />
          </div>
        </div>
      ) : (
        <p className="muted">{plan?.state === 'passed' ? 'Your bus has already passed your stop.' : 'No live bus on your route yet. This fills in once the trip starts.'}</p>
      )}
      <div className="btn-row spaced"><button className="btn ghost inline" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/** Missing or delayed bus, lost and found, SOS - free for everyone (doc 4.3, 8.4). */
function ReportProblem({ token, user, onClose }) {
  const [kind, setKind] = useState('DELAY');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const send = async (k = kind) => {
    setError(null);
    try {
      await api('/api/problems', { token, body: { kind: k, message: message || undefined, routeCode: user.homeRouteCode ?? undefined } });
      setDone(k === 'SOS' ? 'SOS sent to the transport office and campus security.' : 'Reported to the transport office. Thank you.');
      setMessage('');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title="Report a problem" onClose={onClose}>
      <Field label="What happened">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="DELAY">Bus delayed</option>
          <option value="MISSING_BUS">Bus did not come</option>
          <option value="LOST_AND_FOUND">Lost and found</option>
          <option value="OTHER">Something else</option>
        </select>
      </Field>
      <Field label="Details"><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" /></Field>
      <Notice>{done}</Notice>
      <ErrorText>{error}</ErrorText>
      <button className="btn dark" onClick={() => send()}>Send report</button>
      <button className="btn danger" onClick={() => window.confirm('Send an SOS to the transport office and campus security?') && send('SOS')}>Send SOS</button>
    </Modal>
  );
}

export default function StudentHome() {
  const { token, user, entitlement } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [routeCode, setRouteCode] = useState(user?.homeRouteCode ?? '');
  const [reporting, setReporting] = useState(false);
  const [me, setMe] = useState(null);
  const [locError, setLocError] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const alertedTrip = useRef(null);
  useEffect(() => { if (user?.homeRouteCode) setRouteCode(user.homeRouteCode); }, [user?.homeRouteCode]);
  const route = useAsync(() => (routeCode ? api(`/api/routes/${encodeURIComponent(routeCode)}`) : Promise.resolve(null)), [routeCode]);
  const entitled = Boolean(entitlement?.active);
  const { buses } = useLive(token, routeCode, entitled && Boolean(routeCode));

  // The 2 km alert: once per trip, when the bus first comes within range of the stop.
  const homeStop = route.data?.stops.find((st) => st.seq === user?.homeStopSeq);
  const liveBus = buses.find((b) => b.freshness !== 'offline') ?? null;
  const liveEta = liveBus && route.data && homeStop && routeCode === user?.homeRouteCode ? estimateArrival(route.data.stops, liveBus, homeStop.seq, route.data.segmentMinutes) : null;
  const nearNow = liveEta && !liveEta.passed && liveEta.remainingM <= LEAVE_ALERT_M;
  useEffect(() => {
    if (!armed || !nearNow || !liveBus || alertedTrip.current === liveBus.tripId) return;
    alertedTrip.current = liveBus.tripId;
    navigator.vibrate?.([250, 120, 250]);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Time to leave for your bus', { body: `${liveBus.fleetCode} is ${km(liveEta.remainingM)} from ${homeStop.name}.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, nearNow, liveBus?.tripId]);

  if (!user) return null;
  if (!user.homeRouteCode) {
    return <main className="page app-page"><SelectRoute /></main>;
  }

  const isHome = routeCode === user.homeRouteCode;
  const stopSeq = isHome ? user.homeStopSeq : route.data?.stops[0]?.seq;
  const stop = route.data?.stops.find((s) => s.seq === stopSeq);
  const bus = buses.find((b) => b.freshness !== 'offline') ?? buses[0] ?? null;
  const eta = bus && route.data && stopSeq ? estimateArrival(route.data.stops, bus, stopSeq, route.data.segmentMinutes, { segmentSource: route.data.segmentsLearned ? 'segment-history' : 'timetable' }) : null;
  const walk = me && stop ? haversineMeters(me, stop) : null;
  const plan = leavePlan(eta, { walkMeters: walk });
  const arm = (on) => {
    setArmed(on);
    if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  };
  const locate = () => {
    setLocError(null);
    if (!navigator.geolocation) return setLocError('This browser cannot share your location.');
    navigator.geolocation.getCurrentPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setLocError('Location permission is needed to work out your walk to the stop.'),
    );
  };
  const first = user.name.replace(/^(Mr|Mrs|Ms)\.?\s*/i, '').split(' ')[0];

  return (
    <main className="page app-page">
      <header className="app-greet">
        <div>
          <span className="greet-sub">{greeting()},</span>
          <h1>{first}</h1>
          <span className="greet-meta"><Icon name="pin" size={14} /> {stop ? `${stop.name} · Route ${route.data.code}` : route.data ? 'Choose your stop in Settings' : `Route ${user.homeRouteCode} · ${user.homeRouteName ?? ''}`}</span>
        </div>
        <a className="bell" href="#/alerts" aria-label="Notifications"><Icon name="bell" size={20} /></a>
      </header>

      {entitlement && !entitled && (
        <a className="upsell" href="#/pay">
          <Icon name="sparkle" size={18} />
          <span><b>Unlock live tracking for ₹60 a month</b><small>Live bus, arrival estimates, alerts and automatic attendance</small></span>
          <Icon name="arrow" size={16} />
        </a>
      )}
      {entitled && entitlement.inGrace && (
        <a className="upsell warn" href="#/pay">
          <Icon name="alert" size={18} />
          <span><b>Your subscription has expired</b><small>Access continues until {date(entitlement.graceEndsOn)}. Renew now.</small></span>
          <Icon name="arrow" size={16} />
        </a>
      )}

      <div className="app-grid">
        <div className="app-col">
          <RouteCard routes={routes.data ?? []} route={route.data} routeCode={routeCode} setRouteCode={setRouteCode} stopSeq={stopSeq} bus={bus} eta={eta} entitled={entitled} loading={entitlement == null} />
          {entitled && isHome && <LeaveHome plan={plan} bus={bus} stop={stop} armed={armed} onArm={arm} onOpen={() => setLeaveOpen(true)} />}
          <a className="btn indigo" href="#/schedule"><Icon name="list" size={17} /> View bus schedule</a>
          <MapPreview route={route.data} buses={buses} stopSeq={stopSeq} entitled={entitled} loading={entitlement == null} />
        </div>
        <div className="app-col">
          <BusContact bus={entitled ? bus : null} route={route.data} />
          <BoardingInfo user={user} stop={isHome ? stop : null} />
          <AlertsPreview token={token} entitled={entitled} />
          <div className="quick-actions">
            <a href="#/attendance"><span><Icon name="check" size={20} /></span>Attendance</a>
            {entitlement?.required
              ? <a href="#/pay"><span><Icon name="card" size={20} /></span>Subscription</a>
              : <a href="#/alerts"><span><Icon name="bell" size={20} /></span>Alerts</a>}
            <button onClick={() => setReporting(true)}><span><Icon name="alert" size={20} /></span>Report</button>
            <a href="#/settings"><span><Icon name="settings" size={20} /></span>Settings</a>
          </div>
        </div>
      </div>
      {reporting && <ReportProblem token={token} user={user} onClose={() => setReporting(false)} />}
      {leaveOpen && <LeaveDetails plan={plan} bus={bus} stop={stop} me={me} onLocate={locate} armed={armed} onArm={arm} onClose={() => setLeaveOpen(false)} locError={locError} />}
    </main>
  );
}
