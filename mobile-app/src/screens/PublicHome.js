import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Icon from '../components/Icon.js';
import {
  Button, Empty, ErrorText, HeroHeader, IconBubble, NavPill, Panel, PillButton, RouteCode, Screen, Skeleton, Text,
  Txt,
} from '../components/ui.js';
import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { useAsync, useRefresh } from '../lib/hooks.js';
import { C, F, G, R, shadow } from '../theme.js';

export const call = (phone) => Linking.openURL(`tel:${String(phone).replace(/\s/g, '')}`);

/** A panel that shows only its title and a count until it is tapped open. */
function Fold({ title, icon, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel style={{ padding: 0, gap: 0 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: R.lg, backgroundColor: pressed ? C.surface : 'transparent' })}
      >
        <IconBubble name={icon} colors={G.navy} size={36} iconSize={18} />
        <Text style={{ flex: 1, fontSize: 17, ...F[600], color: C.ink }}>{title}</Text>
        {count != null ? (
          <View style={{ minWidth: 28, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, backgroundColor: C.red50, alignItems: 'center' }}>
            <Text style={{ color: C.red600, ...F[700], fontSize: 12 }}>{count}</Text>
          </View>
        ) : null}
        <Icon name={open ? 'up' : 'down'} size={18} color={C.muted} />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>{children}</View> : null}
    </Panel>
  );
}

/**
 * The free view (doc 8.4): route list, stops and timetable, the notice board
 * and emergency contacts - for everyone, signed in or not, paid or not.
 */
export function FreeView({ showRoutes = true }) {
  const routes = useAsync(() => api('/api/routes'), []);
  const notices = useAsync(() => api('/api/notices'), []);
  const contacts = useAsync(() => api('/api/contacts'), []);
  const [open, setOpen] = useState(null);
  const route = useAsync(() => (open ? api(`/api/routes/${encodeURIComponent(open)}`) : Promise.resolve(null)), [open]);

  return (
    <View style={{ gap: 14 }}>
      <Fold title="Notice board" icon="bell" count={notices.data?.length}>
        {notices.data == null ? <Skeleton /> : notices.data.length ? notices.data.map((n) => (
          <View key={n.id} style={{ borderLeftWidth: 3, borderLeftColor: C.gold, paddingLeft: 10, gap: 2 }}>
            <Txt bold>{n.title}</Txt>
            <Txt small>{n.message}</Txt>
            <Txt muted small>{date(n.created_at)}</Txt>
          </View>
        )) : <Empty>No notices.</Empty>}
      </Fold>
      <Panel title="Emergency contacts" icon="phone">
        {(contacts.data ?? []).map((c) => (
          <Pressable key={c.label} onPress={() => call(c.phone)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
            <Txt>{c.label}</Txt>
            <Txt style={{ color: C.indigo, ...F[700] }}>{c.phone}</Txt>
          </Pressable>
        ))}
      </Panel>
      {showRoutes && (
        <Fold title="Routes and timetable" icon="route" count={routes.data?.length}>
          <ErrorText>{routes.error?.message}</ErrorText>
          {routes.data == null && !routes.error && <Skeleton height={160} />}
          {(routes.data ?? []).map((r) => (
            <View key={r.code}>
              <Pressable
                onPress={() => setOpen(open === r.code ? null : r.code)}
                accessibilityState={{ expanded: open === r.code }}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line2 }}
              >
                <RouteCode code={r.code} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{r.name}</Txt>
                  <Txt muted small>{r.stop_count} stops · departs {r.departure_time} · {r.bus_type ?? 'bus'}</Txt>
                </View>
                <Icon name={open === r.code ? 'up' : 'down'} size={16} color={C.muted} />
              </Pressable>
              {open === r.code && (route.data ? (
                <View style={{ paddingVertical: 6, paddingLeft: 12 }}>
                  {route.data.stops.map((s) => (
                    <View key={s.seq} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                      <Txt small style={{ flex: 1 }}>{s.name}</Txt>
                      <Txt small muted>{s.scheduled_time}</Txt>
                    </View>
                  ))}
                </View>
              ) : <Skeleton />)}
            </View>
          ))}
        </Fold>
      )}
    </View>
  );
}

const FEATURES = [
  ['map', G.emerald, 'Live tracking', 'Every bus on the map, updated every few seconds, with Live, Delayed and Offline shown honestly.'],
  ['clock', G.indigo, 'Arrival estimates', 'A range, not a guess: “7–11 min” to your stop, and when to leave home.'],
  ['check', G.red, 'Automatic attendance', 'Your phone and the bus travel together; confirm with one tap. No location is ever stored.'],
  ['bell', G.violet, 'Boarding reminders', 'When your bus leaves your stop, “Did you board?” pops up — and reminds you every 10 minutes until you answer.'],
];

const STEPS = [
  ['route', 'Choose your route', 'Pick your bus and your boarding stop once. Change it any time.'],
  ['map', 'Track it live', 'See your bus move, how far it is, and when it reaches your stop.'],
  ['check', 'Confirm with one tap', '“Are you on Bus 118?” — tap Yes and your attendance is recorded.'],
];

export default function PublicHome({ navigation }) {
  const routes = useAsync(() => api('/api/routes'), []);
  const health = useAsync(() => api('/api/health'), []);
  const stops = (routes.data ?? []).reduce((n, r) => n + r.stop_count, 0);
  const { refreshing, onRefresh } = useRefresh(routes, health);

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
        <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 23 }}>
          Live positions for every BSACIST bus, arrival estimates for your stop, alerts, and attendance that marks itself. Routes, stops and timings are free for everyone.
        </Text>
        <Button title="Sign in or register" variant="red" icon="arrow" onPress={() => navigation.navigate('Login')} />
        <View style={{ flexDirection: 'row', gap: 40, marginTop: 4 }}>
          {[[routes.data?.length ?? '—', 'routes'], [stops || '—', 'boarding points']].map(([v, l]) => (
            <View key={l}>
              <Text style={{ color: '#fff', fontSize: 22, ...F.display }}>{v}</Text>
              <Text style={{ color: 'rgba(249, 210, 122,0.8)', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', ...F[600] }}>{l}</Text>
            </View>
          ))}
        </View>
      </View>
    </HeroHeader>
  );

  return (
    <Screen header={hero} refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{health.error ? `${health.error.message} You can change the server address on the sign-in screen.` : null}</ErrorText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {FEATURES.map(([icon, color, title, text]) => (
          <View key={title} style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: C.glass, borderRadius: R.lg, padding: 18, gap: 8, borderWidth: 1, borderColor: C.glassEdge, ...shadow }}>
            <IconBubble name={icon} colors={color} size={44} />
            <Txt bold>{title}</Txt>
            <Txt muted small>{text}</Txt>
          </View>
        ))}
      </View>

      <Panel title="From your stop to campus in three steps" icon="sparkle">
        {STEPS.map(([icon, title, text], i) => (
          <View key={title} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.navy, borderWidth: 1, borderColor: C.gold, alignItems: 'center', justifyContent: 'center' }}>
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

      <Text style={{ fontSize: 11, ...F[700], letterSpacing: 2.2, color: C.red600 }}>FREE FOR EVERYONE</Text>
      <FreeView />

      <Pressable onPress={() => call('+91 44 2275 1347')} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Txt muted small style={{ textAlign: 'center' }}>Crescent Transit · B.S. Abdur Rahman Crescent Institute of Science & Technology</Txt>
        <Txt small style={{ color: C.red600, ...F[700] }}>Transport office +91 44 2275 1347</Txt>
      </Pressable>
    </Screen>
  );
}
