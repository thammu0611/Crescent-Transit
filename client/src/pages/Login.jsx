import { passwordProblem } from '../../../shared/password.js';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useServerInfo } from '../lib/serverInfo.js';
import { useSession } from '../lib/session.jsx';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { ErrorText, Field, PasswordInput, Segmented } from '../components/ui.jsx';

// #/login opens Sign in and #/register opens Sign up: the first screen's two buttons.
const wantsRegister = () => window.location.hash.startsWith('#/register');

/** Sign in for every role; self-registration for students. */
export default function Login() {
  const { signIn } = useSession();
  const info = useServerInfo();
  const [mode, setMode] = useState(() => (wantsRegister() ? 'register' : 'signin'));
  const [routes, setRoutes] = useState([]);
  const [stops, setStops] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '', registerNo: '', department: '', routeCode: '', stopSeq: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Switching between Sign in and Sign up keeps this form on screen (no reload).
  useEffect(() => {
    const onHash = () => setMode((m) => (wantsRegister() ? (m === 'register' || m === 'parent' ? m : 'register') : (m === 'signin' || m === 'forgot' ? m : 'signin')));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const choose = (m) => {
    setError(null);
    setMode(m);
    const hash = m === 'signin' ? '#/login' : '#/register';
    if (window.location.hash !== hash) window.location.hash = hash;
  };

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
        : mode === 'parent'
          ? await api('/api/auth/register-parent', { body: { username: form.username, fullName: form.fullName, email: form.email, password: form.password, phone: form.phone, code: form.code } })
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
        <span className="auth-logo brand-logo"><BrandMark size={52} /></span>
        <h1>One sign-in for every seat on the fleet.</h1>
        <p>Live buses, schedules, alerts and attendance for the BSACIST transport fleet.</p>
        <ul className="auth-roles">
          {[
            ['map', 'Students', 'Live bus, arrival estimates, attendance'],
            ['bus', 'Drivers', 'Start a trip and share location'],
            ['chart', 'Transport office', 'Fleet, trips, registers, reports'],
            // ['wallet', 'Finance office', 'Collections and reconciliation'], (finance app switched off)
          ].map(([icon, title, text]) => (
            <li key={title}>
              <span className="contact-avatar"><Icon name={icon} size={17} /></span>
              <span className="contact-text"><b>{title}</b><small>{text}</small></span>
            </li>
          ))}
        </ul>
      </aside>
      <section className="auth-main">
      {mode === 'forgot' ? <ForgotPassword initial={form.username} onBack={() => setMode('signin')} /> : (
      <form className={`auth-card${mode !== 'signin' ? ' wide' : ''}`} onSubmit={submit}>
        <span className="hero-badge"><Icon name={mode === 'signin' ? 'user' : 'plus'} size={24} /></span>
        <h2 className="auth-title">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <Segmented value={mode} onChange={choose} options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'Sign up' }, { value: 'parent', label: 'Parent' }]} />
        {mode === 'signin' ? (
          <>
            <p className="muted">Students, drivers and the transport office all sign in here.</p>
            <Field label="Username or email" icon="user"><input value={form.username} onChange={set('username')} autoComplete="username" required /></Field>
            <Field label="Password" icon="lock"><PasswordInput value={form.password} onChange={set('password')} autoComplete="current-password" required /></Field>
            <button type="button" className="link-btn forgot-link" onClick={() => { setError(null); setMode('forgot'); }}>Forgot password?</button>
            {info?.demoMode && (
            <details className="demo-accounts">
              <summary>Demo accounts</summary>
              <p className="muted">
                Password for all: the server's <code>DEMO_PASSWORD</code> (default <code>Demo@2026</code>).<br />
                Students <code>stu001</code>–<code>stu024</code> · drivers <code>drv118</code>, <code>drv119</code>… ·
                <code>admin</code>
              </p>
            </details>
            )}
          </>
        ) : mode === 'parent' ? (
          <>
            <p className="muted">Follow your child's bus and today's trips. Ask your child for the code under Services, Parent access in their app.</p>
            <Field label="Code from your child's app" icon="id"><input value={form.code ?? ''} onChange={set('code')} required maxLength={9} autoCapitalize="characters" /></Field>
            <div className="grid2">
              <Field label="Your full name" icon="user"><input value={form.fullName} onChange={set('fullName')} required /></Field>
              <Field label="Username" icon="user"><input value={form.username} onChange={set('username')} required pattern="[A-Za-z0-9._\-]{3,30}" /></Field>
            </div>
            <div className="grid2">
              <Field label="Email" icon="mail"><input type="email" value={form.email} onChange={set('email')} required /></Field>
              <Field label="Phone" icon="phone"><input type="tel" value={form.phone ?? ''} onChange={set('phone')} /></Field>
            </div>
            <Field label="Password (10+ characters)" icon="lock"><PasswordInput value={form.password} onChange={set('password')} minLength={10} required autoComplete="new-password" /></Field>
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
              <Field label="University email" icon="mail" hint="The one you use on DigiiCampus"><input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
            </div>
            <div className="grid2">
              <Field label="Password (10+ characters)" icon="lock"><PasswordInput value={form.password} onChange={set('password')} minLength={10} required autoComplete="new-password" /></Field>
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
      )}
      </section>
    </main>
  );
}

/** Forgot password: a code emailed to the account's address, then a new password. */
function ForgotPassword({ initial, onBack }) {
  const { signIn } = useSession();
  const [login, setLogin] = useState(initial ?? '');
  const [asked, setAsked] = useState(null);
  const [f, setF] = useState({ code: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAsked(await api('/api/auth/password/forgot', { body: { login: login.trim() } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError(null);
    { const weak = passwordProblem(f.next); if (weak) return setError(`${weak}.`); }
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      signIn(await api('/api/auth/password/reset', { body: { login: login.trim(), code: f.code, newPassword: f.next } }));
      window.location.hash = '#/';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-card" onSubmit={asked ? reset : ask}>
      <span className="hero-badge"><Icon name="lock" size={24} /></span>
      <h2 className="auth-title">Reset your password</h2>
      {!asked ? (
        <>
          <p className="muted">Enter your username or university email. We'll email you a 6-digit code.</p>
          <Field label="Username or email" icon="user"><input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
        </>
      ) : (
        <>
          <p className="notice" role="status">If that account has an email on file, a code is on its way. It expires in {asked.expiresInMinutes} minutes.</p>
          {asked.devCode && <p className="muted">Mail is not set up on this server yet; for testing, the code is <b>{asked.devCode}</b>.</p>}
          <Field label="6-digit code" icon="lock">
            <input value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" autoComplete="one-time-code" required />
          </Field>
          <Field label="New password (10+ characters)" icon="lock"><PasswordInput value={f.next} onChange={(e) => setF((x) => ({ ...x, next: e.target.value }))} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
          <Field label="Confirm new password" icon="lock"><PasswordInput value={f.confirm} onChange={(e) => setF((x) => ({ ...x, confirm: e.target.value }))} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <button className="btn dark" disabled={busy}>{busy ? 'Please wait…' : asked ? 'Set new password' : 'Send code'}</button>
      <p className="muted forgot-note">No email on your account (drivers)? Ask the transport office to reset it.</p>
      <button type="button" className="link-btn" onClick={onBack}><Icon name="back" size={14} /> Back to sign in</button>
    </form>
  );
}
