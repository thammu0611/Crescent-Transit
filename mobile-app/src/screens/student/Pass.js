import * as Brightness from 'expo-brightness';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Icon from '../../components/Icon.js';
import { Badge, Button, ErrorText, Screen, Skeleton, Text, Txt } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useNow } from '../../lib/hooks.js';
import { useT } from '../../lib/offline.js';
import { ageLabel } from '../../lib/rules.js';
import { useSession } from '../../lib/session.js';
import { getJSON, setJSON } from '../../lib/storage.js';
import { C, F } from '../../theme.js';

const SAVED_KEY = 'ubts.savedPass';
const STATUS = {
  ACTIVE: ['live', 'Active'],
  FREE: ['live', 'Active'],
  GRACE: ['delayed', 'In grace period'],
  EXPIRED: ['danger', 'Expired'],
};

const Fact = ({ k, v }) => (
  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
    <Text style={{ color: '#A9BCE6', fontSize: 12, ...F[500] }}>{k}</Text>
    <Text style={{ color: '#fff', ...F[700], fontSize: 14 }} numberOfLines={3}>{v}</Text>
  </View>
);

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
// A short, readable form of the code for reading out: "4F2·9K1".
const shortCode = (code = '') => {
  const s = String(code).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  return s.length === 6 ? `${s.slice(0, 3)}·${s.slice(3)}` : s;
};

/**
 * The student's digital bus pass: a card the driver can trust at a glance and
 * a QR code that changes every 90 seconds. The sun button and "Boost
 * brightness" turn the screen up for scanning and put it back on leaving.
 * "Save to phone" keeps a copy that opens without a connection.
 */
export default function BusPass({ navigation }) {
  const { token } = useSession();
  const t = useT();
  const now = useNow(1000);
  const [pass, setPass] = useState(null);
  const [error, setError] = useState(null);
  const [bright, setBright] = useState(false);
  const [saved, setSaved] = useState(null); // { at } when a copy is on the phone
  const [offline, setOffline] = useState(false);
  const before = useRef(null);

  const load = useCallback(async () => {
    try {
      const p = await api('/api/pass', { token });
      setPass(p);
      setOffline(false);
      setError(null);
      // Keep the saved copy fresh once the student has chosen to save it.
      const s = await getJSON(SAVED_KEY, null);
      if (s) { const next = { pass: p, at: new Date().toISOString() }; await setJSON(SAVED_KEY, next); setSaved(next); }
    } catch (err) {
      const s = await getJSON(SAVED_KEY, null);
      if (!(err instanceof ApiError) && s) { setPass(s.pass); setSaved(s); setOffline(true); setError(null); } else setError(err.message);
    }
  }, [token]);
  useEffect(() => { load(); getJSON(SAVED_KEY, null).then((s) => s && setSaved(s)); }, [load]);
  useEffect(() => {
    if (!pass || offline) return undefined;
    const id = setTimeout(load, pass.refreshInS * 1000);
    return () => clearTimeout(id);
  }, [pass, load, offline]);

  // Put the screen brightness back when leaving the pass.
  useEffect(() => () => {
    if (before.current != null && Platform.OS !== 'web') Brightness.setBrightnessAsync(before.current).catch(() => {});
  }, []);
  const toggleBright = useCallback(async () => {
    const next = !bright;
    setBright(next);
    if (Platform.OS === 'web') return;
    try {
      if (next) {
        before.current = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } else if (before.current != null) {
        await Brightness.setBrightnessAsync(before.current);
      }
    } catch {
      // Brightness is a nicety; the pass works without it.
    }
  }, [bright]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={bright ? 'Brightness boosted, tap to restore' : 'Boost brightness'} accessibilityState={{ selected: bright }} onPress={toggleBright} hitSlop={8}
          style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: bright ? C.navyFill : C.line2, backgroundColor: bright ? C.navyFill : C.card }, pressed && { opacity: 0.8 }]}>
          <Icon name="sun" size={20} color={bright ? '#fff' : C.ink} />
        </Pressable>
      ),
    });
  }, [navigation, bright, toggleBright]);

  const save = async () => {
    if (!pass) return;
    const s = { pass, at: new Date().toISOString() };
    await setJSON(SAVED_KEY, s);
    setSaved(s);
  };

  const left = pass ? Math.max(0, Math.round((new Date(pass.expiresAt).getTime() - now) / 1000)) : 0;
  const [tone, label] = STATUS[pass?.status] ?? ['offline', '…'];
  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {pass == null ? (
        <>
          <Skeleton height={236} />
          <Skeleton height={300} />
        </>
      ) : (
        <>
          <LinearGradient colors={['#1E3A8A', '#172554', '#0B1220']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 20, gap: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bus" size={18} color="#FBBF24" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 15, lineHeight: 19, ...F.display }}>Crescent Transit</Text>
                <Text style={{ color: '#BFD0F4', fontSize: 12 }}>{t('Student bus pass')}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: tone === 'live' ? 'rgba(34,197,94,0.16)' : 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: tone === 'live' ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.2)' }}>
                <Icon name={tone === 'live' ? 'tick' : tone === 'danger' ? 'alert' : 'clock'} size={13} color={tone === 'live' ? '#4ADE80' : tone === 'danger' ? '#FCA5A5' : '#FBBF24'} strokeWidth={2.6} />
                <Text style={{ color: tone === 'live' ? '#4ADE80' : tone === 'danger' ? '#FCA5A5' : '#FBBF24', fontSize: 12.5, ...F[600] }}>{t(label)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {pass.photo
                ? <Image source={{ uri: pass.photo }} style={{ width: 68, height: 68, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(147,180,255,0.6)' }} />
                : (
                  <LinearGradient colors={['#3B82F6', '#1D4ED8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 68, height: 68, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(147,180,255,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 22, ...F.displayBold }}>{initials(pass.name)}</Text>
                  </LinearGradient>
                )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: '#fff', fontSize: 21, lineHeight: 26, ...F.displayBold }} numberOfLines={2}>{pass.name}</Text>
                <Text style={{ color: '#9DBBFF', fontSize: 13.5, ...F[500] }}>{[pass.registerNo, pass.department].filter(Boolean).join(' · ') || 'Student'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)' }}>
              <Fact k={t('Route')} v={pass.routeCode ? `${pass.routeCode} · ${pass.routeName}` : '—'} />
              <Fact k={t('Stop')} v={pass.stopName ?? '—'} />
              <Fact k={t('Valid till')} v={pass.validTo ? date(pass.validTo) : t('Active')} />
            </View>
          </LinearGradient>

          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 20, alignItems: 'center', gap: 14, borderWidth: 1, borderColor: C.line2, ...(bright ? { shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } } : null) }}>
            <View accessibilityLabel={t('Show this code to the driver')}>
              <QRCode value={pass.code} size={bright ? 200 : 170} ecl="L" color="#0F172A" backgroundColor="#ffffff" />
            </View>
            <View style={{ alignSelf: 'stretch', gap: 8 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${offline ? 0 : (left / 90) * 100}%`, backgroundColor: '#2563EB', borderRadius: 3 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#0F172A', ...F[600], fontSize: 13, fontVariant: ['tabular-nums'] }}>{offline ? 'Offline copy' : `${t('New code in')} ${left} s`}</Text>
                <Text style={{ color: '#64748B', ...F[600], fontSize: 13, fontVariant: ['tabular-nums'] }}>Code {shortCode(pass.code)}</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={bright ? t('Brightness boosted') : t('Boost brightness')} variant={bright ? 'primary' : 'ghost'} icon="sun" onPress={toggleBright} style={{ flex: 1 }} />
            <Button title={saved ? 'Saved on phone' : 'Save to phone'} variant="ghost" icon={saved ? 'check' : 'download'} onPress={save} style={{ flex: 1 }} />
          </View>
          <Txt muted small style={{ textAlign: 'center' }}>
            {saved ? `Works offline · last synced ${ageLabel(saved.at, now)}` : pass.photo ? 'The code is checked by the driver’s app.' : 'Add your photo to the pass from the website.'}
          </Txt>
        </>
      )}
    </Screen>
  );
}
