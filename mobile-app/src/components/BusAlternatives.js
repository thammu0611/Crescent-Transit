import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { api, getSocket } from '../lib/api.js';
import { pushRegistered, showNotification } from '../lib/notify.js';
import { describeOption } from '../lib/rules.js';
import { useSession } from '../lib/session.js';
import { C, F, R } from '../theme.js';
import Icon from './Icon.js';
import { Button, RouteCode, Sheet, Text, Txt } from './ui.js';

const keyOf = (a) => `${a.date}:${a.direction}`;
const busName = (fleetCode) => fleetCode.replace('BSACIST-', 'Bus ');

/**
 * "Another bus can take you" (server/alternatives.js). Pops up by itself when
 * the student's bus has passed, gone quiet or not started and a bus of another
 * route can still pick them up near their stop. Once closed it stays closed for
 * that run. `onTrack(routeCode)` opens that route on the live map.
 */
export default function BusAlternatives({ onTrack }) {
  const { token, user } = useSession();
  const [alert, setAlert] = useState(null);
  const [seen, setSeen] = useState(null);
  const student = user?.role === 'student';

  const load = useCallback(async () => {
    if (!token || !student) return;
    try {
      setAlert(await api('/api/alternatives', { token }));
    } catch {
      // Not critical: the next check brings it.
    }
  }, [token, student]);

  useEffect(() => {
    if (!token || !student) return undefined;
    load();
    const socket = getSocket(token);
    const onAlert = (a) => {
      setAlert(a);
      if (!pushRegistered()) showNotification('Another bus can take you', a.message);
    };
    const onApproaching = (a) => { if (!pushRegistered()) showNotification(a.title, a.body); };
    socket.on('bus:alternatives', onAlert);
    socket.on('bus:approaching', onApproaching);
    socket.on('connect', load);
    const appState = AppState.addEventListener('change', (s) => s === 'active' && load());
    const timer = setInterval(load, 60000);
    return () => {
      socket.off('bus:alternatives', onAlert);
      socket.off('bus:approaching', onApproaching);
      socket.off('connect', load);
      appState.remove();
      clearInterval(timer);
    };
  }, [token, student, load]);

  if (!alert?.options?.length || seen === keyOf(alert)) return null;
  const close = () => setSeen(keyOf(alert));

  return (
    <Sheet onClose={close}>
      <View style={{ gap: 10, paddingBottom: 4 }}>
        <View style={{ alignSelf: 'center', width: 58, height: 58, borderRadius: 18, backgroundColor: C.red50, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bus" size={28} color={C.red600} />
        </View>
        <Text style={{ fontSize: 22, ...F.display, color: C.ink, textAlign: 'center' }}>Another bus can take you</Text>
        <Txt muted style={{ textAlign: 'center' }}>{alert.message}</Txt>
        {alert.options.map((o) => {
          const [first, second] = describeOption(o);
          return (
            <Pressable
              key={o.busId}
              accessibilityRole="button"
              onPress={() => { close(); onTrack?.(o.routeCode); }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.md, backgroundColor: C.surface }, pressed && { opacity: 0.8 }]}
            >
              <RouteCode code={o.routeCode} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt bold numberOfLines={1}>{busName(o.fleetCode)} · {o.routeName}</Txt>
                <Txt small muted>{first}</Txt>
                <Txt small muted>{second}</Txt>
              </View>
              <Icon name="arrow" size={15} color={C.faint} />
            </Pressable>
          );
        })}
        <Button title="OK, got it" variant="ghost" onPress={close} />
      </View>
    </Sheet>
  );
}
