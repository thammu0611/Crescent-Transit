import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import Icon from '../components/Icon.jsx';
import { ErrorText, Field, Segmented } from '../components/ui.jsx';

/** Sign in for every role; self-registration for students. */
export default function Login() {
  const { signIn } = useSession();
  const [mode, setMode] = useState('signin');
  const [routes, setRoutes] = useState([]);
  const [stops, setStops] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '', registerNo: '', department: '', routeCode: '', stopSeq: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (mode === 'register' && !routes.length) api('/api/routes').then(setRoutes).catch(() => {});
  }, [mode, routes.length]);
  useEffect(() => {
    setStops([]);
    if (form.routeCode) api(`/api/routes/${encodeURIComponent(form.routeCode)}`).then((r) => setStops(r.stops)).catch(() => {});
  }, [form.routeCode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'signin'
        ? await api('/api/auth/login', { body: { username: form.username, password: form.password } })
        : await api('/api/auth/register', {
          body: { ...form, stopSeq: form.stopSeq ? Number(form.stopSeq) : undefined, routeCode: form.routeCode || undefined },
        });
      signIn(session);
      window.location.hash = '#/';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <aside className="auth-side">
        <span className="auth-logo"><Icon name="bus" size={24} /></span>
        <h1>One sign-in for every seat on the fleet.</h1>
        <p>Live buses, schedules, alerts and attendance for the BSACIST transport fleet.</p>
        <ul className="auth-roles">
          {[
            ['map', 'Students', 'Live bus, arrival estimates, attendance'],
            ['bus', 'Drivers', 'Start a trip and share location'],
            ['chart', 'Transport office', 'Fleet, trips, registers, reports'],
            ['wallet', 'Finance office', 'Collections and reconciliation'],
          ].map(([icon, title, text]) => (
            <li key={title}>
              <span className="contact-avatar"><Icon name={icon} size={17} /></span>
              <span className="contact-text"><b>{title}</b><small>{text}</small></span>
            </li>
          ))}
        </ul>
        <p className="auth-note"><Icon name="shield" size={15} /> Your location is compared with the bus and discarded. It is never stored.</p>
      </aside>
      <section className="auth-main">
      <a className="auth-back" href="#/"><Icon name="back" size={16} /> Routes &amp; timetable</a>
      <form className={`auth-card${mode === 'register' ? ' wide' : ''}`} onSubmit={submit}>
        <span className="hero-badge"><Icon name={mode === 'signin' ? 'user' : 'plus'} size={24} /></span>
        <h2 className="auth-title">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'New student' }]} />
        {mode === 'signin' ? (
          <>
            <p className="muted">Students, drivers, the transport office and the finance office all sign in here.</p>
            <Field label="Username or email" icon="user"><input value={form.username} onChange={set('username')} autoComplete="username" required /></Field>
            <Field label="Password" icon="lock"><input type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required /></Field>
            <details className="demo-accounts">
              <summary>Demo accounts</summary>
              <p className="muted">
                Password for all: the server's <code>DEMO_PASSWORD</code> (default <code>Demo@2026</code>).<br />
                Students <code>stu001</code>–<code>stu024</code> · drivers <code>drv118</code>, <code>drv119</code>… ·
                <code>admin</code> · <code>finance</code>
              </p>
            </details>
          </>
        ) : (
          <>
            <p className="muted">Create a student account to track your bus live, get route alerts and boarding reminders, and keep your attendance.</p>
            <div className="grid2">
              <Field label="Username" icon="user"><input value={form.username} onChange={set('username')} required pattern="[A-Za-z0-9._\-]{3,30}" /></Field>
              <Field label="Register number" icon="id"><input value={form.registerNo} onChange={set('registerNo')} /></Field>
            </div>
            <div className="grid2">
              <Field label="Full name" icon="user"><input value={form.fullName} onChange={set('fullName')} required /></Field>
              <Field label="Email" icon="mail"><input type="email" value={form.email} onChange={set('email')} required /></Field>
            </div>
            <div className="grid2">
              <Field label="Password (8+ characters)" icon="lock"><input type="password" value={form.password} onChange={set('password')} minLength={8} required autoComplete="new-password" /></Field>
              <Field label="Department" icon="users"><input value={form.department} onChange={set('department')} placeholder="e.g. CA, CSE" /></Field>
            </div>
            <div className="grid2">
              <Field label="Your route">
                <select value={form.routeCode} onChange={set('routeCode')}>
                  <option value="">Choose later</option>
                  {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
                </select>
              </Field>
              <Field label="Your stop">
                <select value={form.stopSeq} onChange={set('stopSeq')} disabled={!stops.length}>
                  <option value="">—</option>
                  {stops.map((s) => <option key={s.seq} value={s.seq}>{s.seq}. {s.name}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn dark" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} {!busy && <Icon name="arrow" size={16} />}</button>
      </form>
      </section>
    </main>
  );
}
