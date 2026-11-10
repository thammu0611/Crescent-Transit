// Change your own password (every role) - the web app's ChangePassword modal
// as a bottom sheet. The server signs out every other device and returns a
// fresh token, so this phone stays signed in.
import { passwordProblem } from '../../../shared/password.js';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { Button, ErrorText, LinkButton, Notice, Panel, PillIconButton, Screen, Sheet, TextField, Txt } from './ui.js';

const EMPTY = { current: '', next: '', confirm: '' };

export function ChangePasswordSheet({ visible, onClose }) {
  const { token, signIn } = useSession();
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const close = () => {
    setF(EMPTY);
    setError(null);
    setDone(false);
    onClose?.();
  };

  const submit = async () => {
    setError(null);
    if (!f.current) return setError('Enter your current password.');
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

  const field = { secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, maxLength: 72 };
  return (
    <Sheet visible={visible} title="Change password" onClose={close}>
      {done ? (
        <View style={{ gap: 12 }}>
          <Notice>Password changed. You stay signed in on this phone; other devices must sign in again.</Notice>
          <Button title="Done" onPress={close} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <TextField label="Current password" icon="lock" value={f.current} onChangeText={set('current')} autoComplete="current-password" textContentType="password" {...field} />
          <TextField label="New password (10+ characters)" icon="lock" value={f.next} onChangeText={set('next')} autoComplete="new-password" textContentType="newPassword" {...field} />
          <TextField label="Confirm new password" icon="lock" value={f.confirm} onChangeText={set('confirm')} autoComplete="new-password" textContentType="newPassword" {...field} onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button title="Change password" icon="lock" busy={busy} onPress={submit} />
        </View>
      )}
    </Sheet>
  );
}

/** A round lock button for the navigation pill (driver and finance headers). */
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillIconButton icon="lock" label="Change password" onPress={() => setOpen(true)} />
      <ChangePasswordSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * First sign-in with a temporary password from the transport office: the user
 * picks their own before anything else (the server refuses other requests).
 */
export function ChoosePassword() {
  const { token, signIn, signOut } = useSession();
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setError(null);
    if (!f.current) return setError('Enter the temporary password.');
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

  const field = { secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, maxLength: 72 };
  return (
    <Screen safeTop>
      <Panel title="Choose your own password" icon="lock">
        <View style={{ gap: 12 }}>
          <Txt muted>You signed in with a temporary password from the transport office. Pick a new one only you know.</Txt>
          <TextField label="Temporary password" icon="lock" value={f.current} onChangeText={set('current')} autoComplete="current-password" textContentType="password" {...field} />
          <TextField label="New password (10+ characters)" icon="lock" value={f.next} onChangeText={set('next')} autoComplete="new-password" textContentType="newPassword" {...field} />
          <TextField label="Confirm new password" icon="lock" value={f.confirm} onChangeText={set('confirm')} autoComplete="new-password" textContentType="newPassword" {...field} onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button title="Save password" icon="lock" busy={busy} onPress={submit} />
          <LinkButton title="Sign out" icon="logout" danger onPress={signOut} />
        </View>
      </Panel>
    </Screen>
  );
}
