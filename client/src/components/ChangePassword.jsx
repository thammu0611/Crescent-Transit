import { passwordProblem } from '../../../shared/password.js';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorText, Field, Modal, Notice, Panel } from './ui.jsx';

/**
 * Change your own password (every role). The server signs out every other
 * device and returns a fresh token, so this browser stays signed in.
 */
export default function ChangePassword({ onClose }) {
  const { token, signIn } = useSession();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    { const weak = passwordProblem(f.next); if (weak) return setError(`${weak}.`); }
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    if (f.next === f.current) return setError('Choose a password different from the current one.');
    setBusy(true);
    try {
      const r = await api('/api/auth/change-password', { token, body: { currentPassword: f.current, newPassword: f.next } });
      signIn({ token: r.token, user: r.user, emailCheck: r.emailCheck });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <>
          <Notice>Password changed. You stay signed in here; other devices must sign in again.</Notice>
          <button className="btn primary" onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field label="Current password" icon="lock"><input type="password" value={f.current} onChange={set('current')} autoComplete="current-password" required /></Field>
          <Field label="New password (10+ characters)" icon="lock"><input type="password" value={f.next} onChange={set('next')} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
          <Field label="Confirm new password" icon="lock"><input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Change password'}</button>
        </form>
      )}
    </Modal>
  );
}

/**
 * First sign-in with a temporary password from the transport office: the user
 * picks their own before anything else (the server refuses other requests).
 */
export function ChoosePassword() {
  const { token, signIn, signOut } = useSession();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    { const weak = passwordProblem(f.next); if (weak) return setError(`${weak}.`); }
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      const r = await api('/api/auth/change-password', { token, body: { currentPassword: f.current, newPassword: f.next } });
      signIn({ token: r.token, user: r.user, emailCheck: r.emailCheck });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="verify-email">
      <Panel title="Choose your own password" icon="lock">
        <p className="muted">You signed in with a temporary password from the transport office. Pick a new one only you know.</p>
        <form onSubmit={submit}>
          <Field label="Temporary password" icon="lock"><input type="password" value={f.current} onChange={set('current')} autoComplete="current-password" required /></Field>
          <Field label="New password (10+ characters)" icon="lock"><input type="password" value={f.next} onChange={set('next')} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
          <Field label="Confirm new password" icon="lock"><input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" minLength={10} maxLength={72} required /></Field>
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Save password'}</button>
        </form>
        <button type="button" className="btn ghost verify-signout" onClick={() => { signOut(); window.location.hash = '#/'; }}>Sign out</button>
      </Panel>
    </main>
  );
}
