import { useState } from 'react';
import { api, download } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.jsx';
import { ViewCard } from './adminkit.jsx';
import { ErrorText, Field, Modal } from './ui.jsx';

/** Download everything held about you, or delete your account (DPDP Act). */
export default function YourData() {
  const { token, signOut } = useSession();
  const t = useT();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');

  const fetchData = async () => {
    setBusy(true);
    setError(null);
    try {
      await download('/api/me/export', token, 'my-data.json');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/me/delete', { token, body: { password } });
      signOut();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <ViewCard icon="shield" title="Your data" summary="Download it, or delete your account" className="settings-section">
      <p className="muted">{t('Your live location is never stored. This file has your profile, trips, attendance and payments.')}</p>
      <button className="btn ghost" disabled={busy} onClick={fetchData}>{t('Download my data')}</button>
      <p className="muted">{t('Deleting removes your name, email, phone and photo for good. Payment records stay for the accounts, without your name.')}</p>
      <button className="btn danger" onClick={() => { setError(null); setAsking(true); }}>{t('Delete my account')}</button>
      {!asking && <ErrorText>{error}</ErrorText>}
      {asking && (
        <Modal title={t('Delete my account')} onClose={() => setAsking(false)}>
          <form onSubmit={remove}>
            <p className="muted">{t('This cannot be undone. Enter your password to confirm.')}</p>
            <Field label="Password" icon="lock">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <ErrorText>{error}</ErrorText>
            <button className="btn danger" disabled={busy || !password}>{busy ? t('Please wait…') : t('Delete my account')}</button>
          </form>
        </Modal>
      )}
    </ViewCard>
  );
}
