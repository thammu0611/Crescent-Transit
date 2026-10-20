import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Screen, Select, Skeleton, Text, Txt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { longDate } from '../../lib/format.js';
import { useAsync, useLive, useRefresh } from '../../lib/hooks.js';
import { nowMinutes, parseTime, prettyTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F } from '../../theme.js';

function Stop({ time, name, note, tags = [], active, mine, passed, bus }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, opacity: passed ? 0.5 : 1 }}>
      <Text style={{ width: 74, fontVariant: ['tabular-nums'], color: active ? C.indigo : C.muted, fontWeight: active ? '800' : '600', paddingTop: 2 }}>{time}</Text>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: active ? C.indigo : mine ? C.gold : '#fff', borderWidth: 2, borderColor: active ? C.indigo : C.line }} />
        <View style={{ width: 2, flex: 1, backgroundColor: C.line, minHeight: 18 }} />
      </View>
      <View style={{ flex: 1, paddingBottom: 14, gap: 4 }}>
        <Txt bold={active || mine}>{name}</Txt>
        {note ? <Txt muted small>{note}</Txt> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(([label, color]) => (
            <Text key={label} style={{ fontSize: 11, ...F[800], color: '#fff', backgroundColor: color, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, overflow: 'hidden' }}>{label}</Text>
          ))}
          <Text style={{ fontSize: 11, color: C.muted }}>Bus {bus}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The route timetable as a schedule: date header with the route picker, the
 * morning run stop by stop with the bus's live position marked, and the
 * evening run from campus.
 */
export default function Schedule({ navigation }) {
  const { token, user, entitlement } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  useEffect(() => { if (!code && routes.data?.length) setCode(routes.data[0].code); }, [routes.data, code]);
  const route = useAsync(() => (code ? api(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const { buses } = useLive(token, code, Boolean(entitlement?.active && code));
  const { refreshing, onRefresh } = useRefresh(routes, route);
  const bus = buses.find((b) => b.freshness !== 'offline');
  const here = bus?.nearestStop?.seq;
  const mine = code === user?.homeRouteCode ? user?.homeStopSeq : null;
  const now = nowMinutes();
  const stops = route.data?.stops ?? [];
  // The next stop in the timetable, used when no bus is live.
  const nextSeq = stops.find((s) => (parseTime(s.scheduled_time) ?? -1) >= now)?.seq;
  const eveningActive = parseTime(route.data?.evening_departure) >= now;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Button title="View bus stoppage points" variant="indigo" icon="pin" onPress={() => navigation.navigate('Track')} />
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge }}>
        <View style={{ backgroundColor: C.navy, padding: 14, gap: 10 }}>
          <Text style={{ color: '#fff', ...F[700] }}>{longDate()}</Text>
          <Select compact label="Route" value={code} onChange={setCode} options={(routes.data ?? []).map((r) => ({ value: r.code, label: `Route ${r.code} · ${r.name}` }))} />
        </View>
        <View style={{ padding: 14 }}>
          <Txt bold style={{ color: C.indigo, marginBottom: 10 }}>{route.data?.start_point ?? '…'} to Campus</Txt>
          {route.data == null ? <Skeleton height={200} /> : stops.map((s) => {
            const active = bus ? s.seq === here : s.seq === nextSeq;
            const tags = [];
            if (active) tags.push([bus ? 'Bus here' : 'Next', C.indigo]);
            if (s.seq === mine) tags.push(['Your stop', C.gold]);
            return <Stop key={s.seq} time={prettyTime(s.scheduled_time)} name={s.name} tags={tags} active={active} mine={s.seq === mine} passed={Boolean(bus && here && s.seq < here)} bus={route.data.code} />;
          })}
          <Txt bold style={{ color: C.indigo, marginVertical: 10 }}>Campus to {route.data?.start_point ?? '…'}</Txt>
          <Stop
            time={prettyTime(route.data?.evening_departure)}
            name="Departs BSACIST campus"
            note="Stops in reverse order; evening stop times are not printed in the timetable."
            active={eveningActive}
            tags={eveningActive ? [['Next', C.indigo]] : []}
            bus={route.data?.code}
          />
        </View>
      </View>
    </Screen>
  );
}
