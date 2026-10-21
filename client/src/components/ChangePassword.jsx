import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorText, Field, Modal, Notice } from './ui.jsx';

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
    if (f.next.length < 8) return setError('New password must be at least 8 characters.');
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    if (f.next === f.current) return setError('Choose a password different from the current one.');
    setBusy(true);
    try {
      const r = await api('/api/auth/change-password', { token, body: { currentPassword: f.current, newPassword: f.next } });
      signIn({ token: r.token, user: r.user });
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
          <Field label="New password (8+ characters)" icon="lock"><input type="password" value={f.next} onChange={set('next')} autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
          <Field label="Confirm new password" icon="lock"><input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Change password'}</button>
        </form>
      )}
    </Modal>
  );
}
