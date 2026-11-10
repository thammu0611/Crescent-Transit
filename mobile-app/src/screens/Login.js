import { passwordProblem } from '../../../shared/password.js';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../components/Icon.js';
import {
  Button, Collapsible, ErrorText, LinkButton, NavPill, Notice, RoutePattern, Segmented, Select, Text, TextField,
  Txt,
} from '../components/ui.js';
import { apiBase, defaultApiBase, hasSavedServer, isInstalledBuild, setServerUrl, viaDevServer } from '../config.js';
import { api, closeSocket } from '../lib/api.js';
import { resetServerInfo, useServerInfo } from '../lib/serverInfo.js';
import { useSession } from '../lib/session.js';
import { C, F, G, R, shadowLg } from '../theme.js';

const USERNAME_RE = /^[A-Za-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same checks as the web form's required/pattern/minLength attributes. */
function validate(mode, f) {
  if (mode === 'signin') {
    if (!f.username.trim() || !f.password) return 'Enter your username and password.';
    return null;
  }
  if (mode === 'parent' && (f.code ?? '').trim().length < 8) return "Enter the code from your child's app.";
  if (!USERNAME_RE.test(f.username.trim())) return 'Username: 3-30 letters, digits, dot, dash or underscore.';
  if (!f.fullName.trim()) return 'Full name is required.';
  if (!EMAIL_RE.test(f.email.trim())) return 'A valid email is required.';
  { const weak = passwordProblem(f.password); if (weak) return `${weak}.`; }
  return null;
}

/** The phone needs to know where the backend runs (the web app is served by it). */
function ServerAddress() {
  const [url, setUrl] = useState(apiBase());
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const test = async () => {
    setErr(null);
    setMsg(null);
    try {
      await setServerUrl(url === defaultApiBase() ? '' : url);
      closeSocket();
      resetServerInfo();
      const h = await api('/api/health');
      setMsg(`Connected · ${h.liveBuses} buses on trip${h.demoMode ? ' · demo mode' : ''}`);
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    // An installed app has no dev server to find the backend through: until an
    // address is saved, this panel starts open so testers see where to enter it.
    <Collapsible title={`Server: ${apiBase()}`} initiallyOpen={isInstalledBuild() && !hasSavedServer()}>
      <View style={{ gap: 8 }}>
        <TextField
          label="Server address"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint={isInstalledBuild()
            ? 'The address you were given, e.g. https://example.trycloudflare.com or http://192.168.1.20:4000'
            : `The computer running the backend (npm start), e.g. http://192.168.1.20:4000. Automatic: ${defaultApiBase()}`}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Save and test" small onPress={test} style={{ flex: 1 }} />
          {hasSavedServer() && <Button title="Use automatic" small variant="ghost" onPress={async () => { await setServerUrl(''); closeSocket(); setUrl(apiBase()); setMsg('Using the automatic address.'); }} style={{ flex: 1 }} />}
        </View>
        <Notice>{msg}</Notice>
        <ErrorText>{err}</ErrorText>
      </View>
    </Collapsible>
  );
}

/** Sign in for every role; self-registration for students. */

/**
 * The form cards: plain, static views (no entrance animation, overlay layer or
 * clipping), so nothing on this screen can come between a field and the keyboard.
 */
const FORM_CARD = { backgroundColor: C.paper, borderRadius: R.lg, padding: 18, gap: 14, borderWidth: 1, borderColor: C.dark ? C.glassEdge : 'rgba(255,255,255,0.6)', ...shadowLg, elevation: 0 };

export default function Login({ navigation }) {
  const { signIn } = useSession();
  const info = useServerInfo();
  const [mode, setMode] = useState('signin');
  const [routes, setRoutes] = useState([]);
  const [stops, setStops] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '', registerNo: '', department: '', routeCode: '', stopSeq: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const passwordRef = useRef(null);
  const focused = useIsFocused();

  useEffect(() => {
    if (mode === 'register' && !routes.length) api('/api/routes').then(setRoutes).catch(() => {});
  }, [mode, routes.length]);
  useEffect(() => {
    setStops([]);
    if (form.routeCode) api(`/api/routes/${encodeURIComponent(form.routeCode)}`).then((r) => setStops(r.stops)).catch(() => {});
  }, [form.routeCode]);

  const submit = async () => {
    const invalid = validate(mode, form);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'signin'
        ? await api('/api/auth/login', { body: { username: form.username.trim(), password: form.password } })
        : mode === 'parent'
          ? await api('/api/auth/register-parent', { body: { username: form.username.trim(), fullName: form.fullName.trim(), email: form.email.trim(), password: form.password, phone: form.phone, code: form.code } })
          : await api('/api/auth/register', {
          body: { ...form, username: form.username.trim(), email: form.email.trim(), stopSeq: form.stopSeq ? Number(form.stopSeq) : undefined, routeCode: form.routeCode || undefined },
        });
      signIn(session);
    } catch (err) {
      // A server address saved earlier (e.g. an old Wi-Fi IP) overrides the automatic one.
      const stale = err instanceof TypeError && hasSavedServer() && !viaDevServer() ? ' A server address is saved on this phone: open "Server" below and tap "Use automatic".' : '';
      setError(err.message + stale);
    } finally {
      setBusy(false);
    }
  };

  // The whole screen is navy, as on the web app: the navigation pill at the top,
  // the headline on the navy, and the white form card floating below.
  return (
    <LinearGradient colors={G.navy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      {focused ? <StatusBar style="light" /> : null}
      <RoutePattern opacity={0.16} slice />
      {/* A simple scroll area: no re-layout when the keyboard opens, taps never dismiss it,
          and enough room at the bottom for the lower fields to scroll above the keyboard. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 340, gap: 16 }} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
        <NavPill glass onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
        <View style={{ gap: 6, paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontSize: 30, lineHeight: 36, ...F.display }}>{mode === 'signin' ? 'Welcome back' : mode === 'forgot' ? 'Forgot password' : 'Create your account'}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 21, ...F[400] }}>One sign-in for every seat on the fleet.</Text>
        </View>
        {mode === 'forgot' ? <ForgotPassword initial={form.username} onBack={() => setMode('signin')} /> : (
        <>
        <View style={{ backgroundColor: C.glass, borderRadius: R.lg, padding: 6, borderWidth: 1, borderColor: C.dark ? C.glassEdge : 'rgba(255,255,255,0.6)', ...shadowLg }}>
          <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'Student' }, { value: 'parent', label: 'Parent' }]} />
        </View>
        <View style={FORM_CARD}>
          {mode === 'signin' ? (
            <>
              <Txt muted small>Students, drivers and the transport office all sign in here.</Txt>
              <TextField label="Username or email" icon="user" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
              <TextField ref={passwordRef} label="Password" icon="lock" value={form.password} onChangeText={set('password')} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
              <View style={{ alignItems: 'flex-end', marginTop: -4 }}>
                <LinkButton title="Forgot password?" onPress={() => { setError(null); setMode('forgot'); }} />
              </View>
              {info?.demoMode ? (
                <Collapsible title="Demo accounts">
                  <Txt muted small>
                    Password for all: the server's DEMO_PASSWORD (default Demo@2026).{'\n'}
                    Students stu001–stu024 · drivers drv118, drv119… · admin
                  </Txt>
                </Collapsible>
              ) : null}
            </>
          ) : mode === 'parent' ? (
            <>
              <Txt muted small>Follow your child's bus and today's trips. Ask your child for the code under Services, Parent access in their app.</Txt>
              <TextField label="Code from your child's app" icon="id" value={form.code ?? ''} onChangeText={set('code')} autoCapitalize="characters" maxLength={9} />
              <TextField label="Your full name" icon="user" value={form.fullName} onChangeText={set('fullName')} />
              <TextField label="Username" icon="user" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} />
              <TextField label="Email" icon="mail" value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
              <TextField label="Phone" icon="phone" value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
              <TextField label="Password (10+ characters)" icon="lock" value={form.password} onChangeText={set('password')} secureTextEntry />
            </>
          ) : (
            <>
              <Txt muted small>Create a student account to track your bus live, get route alerts and boarding reminders, and keep your attendance.</Txt>
              <TextField label="Username" icon="user" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} />
              <TextField label="Register number" icon="id" value={form.registerNo} onChangeText={set('registerNo')} autoCapitalize="characters" />
              <TextField label="Full name" icon="user" value={form.fullName} onChangeText={set('fullName')} autoComplete="name" />
              <TextField label="University email" hint="The one you use on DigiiCampus" icon="mail" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <TextField label="Password (10+ characters)" icon="lock" value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
              <TextField label="Department" icon="users" value={form.department} onChangeText={set('department')} placeholder="e.g. CA, CSE" />
              <Select
                label="Your route"
                value={form.routeCode}
                onChange={(v) => setForm((f) => ({ ...f, routeCode: v, stopSeq: '' }))}
                placeholder="Choose later"
                options={[{ value: '', label: 'Choose later' }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))]}
              />
              <Select
                label="Your stop"
                value={form.stopSeq}
                onChange={set('stopSeq')}
                disabled={!stops.length}
                placeholder="—"
                options={stops.map((s) => ({ value: s.seq, label: `${s.seq}. ${s.name}` }))}
              />
            </>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title={busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} variant="indigo" icon={busy ? undefined : 'arrow'} busy={busy} onPress={submit} />
        </View>
        </>
        )}
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: R.lg, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="shield" size={18} color={C.gold} />
          <Txt small style={{ flex: 1, color: 'rgba(255,255,255,0.8)', ...F[600] }}>Your location is compared with the bus and discarded. It is never stored.</Txt>
        </View>
        {/* The server address is for testers: hidden once a live server answers. */}
        {info === null || info?.demoMode ? <View style={FORM_CARD}><ServerAddress /></View> : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
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
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const ask = async () => {
    if (!login.trim()) return setError('Enter your username or university email.');
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

  const reset = async () => {
    setError(null);
    if (f.code.length !== 6) return setError('Enter the 6-digit code from the email.');
    { const weak = passwordProblem(f.next); if (weak) return setError(`${weak}.`); }
    if (f.next !== f.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      signIn(await api('/api/auth/password/reset', { body: { login: login.trim(), code: f.code, newPassword: f.next } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const secret = { secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, maxLength: 72, autoComplete: 'new-password', textContentType: 'newPassword' };
  return (
    <View style={FORM_CARD}>
      <Text style={{ fontSize: 20, color: C.navy, ...F.navTitle }}>Reset your password</Text>
      {!asked ? (
        <>
          <Txt muted small>Enter your username or university email. We'll email you a 6-digit code.</Txt>
          <TextField label="Username or email" icon="user" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} autoComplete="username" onSubmitEditing={ask} />
        </>
      ) : (
        <>
          <Notice>If that account has an email on file, a code is on its way. It expires in {asked.expiresInMinutes} minutes.</Notice>
          {asked.devCode ? <Txt small muted>Mail is not set up on this server yet; for testing, the code is {asked.devCode}.</Txt> : null}
          <TextField label="6-digit code" icon="lock" value={f.code} onChangeText={(v) => set('code')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          <TextField label="New password (10+ characters)" icon="lock" value={f.next} onChangeText={set('next')} {...secret} />
          <TextField label="Confirm new password" icon="lock" value={f.confirm} onChangeText={set('confirm')} {...secret} onSubmitEditing={reset} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={asked ? 'Set new password' : 'Send code'} variant="indigo" icon={asked ? 'check' : 'mail'} busy={busy} onPress={asked ? reset : ask} />
      <Txt muted small>No email on your account (drivers)? Ask the transport office to reset it.</Txt>
      <View style={{ alignItems: 'flex-start' }}><LinkButton title="Back to sign in" icon="back" onPress={onBack} /></View>
    </View>
  );
}
