import { useState } from 'react';
import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import Icon from '../components/Icon.jsx';
import { Empty, ErrorText, Panel } from '../components/ui.jsx';

/** A panel that shows only its title and a count until it is opened. */
function Fold({ title, icon, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`panel fold${open ? ' open' : ''}`}>
      <button type="button" className="fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h3>{icon && <Icon name={icon} size={17} className="panel-icon" />}{title}</h3>
        {count != null && <span className="fold-count">{count}</span>}
        <Icon name="down" size={18} className="fold-chevron" />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

/**
 * The free view (doc 8.4): route list, stops and timetable, the notice board
 * and emergency contacts - for everyone, signed in or not, paid or not.
 */
export function FreeView({ showRoutes = true }) {
  const routes = useAsync(() => api('/api/routes'), []);
  const notices = useAsync(() => api('/api/notices'), []);
  const contacts = useAsync(() => api('/api/contacts'), []);
  const [open, setOpen] = useState(null);
  const route = useAsync(() => (open ? api(`/api/routes/${encodeURIComponent(open)}`) : Promise.resolve(null)), [open]);

  return (
    <div className="cols">
      <div className="col">
        <Fold title="Notice board" icon="bell" count={notices.data?.length}>
          {notices.data?.length ? (
            <ul className="notice-list">
              {notices.data.map((n) => (
                <li key={n.id}><b>{n.title}</b><span>{n.message}</span><time>{date(n.created_at)}</time></li>
              ))}
            </ul>
          ) : <Empty>No notices.</Empty>}
        </Fold>
        <Panel title="Emergency contacts" icon="phone">
          <ul className="contact-list">
            {(contacts.data ?? []).map((c) => <li key={c.label}><span>{c.label}</span><a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a></li>)}
          </ul>
        </Panel>
      </div>
      {showRoutes && (
        <div className="col">
          <Fold title="Routes and timetable" icon="route" count={routes.data?.length}>
            <ErrorText>{routes.error?.message}</ErrorText>
            <ul className="route-list">
              {(routes.data ?? []).map((r) => (
                <li key={r.code}>
                  <button className={`route-row${open === r.code ? ' on' : ''}`} onClick={() => setOpen(open === r.code ? null : r.code)} aria-expanded={open === r.code}>
                    <span className="route-code">{r.code}</span>
                    <span>{r.name}<small>{r.stop_count} stops · departs {r.departure_time} · {r.bus_type ?? 'bus'}</small></span>
                  </button>
                  {open === r.code && route.data && (
                    <ol className="timetable">
                      {route.data.stops.map((s) => <li key={s.seq}><span>{s.name}</span><time>{s.scheduled_time}</time></li>)}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </Fold>
        </div>
      )}
    </div>
  );
}

const FEATURES = [
  ['map', 'emerald', 'Live tracking', 'Every bus on the map, updated every few seconds, with Live, Delayed and Offline shown honestly.'],
  ['clock', 'indigo', 'Arrival estimates', 'A range, not a guess: “7–11 min” to your stop, and when to leave home.'],
  ['check', 'red', 'Automatic attendance', 'Your phone and the bus travel together; confirm with one tap. No location is ever stored.'],
  ['bell', 'dark', 'Boarding reminders', 'When your bus leaves your stop, “Did you board?” pops up — and reminds you every 10 minutes until you answer.'],
];

const STEPS = [
  ['route', 'Choose your route', 'Pick your bus and your boarding stop once. Change it any time.'],
  ['map', 'Track it live', 'See your bus move, how far it is, and when it reaches your stop.'],
  ['check', 'Confirm with one tap', '“Are you on Bus 118?” — tap Yes and your attendance is recorded.'],
];

/** A still picture of the student app, drawn with the app's own styles. */
function PhonePreview() {
  return (
    <div className="phone-stage" aria-hidden="true">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <div className="pv-greet">
            <span>Good morning,</span>
            <b>Thameem</b>
            <em><Icon name="pin" size={11} /> Akkarai · Route 119</em>
          </div>
          <div className="route-card pv-card">
            <div className="route-pick static">
              <Icon name="bus" size={16} />
              <span className="pick-text"><b>Route no. 119</b><small>Kovalam via ECR</small></span>
              <Icon name="down" size={14} />
            </div>
            <span className="route-card-label">Next bus time</span>
            <ul className="runs">
              <li className="next"><span>Akkarai → Campus</span><b>07:18 AM</b></li>
              <li><span>Campus → Akkarai</span><b>04:30 PM</b></li>
            </ul>
            <div className="route-live"><span className="pulse" /> BSACIST-119 · arrives in 7–11 min</div>
          </div>
          <div className="btn indigo pv-btn"><Icon name="list" size={14} /> View bus schedule</div>
          <ul className="feed">
            <li className="hot">
              <span className="feed-icon"><Icon name="bus" size={13} /></span>
              <span><b>Bus 119 is 1 km away from you</b><small>Leave in 4 min · walk 320 m</small></span>
            </li>
          </ul>
          <div className="pv-actions">
            {[['check', 'Attendance'], ['bell', 'Alerts'], ['alert', 'Report'], ['settings', 'Settings']].map(([icon, label]) => (
              <span key={label}><i><Icon name={icon} size={14} /></i>{label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="float-card fc-1"><span className="fc-icon ok"><Icon name="check" size={16} /></span><span><b>Attendance marked</b><small>Bus 119 · 07:19 AM</small></span></div>
      <div className="float-card fc-2"><span className="fc-icon"><Icon name="clock" size={16} /></span><span><b>7–11 min</b><small>to your stop</small></span></div>
    </div>
  );
}

export default function PublicHome() {
  const routes = useAsync(() => api('/api/routes'), []);
  const health = useAsync(() => api('/api/health'), []);
  const stops = (routes.data ?? []).reduce((n, r) => n + r.stop_count, 0);
  const toRoutes = () => document.getElementById('routes')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing land">
      <section className="land-hero">
        <div className="land-inner">
          <div className="land-copy">
            <span className="pill-badge"><span className="pulse" /> {health.data ? `${health.data.liveBuses} buses on trip right now` : 'Live bus tracking'}</span>
            <h1>Know where your bus is. <span className="em">Every minute.</span></h1>
            <p>
              Live positions for every BSACIST bus, arrival estimates for your stop, alerts, and attendance that marks itself.
              Routes, stops and timings are free for everyone.
            </p>
            <div className="land-cta">
              <a className="btn dark" href="#/login">Sign in or register <Icon name="arrow" size={16} /></a>
              <button className="btn soft" onClick={toRoutes}><Icon name="route" size={16} /> Routes &amp; timetable</button>
            </div>
            <div className="land-stats">
              <div><b className="tabular">{routes.data?.length ?? '—'}</b><span>routes</span></div>
              <div><b className="tabular">{stops || '—'}</b><span>boarding points</span></div>
            </div>
          </div>
          <PhonePreview />
        </div>
      </section>

      <div className="page land-body">
        <div className="feature-grid">
          {FEATURES.map(([icon, tone, title, text]) => (
            <div key={title} className="feature">
              <span className={`feature-icon ${tone}`}><Icon name={icon} size={22} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>

        <section className="how">
          <span className="section-kicker">How it works</span>
          <h2>From your stop to campus in three steps</h2>
          <ol className="steps">
            {STEPS.map(([icon, title, text], i) => (
              <li key={title}>
                <span className="step-n">{i + 1}</span>
                <span className="step-icon"><Icon name={icon} size={20} /></span>
                <b>{title}</b>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="routes" className="free-section">
          <span className="section-kicker">Free for everyone</span>
          <h2>Routes, notices and contacts</h2>
          <FreeView />
        </section>

        <footer className="land-foot">
          <span><Icon name="bus" size={15} /> Crescent Transit · B.S. Abdur Rahman Crescent Institute of Science &amp; Technology</span>
          <span>Transport office <a href="tel:+914422751347">+91 44 2275 1347</a></span>
        </footer>
      </div>
    </div>
  );
}
