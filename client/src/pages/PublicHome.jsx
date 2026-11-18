import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import Icon from '../components/Icon.jsx';

/** The transport office and emergency numbers, one tap to call. */
function Contacts() {
  const contacts = useAsync(() => api('/api/contacts'), []);
  return (
    <ul className="contact-tiles">
      {(contacts.data ?? []).map((c) => (
        <li key={c.label}>
          <a href={`tel:${c.phone.replace(/\s/g, '')}`}>
            <span className="contact-avatar"><Icon name="phone" size={17} /></span>
            <span className="contact-text"><b>{c.label}</b><small>{c.phone}</small></span>
            <Icon name="arrow" size={16} />
          </a>
        </li>
      ))}
    </ul>
  );
}

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
        </div>
      </div>
      <div className="float-card fc-1"><span className="fc-icon ok"><Icon name="check" size={16} /></span><span><b>Attendance marked</b><small>Bus 119 · 07:19 AM</small></span></div>
      <div className="float-card fc-2"><span className="fc-icon"><Icon name="clock" size={16} /></span><span><b>7–11 min</b><small>to your stop</small></span></div>
    </div>
  );
}

export default function PublicHome() {
  return (
    <div className="landing land">
      <section className="land-hero">
        <div className="land-inner">
          <div className="land-copy">
            <h1>Know where your bus is. <span className="em">Every minute.</span></h1>
            <p className="land-lede">One stop for every BSACIST</p>
            {/* Sign in and Sign up sit together, side by side. */}
            <div className="land-cta">
              <a className="btn dark" href="#/login">Sign in <Icon name="arrow" size={16} /></a>
              <a className="btn soft land-register" href="#/register"><Icon name="plus" size={16} /> Sign up</a>
            </div>
          </div>
          <PhonePreview />
        </div>
      </section>

      <div className="page land-body">
        <section className="land-contacts">
          <h2>Need help?</h2>
          <Contacts />
        </section>

        <footer className="land-foot">
          <span>Crescent Transit · B.S. Abdur Rahman Crescent Institute of Science &amp; Technology</span>
        </footer>
      </div>
    </div>
  );
}
