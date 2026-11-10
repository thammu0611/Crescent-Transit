// A student confirms their university email (the one DigiiCampus holds) with a
// 6-digit code sent to that inbox, before using the app - the web app's
// VerifyEmail page. Shown in place of the student tabs while it is required.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, ErrorText, LinkButton, Notice, Panel, Screen, TextField, Txt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';

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

  const send = async () => {
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

  const verify = async () => {
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
    <Screen safeTop>
      <Panel title="Verify your university email" icon="mail">
        <View style={{ gap: 12 }}>
          <Txt muted>
            Use the email you sign in to DigiiCampus with{domain ? ` (@${domain})` : ''}. We'll send a 6-digit code to that inbox.
          </Txt>
          {!sent ? (
            <>
              <TextField
                label="University email"
                icon="mail"
                value={email}
                onChangeText={setEmail}
                placeholder={domain ? `name@${domain}` : 'name@university'}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                onSubmitEditing={send}
              />
              <ErrorText>{error}</ErrorText>
              <Button title={wait > 0 ? `Send code (${wait} s)` : 'Send code'} icon="mail" busy={busy} disabled={wait > 0} onPress={send} />
            </>
          ) : (
            <>
              <Notice>Code sent to {sent.sentTo}. It expires in {sent.expiresInMinutes} minutes.</Notice>
              {sent.devCode ? <Txt small muted>Mail is not set up on this server yet; for testing, the code is {sent.devCode}.</Txt> : null}
              <TextField
                label="6-digit code"
                icon="lock"
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                onSubmitEditing={verify}
              />
              <ErrorText>{error}</ErrorText>
              <Button title="Verify" icon="check" busy={busy} disabled={code.length !== 6} onPress={verify} />
              <Button title={wait > 0 ? `Resend (${wait} s)` : 'Resend code'} variant="ghost" disabled={busy || wait > 0} onPress={send} />
              <LinkButton title="Change email" onPress={() => { setSent(null); setError(null); }} />
            </>
          )}
          <LinkButton title="Sign out" icon="logout" danger onPress={signOut} />
        </View>
      </Panel>
    </Screen>
  );
}
