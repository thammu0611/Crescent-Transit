import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../components/Icon.js';
import {
  Button, Collapsible, ErrorText, NavPill, Notice, RoutePattern, Segmented, Select, Text, TextField,
  Txt,
} from '../components/ui.js';
import { apiBase, defaultApiBase, hasSavedServer, isInstalledBuild, setServerUrl, viaDevServer } from '../config.js';
import { api, closeSocket } from '../lib/api.js';
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
  if (!USERNAME_RE.test(f.username.trim())) return 'Username: 3-30 letters, digits, dot, dash or underscore.';
  if (!f.fullName.trim()) return 'Full name is required.';
  if (!EMAIL_RE.test(f.email.trim())) return 'A valid email is required.';
  if (f.password.length < 8) return 'Password must be at least 8 characters.';
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
      const h = await api('/api/health');
      setMsg(`Connected · ${h.liveBuses} buses on trip · payments: ${h.paymentGateway}`);
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
const FORM_CARD = { backgroundColor: '#fff', borderRadius: R.lg, padding: 18, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', ...shadowLg, elevation: 0 };

export default function Login({ navigation }) {
  const { signIn } = useSession();
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
          <Text style={{ color: '#fff', fontSize: 30, lineHeight: 36, ...F.display }}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 21, ...F[400] }}>One sign-in for every seat on the fleet.</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: R.lg, padding: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', ...shadowLg }}>
          <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'New student' }]} />
        </View>
        <View style={FORM_CARD}>
          {mode === 'signin' ? (
            <>
              <Txt muted small>Students, drivers, the transport office and the finance office all sign in here.</Txt>
              <TextField label="Username or email" icon="user" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
              <TextField ref={passwordRef} label="Password" icon="lock" value={form.password} onChangeText={set('password')} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
              <Collapsible title="Demo accounts">
                <Txt muted small>
                  Password for all: the server's DEMO_PASSWORD (default Demo@2026).{'\n'}
                  Students stu001–stu024 · drivers drv118, drv119… · admin · finance
                </Txt>
              </Collapsible>
            </>
          ) : (
            <>
              <Txt muted small>Create a student account to track your bus live, get route alerts and boarding reminders, and keep your attendance.</Txt>
              <TextField label="Username" icon="user" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} />
              <TextField label="Register number" icon="id" value={form.registerNo} onChangeText={set('registerNo')} autoCapitalize="characters" />
              <TextField label="Full name" icon="user" value={form.fullName} onChangeText={set('fullName')} autoComplete="name" />
              <TextField label="Email" icon="mail" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <TextField label="Password (8+ characters)" icon="lock" value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
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
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: R.lg, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="shield" size={18} color={C.gold} />
          <Txt small style={{ flex: 1, color: 'rgba(255,255,255,0.8)', ...F[600] }}>Your location is compared with the bus and discarded. It is never stored.</Txt>
        </View>
        <View style={FORM_CARD}><ServerAddress /></View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}
