import { Linking, Pressable, View } from 'react-native';
import Icon from '../components/Icon.js';
import {
  Button, ErrorText, HeroHeader, IconBubble, NavPill, Panel, PillButton, Screen, Skeleton, Text, Txt,
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

const STEPS = [
  ['route', 'Choose your route', 'Pick your bus and your boarding stop once. Change it any time.'],
  ['map', 'Track it live', 'See your bus move, how far it is, and when it reaches your stop.'],
  ['check', 'Confirm with one tap', '“Are you on Bus 118?” — tap Yes and your attendance is recorded.'],
];

export default function PublicHome({ navigation }) {
  const health = useAsync(() => api('/api/health'), []);
  const { refreshing, onRefresh } = useRefresh(health);

  const hero = (
    <HeroHeader colors={G.navy}>
      <View style={{ gap: 14 }}>
        {/* The navigation pill, as at the top of the web app's landing page. */}
        <NavPill glass right={<PillButton title="Sign in" onPress={() => navigation.navigate('Login')} />} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(247, 188, 49,0.3)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: health.data ? C.live : C.offline }} />
          <Text style={{ color: '#fff', ...F[700], fontSize: 13 }}>{health.data ? `${health.data.liveBuses} buses on trip right now` : health.error ? 'Server not reachable' : 'Live bus tracking'}</Text>
        </View>
        <Text style={{ color: '#fff', fontSize: 28, ...F.display, lineHeight: 34 }}>
          Know where your bus is. <Text style={{ color: C.gold }}>Every minute.</Text>
        </Text>
        <Button title="Sign in or register" variant="red" icon="arrow" onPress={() => navigation.navigate('Login')} />
      </View>
    </HeroHeader>
  );

  return (
    <Screen header={hero} refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{health.error ? `${health.error.message} You can change the server address on the sign-in screen.` : null}</ErrorText>

      <Panel title="From your stop to campus in three steps" icon="sparkle">
        {STEPS.map(([icon, title, text], i) => (
          <View key={title} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.navyFill, borderWidth: 1, borderColor: C.gold, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: C.gold, ...F[700], fontSize: 15 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Txt bold>{title}</Txt>
              <Txt muted small>{text}</Txt>
            </View>
            <Icon name={icon} size={18} color={C.muted} />
          </View>
        ))}
      </Panel>

      <Contacts />

      <Pressable accessibilityRole="button" onPress={() => call('+91 44 2275 1347')} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Txt muted small style={{ textAlign: 'center' }}>Crescent Transit · B.S. Abdur Rahman Crescent Institute of Science & Technology</Txt>
        <Txt small style={{ color: C.red600, ...F[700] }}>Transport office +91 44 2275 1347</Txt>
      </Pressable>
    </Screen>
  );
}
