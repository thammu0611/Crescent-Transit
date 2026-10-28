import { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { Screen, Skeleton, Text, Txt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { getJSON, setJSON } from '../../lib/storage.js';
import { C, F } from '../../theme.js';
import { FeedItem } from './StudentHome.js';

const KEY = 'ubts.alertsCleared';

/** Notifications: newest highlighted, "Clear all" hides what you've read. */
export default function Alerts({ navigation }) {
  const { token, entitlement } = useSession();
  const entitled = Boolean(entitlement?.active);
  const list = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const [cleared, setCleared] = useState(0);
  const { refreshing, onRefresh } = useRefresh(list);
  useEffect(() => { getJSON(KEY, 0).then((v) => setCleared(Number(v) || 0)); }, []);
  const items = (list.data ?? []).filter((n) => new Date(n.created_at).getTime() > cleared);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: items.length
        ? () => (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { const t = Date.now(); setJSON(KEY, t); setCleared(t); }}>
            <Text style={{ color: C.indigo, ...F[700] }}>Clear all</Text>
          </Pressable>
        )
        : undefined,
    });
  }, [navigation, items.length]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {!entitled && <Txt muted>Showing the notice board. Route alerts (delays, breakdowns, route changes) come with the subscription.</Txt>}
      {list.data == null ? <Skeleton height={120} /> : items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: C.indigo50, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={26} color={C.indigo} />
          </View>
          <Text style={{ fontSize: 18, ...F[800], color: C.ink }}>You're all caught up</Text>
          <Txt muted>New alerts for your route will appear here.</Txt>
        </View>
      ) : (
        <View style={{ gap: 8 }}>{items.map((n, i) => <FeedItem key={n.id} n={n} hot={i === 0} />)}</View>
      )}
    </Screen>
  );
}
