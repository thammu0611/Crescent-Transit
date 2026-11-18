import { Linking, Pressable, View } from 'react-native';
import Icon from '../components/Icon.js';
import {
  Button, ErrorText, HeroHeader, IconBubble, NavPill, Panel, Screen, Skeleton, Text, Txt,
} from '../components/ui.js';
import { api } from '../lib/api.js';
import { useAsync, useRefresh } from '../lib/hooks.js';
import { C, F, G } from '../theme.js';

export const call = (phone) => Linking.openURL(`tel:${String(phone).replace(/\s/g, '')}`);

/** The transport office and emergency numbers, one tap to call. */
function Contacts() {
  const contacts = useAsync(() => api('/api/contacts'), []);
  return (
    <Panel title="Need help?" icon="phone">
      {contacts.data == null ? <Skeleton /> : contacts.data.map((c, i) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${c.label}, ${c.phone}`}
          key={c.label}
          onPress={() => call(c.phone)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line2, opacity: pressed ? 0.6 : 1 })}
        >
          <IconBubble name="phone" accent="red" size={36} />
          <View style={{ flex: 1 }}>
            <Txt bold>{c.label}</Txt>
            <Txt small style={{ color: C.red600, ...F[700] }}>{c.phone}</Txt>
          </View>
          <Icon name="arrow" size={16} color={C.faint} />
        </Pressable>
      ))}
    </Panel>
  );
}

export default function PublicHome({ navigation }) {
  const health = useAsync(() => api('/api/health'), []);
  const { refreshing, onRefresh } = useRefresh(health);

  const hero = (
    <HeroHeader colors={G.navy}>
      <View style={{ gap: 14 }}>
        {/* The navigation pill, as at the top of the web app's landing page. */}
        <NavPill glass />
        <Text style={{ color: '#fff', fontSize: 28, ...F.display, lineHeight: 34 }}>
          Know where your bus is. <Text style={{ color: C.gold }}>Every minute.</Text>
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21, ...F[400] }}>One stop for every BSACIST</Text>
        {/* Sign in and Sign up together, the same two choices as on the sign-in screen. */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Sign in" variant="hero" icon="arrow" onPress={() => navigation.navigate('Login', { mode: 'signin' })} style={{ flex: 1 }} />
          <Button title="Sign up" variant="onDark" icon="plus" onPress={() => navigation.navigate('Login', { mode: 'register' })} style={{ flex: 1 }} />
        </View>
      </View>
    </HeroHeader>
  );

  return (
    <Screen header={hero} refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{health.error ? `${health.error.message} You can change the server address on the sign-in screen.` : null}</ErrorText>

      <Contacts />

      <Txt muted small style={{ textAlign: 'center', paddingVertical: 10 }}>Crescent Transit · B.S. Abdur Rahman Crescent Institute of Science & Technology</Txt>
    </Screen>
  );
}
