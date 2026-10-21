import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { prettyTime } from '../lib/schedule.js';
import { useSession } from '../lib/session.js';
import { C, F } from '../theme.js';
import Icon from './Icon.js';
import { Button, ErrorText, SearchBox, Select, Skeleton, Text, Txt } from './ui.js';

/**
 * "Select your route": chosen once, changeable any time in Settings. Every day
 * after that the home screen shows this route's bus.
 */
export default function SelectRoute({ onDone }) {
  const { token, user, refresh } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  const [stopSeq, setStopSeq] = useState(user?.homeStopSeq ?? '');
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const route = useAsync(() => (code ? api(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const list = useMemo(
    () => (routes.data ?? []).filter((r) => !q || `${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase())),
    [routes.data, q],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me', { token, method: 'PATCH', body: { homeRouteCode: code, homeStopSeq: stopSeq ? Number(stopSeq) : null } });
      await refresh();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: C.indigo50, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="route" size={26} color={C.indigo} />
        </View>
        <Text style={{ fontSize: 22, ...F.display, color: C.ink }}>Select your route</Text>
        <Txt muted style={{ textAlign: 'center' }}>Choose the route you travel on. Every day you will see where its bus is and when it reaches your stop. You can change it any time.</Txt>
      </View>
      <SearchBox value={q} onChange={setQ} placeholder="Search route number or area" />
      <ErrorText>{routes.error?.message}</ErrorText>
      {routes.data == null && !routes.error ? <Skeleton height={200} /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {list.map((r) => {
            const on = code === r.code;
            return (
              <Pressable
                key={r.code}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => { setCode(r.code); setStopSeq(''); }}
                style={{ flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: on ? C.indigo : C.line2, backgroundColor: on ? C.indigo50 : '#fff', gap: 4 }}
              >
                <Icon name="bus" size={18} color={on ? C.indigo : C.navy} />
                <Text style={{ ...F[800], color: C.ink }}>Route {r.code}</Text>
                <Txt muted small numberOfLines={2}>{r.name}</Txt>
              </Pressable>
            );
          })}
        </View>
      )}
      {route.data && (
        <View style={{ gap: 8 }}>
          <Txt muted small>{route.data.stops.map((s) => s.name).join('  ·  ')}</Txt>
          <Select
            label="Your boarding stop"
            value={stopSeq}
            onChange={setStopSeq}
            placeholder="Choose your stop"
            options={route.data.stops.map((s) => ({ value: s.seq, label: `${s.name} · ${prettyTime(s.scheduled_time)}` }))}
          />
        </View>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? 'Saving…' : 'Continue'} variant="dark" icon="arrow" disabled={!code || !stopSeq} busy={busy} onPress={save} />
    </View>
  );
}
