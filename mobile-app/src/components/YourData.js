import { useState } from 'react';
import { api, download } from '../lib/api.js';
import { useT } from '../lib/offline.js';
import { useSession } from '../lib/session.js';
import { ViewCard } from './adminkit.js';
import { Button, ErrorText, Sheet, TextField, Txt } from './ui.js';

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

  const remove = async () => {
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
    <ViewCard icon="shield" title="Your data" summary="Download it, or delete your account">
      <Txt muted small>{t('Your live location is never stored. This file has your profile, trips, attendance and payments.')}</Txt>
      <Button variant="ghost" icon="list" title={t('Download my data')} busy={busy && !asking} onPress={fetchData} />
      <Txt muted small>{t('Deleting removes your name, email, phone and photo for good. Payment records stay for the accounts, without your name.')}</Txt>
      <Button variant="danger" icon="x" title={t('Delete my account')} onPress={() => { setError(null); setAsking(true); }} />
      {!asking ? <ErrorText>{error}</ErrorText> : null}
      {asking ? (
        <Sheet title={t('Delete my account')} onClose={() => setAsking(false)}>
          <Txt muted small>{t('This cannot be undone. Enter your password to confirm.')}</Txt>
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          <ErrorText>{error}</ErrorText>
          <Button variant="danger" title={t('Delete my account')} busy={busy} disabled={!password} onPress={remove} />
        </Sheet>
      ) : null}
    </ViewCard>
  );
}
