import { useEffect, useState } from 'react';
import ChangePassword from '../../components/ChangePassword.jsx';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { refreshPlan } from '../../lib/sampler.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { Badge, ErrorText, Field, FoldPanel, Notice, Page, Panel, Segmented } from '../../components/ui.jsx';

/**
 * The plain-language privacy notice (doc 9.11): what is collected, when, why,
 * for how long, and how to opt out. Shown here and before consent is given.
 */
export function PrivacyNotice() {
  return (
    <div className="privacy">
      <p><b>What:</b> your phone's location, one reading every 20 seconds.</p>
      <p><b>When:</b> only inside your travel window (set below) and only near a bus route. Outside it the app does not ask for your location at all.</p>
      <p><b>Why:</b> to notice that you are on a university bus and ask you, with one tap, to confirm your attendance.</p>
      <p><b>What is kept:</b> never your location. Each reading is compared with the bus and thrown away. What is kept is the attendance record - trip, time, stop, method and confidence - for one academic year, then only as totals.</p>
      <p><b>Who sees it:</b> you, and the transport office as registers. There is no screen anywhere that shows where a student is.</p>
      <p><b>Opting out:</b> withdraw consent here at any time. Your attendance is then taken by the boarding check, the bus QR code or the driver.</p>
    </div>
  );
}

// Travel window presets; '' is the university default (06:00-10:30 and 15:30-19:30).
const WINDOW_PRESETS = [
  { value: '', label: 'University default', hint: 'Morning and evening runs' },
  { value: '06:00-10:30', label: 'Morning only', hint: '06:00 – 10:30' },
  { value: '15:30-19:30', label: 'Evening only', hint: '15:30 – 19:30' },
  { value: 'custom', label: 'Custom', hint: 'Your own hours' },
];
const presetOf = (w) => (WINDOW_PRESETS.some((p) => p.value === (w ?? '')) ? w ?? '' : 'custom');

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** An on/off switch that saves at once. */
function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** One line of a settings section: title and explanation on the left, a control on the right. */
function SettingRow({ icon, title, children, control }) {
  return (
    <div className="setting-row">
      {icon && <span className="setting-icon"><Icon name={icon} size={18} /></span>}
      <div className="setting-text"><b>{title}</b>{children}</div>
      {control && <div className="setting-control">{control}</div>}
    </div>
  );
}

const notificationState = () => ('Notification' in window ? Notification.permission : 'unsupported');

export default function Settings() {
  const { token, user, entitlement, refresh, signOut } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const contacts = useAsync(() => api('/api/contacts'), []);
  const plan = useAsync(() => (token ? api('/api/attendance/plan', { token }) : Promise.resolve(null)), [token, user?.locationConsent, user?.travelWindows]);
  const [form, setForm] = useState(null);
  const route = useAsync(() => (form?.homeRouteCode ? api(`/api/routes/${encodeURIComponent(form.homeRouteCode)}`) : Promise.resolve(null)), [form?.homeRouteCode]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [notify, setNotify] = useState(notificationState);

  useEffect(() => {
    if (user && !form) {
      setForm({
        homeRouteCode: user.homeRouteCode ?? '',
        homeStopSeq: user.homeStopSeq ?? '',
        windowPreset: presetOf(user.travelWindows),
        travelWindows: user.travelWindows ?? '',
        language: user.language ?? 'en',
      });
    }
  }, [user, form]);

  const save = async (patch, done = 'Saved.') => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await api('/api/me', { token, method: 'PATCH', body: patch });
      await refresh();
      await refreshPlan();
      plan.reload();
      setMessage(done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!form || !user) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const stop = route.data?.stops.find((s) => s.seq === Number(form.homeStopSeq));
  const campus = route.data?.stops.at(-1);
  const windows = form.windowPreset === 'custom' ? form.travelWindows.trim() : form.windowPreset;
  const saveTravel = (e) => {
    e.preventDefault();
    save({
      homeRouteCode: form.homeRouteCode || null,
      homeStopSeq: form.homeStopSeq ? Number(form.homeStopSeq) : null,
      travelWindows: windows,
      language: form.language,
    }, 'Travel details saved.');
  };
  const askNotifications = () => {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then((p) => {
      setNotify(p);
      setMessage(p === 'granted' ? 'Notifications are on for this browser.' : 'Notifications are blocked. Allow them in the browser\'s site settings.');
    });
  };
  const p = plan.data;

  return (
    <Page eyebrow="Student" title="Settings" subtitle="Your account, your bus, reminders and privacy - in one place.">
      <section className="settings-hero">
        <span className="settings-avatar" aria-hidden="true">{initials(user.name)}</span>
        <div className="settings-who">
          <h2>{user.name}</h2>
          <p>@{user.username}{user.registerNo ? ` · ${user.registerNo}` : ''}{user.department ? ` · ${user.department}` : ''}</p>
          {user.email && <p className="muted">{user.email}</p>}
        </div>
        <ul className="settings-chips">
          <li><Icon name="route" size={14} /> {user.homeRouteCode ? `Route ${user.homeRouteCode}` : 'No route'}</li>
          <li><Icon name="pin" size={14} /> {stop?.name ?? 'No stop chosen'}</li>
          <li className={user.boardingReminders ? 'on' : ''}><Icon name="bell" size={14} /> Boarding check {user.boardingReminders ? 'on' : 'off'}</li>
          <li className={user.locationConsent ? 'on' : ''}><Icon name="shield" size={14} /> {user.locationConsent ? 'Location consent given' : 'No location consent'}</li>
        </ul>
      </section>

      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>

      <div className="settings-grid">
        <Panel title="1 · Travel" icon="route" className="settings-section">
          <p className="section-lead">Your route and boarding stop drive the home screen, arrival times and the boarding check.</p>
          <form onSubmit={saveTravel}>
            <div className="grid2">
              <Field label="Route">
                <select value={form.homeRouteCode} onChange={(e) => setForm((f) => ({ ...f, homeRouteCode: e.target.value, homeStopSeq: '' }))}>
                  <option value="">—</option>
                  {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
                </select>
              </Field>
              <Field label="Boarding stop">
                <select value={form.homeStopSeq} onChange={set('homeStopSeq')} disabled={!route.data}>
                  <option value="">—</option>
                  {(route.data?.stops ?? []).map((s) => <option key={s.seq} value={s.seq}>{s.seq}. {s.name}{s.scheduled_time ? ` · ${s.scheduled_time}` : ''}</option>)}
                </select>
              </Field>
            </div>
            {stop && (
              <p className="setting-summary">
                <Icon name="clock" size={14} />
                <span>Bus {route.data.code} reaches <b>{stop.name}</b>{stop.scheduled_time ? <> at <b>{stop.scheduled_time}</b></> : ''} and arrives at {campus?.name ?? 'campus'}{campus?.scheduled_time ? ` at ${campus.scheduled_time}` : ''}.</span>
              </p>
            )}
            <Field label="When you travel" hint="The boarding check and phone attendance only work inside these hours.">
              <Segmented value={form.windowPreset} onChange={(v) => setForm((f) => ({ ...f, windowPreset: v }))} options={WINDOW_PRESETS.map(({ value, label }) => ({ value, label }))} />
            </Field>
            {form.windowPreset === 'custom' && (
              <Field label="Custom travel window" hint="e.g. 07:00-09:30,16:00-18:30">
                <input value={form.travelWindows} onChange={set('travelWindows')} placeholder="07:00-09:30,16:00-18:30" />
              </Field>
            )}
            <Field label="Language">
              <select value={form.language} onChange={set('language')}>
                <option value="en">English</option>
                <option value="ta">தமிழ் (Tamil) - saved; translation not yet available</option>
              </select>
            </Field>
            <button className="btn primary" disabled={busy}>Save travel details</button>
          </form>
        </Panel>

        <Panel title="2 · Reminders and notifications" icon="bell" className="settings-section">
          <p className="section-lead">What the app tells you, and how.</p>
          <SettingRow
            icon="bus"
            title="Boarding check"
            control={<Switch on={user.boardingReminders} disabled={busy} label="Boarding check" onChange={(v) => save({ boardingReminders: v }, v ? 'Boarding check is on.' : 'Boarding check is off.')} />}
          >
            <small>When your bus's GPS shows it leaving {stop?.name ?? 'your stop'}, a popup asks "Did you board?". It repeats <b>every 10 minutes until you answer</b>. "Yes" marks your attendance for that trip.</small>
          </SettingRow>
          <SettingRow
            icon="bell"
            title="Browser notifications"
            control={notify === 'granted' ? <Badge tone="live">Allowed</Badge>
              : notify === 'denied' ? <Badge tone="danger">Blocked</Badge>
                : notify === 'unsupported' ? <Badge>Not supported</Badge> : <button className="btn ghost" onClick={askNotifications}>Allow</button>}
          >
            <small>
              Lets the boarding question and reminders reach you while this tab is in the background.
              {notify === 'denied' && ' Allow notifications for this site in your browser\'s settings to turn them on.'}
            </small>
          </SettingRow>
          <SettingRow icon="alert" title="Route alerts">
            <small>Delays, breakdowns and route changes for Route {user.homeRouteCode ?? '—'}, and announcements from the transport office. Always on; see them under Alerts.</small>
          </SettingRow>
        </Panel>

        <Panel title="3 · Attendance and privacy" icon="shield" className="settings-section">
          <p className="section-lead">How your trips are recorded. Pick what you are comfortable with.</p>
          <ul className="method-list">
            <li><Icon name="bus" size={16} /><span className="method-text"><b>Boarding check</b> - from the bus GPS only; your location is never used.</span><Badge tone={user.boardingReminders ? 'live' : 'offline'}>{user.boardingReminders ? 'On' : 'Off'}</Badge></li>
            <li><Icon name="signal" size={16} /><span className="method-text"><b>Phone GPS</b> - your phone notices it is moving with the bus.</span><Badge tone={p?.shouldSample ? 'live' : 'offline'}>{p?.shouldSample ? 'Active now' : user.locationConsent ? 'Paused' : 'Off'}</Badge></li>
            <li><Icon name="qr" size={16} /><span className="method-text"><b>Bus QR code</b> - scan the code on the driver's screen.</span><Badge tone="live">Always</Badge></li>
          </ul>
          {p && user.locationConsent && !p.shouldSample && (
            <p className="setting-summary">
              <Icon name="clock" size={14} />
              <span>Phone GPS is paused: {!p.deviceBound ? 'this phone is not bound yet (open Attendance).' : !p.inTravelWindow ? `outside your travel window (${p.travelWindows}).` : 'waiting for the next check.'}</span>
            </p>
          )}
          <SettingRow
            icon="pin"
            title="Use my location for attendance"
            control={<Switch on={user.locationConsent} disabled={busy} label="Location consent" onChange={(v) => save({ locationConsent: v }, v ? 'Thank you - phone GPS attendance is on.' : 'Consent withdrawn. Your location is no longer used.')} />}
          >
            <small>Optional. Readings are compared with the bus and thrown away.</small>
          </SettingRow>
          <details className="settings-details">
            <summary>Read the privacy notice</summary>
            <PrivacyNotice />
          </details>
        </Panel>

      </div>

      <h2 className="kit-section-title settings-more-title">More</h2>
      <div className="settings-more">
        <FoldPanel icon="lock" title="Account and security" summary={`@${user.username}${user.registerNo ? ` · ${user.registerNo}` : ''}`}>
          <dl className="settings-kv">
            <dt>Username</dt><dd>@{user.username}</dd>
            <dt>Register no.</dt><dd>{user.registerNo ?? '—'}</dd>
            <dt>Department</dt><dd>{user.department ?? '—'}</dd>
            <dt>Email</dt><dd>{user.email ?? '—'}</dd>
          </dl>
          <p className="fine-print">To correct your name, register number or department, contact the transport office.</p>
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setChangingPassword(true)}><Icon name="lock" size={15} /> Change password</button>
            <button className="btn ghost danger-text" onClick={() => { signOut(); window.location.hash = '#/'; }}><Icon name="logout" size={15} /> Sign out</button>
          </div>
          <p className="fine-print">Changing your password signs you out on every other device.</p>
        </FoldPanel>

        <FoldPanel icon="phone" title="Help and support" summary="Contacts and common questions">
          <ul className="contact-list">
            {(contacts.data ?? []).map((c) => (
              <li key={c.label}><span>{c.label}</span><a href={`tel:${c.phone.replace(/\s+/g, '')}`}>{c.phone}</a></li>
            ))}
          </ul>
          <details className="settings-details">
            <summary>I was asked "Did you board?" but I didn't travel</summary>
            <p className="muted">Answer "No". Nothing is recorded and the reminders stop. If you never travel on some days, set your travel window above.</p>
          </details>
          <details className="settings-details">
            <summary>My attendance looks wrong</summary>
            <p className="muted">Open Attendance and tap "Dispute" on the trip within 7 days. The transport office reviews it.</p>
          </details>
        </FoldPanel>

        <FoldPanel icon="sparkle" title="About" summary="Crescent Transit · Bus Route 2026-2027">
          <dl className="settings-kv">
            <dt>App</dt><dd>Crescent Transit · Bus Tracker</dd>
            <dt>Timetable</dt><dd>BSACIST Bus Route 2026-2027</dd>
            <dt>Access</dt><dd>{entitlement?.required ? <a href="#/pay">Monthly subscription</a> : 'Live tracking, alerts and attendance are free for students'}</dd>
          </dl>
        </FoldPanel>
      </div>
      {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </Page>
  );
}
