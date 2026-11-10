import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { ErrorText, Field, Notice, Panel } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useSession } from '../../lib/session.jsx';

/**
 * A student confirms their university email (the one DigiiCampus holds) with a
 * 6-digit code sent to that inbox, before using the app. Shown in place of the
 * student pages while the server says the check is required.
 */
export default function VerifyEmail() {
  const { token, user, emailCheck, signIn, signOut } = useSession();
  const domain = emailCheck?.domain;
  const [email, setEmail] = useState(user?.email ?? '');
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/auth/email/send', { token, body: { email: email.trim() } });
      setSent(r);
      setCode('');
      setWait(60);
    } catch (err) {
      setError(err.message);
      if (err.body?.retryAfterS) setWait(err.body.retryAfterS);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/auth/email/verify', { token, body: { code } });
      signIn({ token, user: r.user, emailCheck: r.emailCheck });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="verify-email">
      <Panel title="Verify your university email" icon="mail">
        <p className="muted">
          Use the email you sign in to DigiiCampus with{domain ? <> (<b>@{domain}</b>)</> : null}. We'll send a 6-digit code to that inbox.
        </p>
        {!sent ? (
          <form onSubmit={send}>
            <Field label="University email" icon="mail">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={domain ? `name@${domain}` : 'name@university'}
                autoComplete="email"
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <button className="btn primary" disabled={busy || wait > 0}>{busy ? 'Sending…' : wait > 0 ? `Send code (${wait} s)` : 'Send code'}</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <Notice>Code sent to {sent.sentTo}. It expires in {sent.expiresInMinutes} minutes.</Notice>
            {sent.devCode && <p className="muted">Mail is not set up on this server yet; for testing, the code is <b>{sent.devCode}</b>.</p>}
            <Field label="6-digit code" icon="lock">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <div className="verify-actions">
              <button className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
              <button type="button" className="btn" disabled={busy || wait > 0} onClick={send}>{wait > 0 ? `Resend (${wait} s)` : 'Resend code'}</button>
              <button type="button" className="btn ghost" onClick={() => { setSent(null); setError(null); }}>Change email</button>
            </div>
          </form>
        )}
        <button type="button" className="btn ghost verify-signout" onClick={() => { signOut(); window.location.hash = '#/'; }}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </Panel>
    </main>
  );
}
