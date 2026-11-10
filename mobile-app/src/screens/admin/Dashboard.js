import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Block, ColumnChart, Donut, HBars, SERIES, dayLabel, ViewCard } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import { MiniMap } from '../../components/maps';
import {
  Avatar, Badge, Button, HeaderIconButton, IconBubble, LinkButton, ListCard, RouteCode, Row, Screen, SearchBox, SectionTitle,
  Segmented, Skeleton, Stat, StatGrid, Text, Txt,
} from '../../components/ui.js';
import { api, getSocket } from '../../lib/api.js';
import { METHOD_TEXT, dateTime, longDate, time } from '../../lib/format.js';
import { useAsync, useLive, useRefresh } from '../../lib/hooks.js';
import { greeting } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F, shadow } from '../../theme.js';

const titleCase = (k) => k.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Card({ title, icon, onSeeAll, seeAll = 'See all', children, right }) {
  return (
    <View style={{ backgroundColor: C.glass, borderRadius: 20, padding: 16, gap: 10, ...shadow }}>
      <Row gap={10}>
        <IconBubble name={icon} accent="navy" size={34} />
        <Txt bold style={{ flex: 1, fontSize: 16 }}>{title}</Txt>
        {right}
        {onSeeAll ? <Pressable accessibilityRole="button" onPress={onSeeAll} hitSlop={8}><Text style={{ color: C.indigo, ...F[700] }}>{seeAll}</Text></Pressable> : null}
      </Row>
      {children}
    </View>
  );
}

/** The top of an office home screen: date, title and the screen's one header action. */
export function GreetHeader({ title, right, name }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 }}>
      <Avatar name={name ?? title} size={46} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt muted small numberOfLines={1}>{greeting()} · {longDate()}</Txt>
        <Text style={{ color: C.ink, fontSize: 24, lineHeight: 30, ...F.displayBold }} numberOfLines={1}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

/** One key figure: an icon, its name, a big number and a short note. Opens its module. */
function Kpi({ icon, accent, label, value, note, tone, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? '—'}`} style={({ pressed }) => [{ flexBasis: '47%', flexGrow: 1, minHeight: 98, padding: 14, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line2, justifyContent: 'space-between' }, pressed && { opacity: 0.85 }]}>
      <Row gap={8}>
        <IconBubble name={icon} accent={accent} size={28} iconSize={15} />
        <Text style={{ fontSize: 12.5, ...F[500], color: C.muted, flex: 1 }} numberOfLines={1}>{label}</Text>
      </Row>
      <Row gap={6} style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 26, lineHeight: 32, ...F.displayBold, color: tone ?? C.ink, fontVariant: ['tabular-nums'] }}>{value ?? '—'}</Text>
        {note ? <Txt muted small style={{ paddingBottom: 4, flexShrink: 1 }} numberOfLines={1}>{note}</Txt> : null}
      </Row>
    </Pressable>
  );
}

const ACTIVITY = {
  trip_started: { icon: 'arrow', color: C.live, text: (a) => `Trip started · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  trip_ended: { icon: 'check', color: C.navy, text: (a) => `Trip completed · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  incident: { icon: 'alert', color: C.danger, text: (a) => titleCase(a.who ?? 'Incident'), sub: (a) => [a.fleet_code ?? (a.route_code && `route ${a.route_code}`), a.detail].filter(Boolean).join(' · ') || 'No details given' },
};

/** The transport office's home: fleet now, today's figures, trends, trips running and recent activity. */
export default function Dashboard({ navigation }) {
  const { token, user } = useSession();
  const kpis = useAsync(() => api('/api/admin/kpis', { token }), [token]);
  const overview = useAsync(() => api('/api/admin/overview?days=7', { token }), [token]);
  const trips = useAsync(() => api('/api/admin/trips?status=active', { token }), [token]);
  const { buses, ready } = useLive(token, null, true);
  const { refreshing, onRefresh } = useRefresh(kpis, overview, trips);
  const [trend, setTrend] = useState('present');
  const [tripQuery, setTripQuery] = useState('');
  const [activityQuery, setActivityQuery] = useState('');

  useEffect(() => {
    const id = setInterval(() => { kpis.reload(); trips.reload(); }, 15000);
    const slow = setInterval(() => overview.reload(), 60000);
    const socket = getSocket(token);
    const onIncident = () => { kpis.reload(); overview.reload(); };
    socket.on('incident', onIncident);
    return () => { clearInterval(id); clearInterval(slow); socket.off('incident', onIncident); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const k = kpis.data ?? {};
  const o = overview.data;
  const has = (query, values) => !query.trim() || values.some((v) => v && String(v).toLowerCase().includes(query.trim().toLowerCase()));
  const shownTrips = trips.data?.filter((t) => has(tripQuery, [t.route_code, t.route_name, t.fleet_code, t.driver_name]));
  const shownActivity = o?.activity.filter((a) => has(activityQuery, [ACTIVITY[a.kind].text(a), ACTIVITY[a.kind].sub(a)]));
  const tot = o?.totals ?? {};
  const counts = buses.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {});
  const idle = Math.max(0, (tot.buses_active ?? 0) - buses.length);
  const series = o?.series?.map((d) => ({ label: dayLabel(d.date), value: d[trend] }));
  const weekTotal = o?.series?.reduce((n, d) => n + d[trend], 0);

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <GreetHeader title="Dashboard" name={user?.name} right={<HeaderIconButton dark icon="bell" label="Alerts and incidents" badge={k.openIncidents} onPress={() => navigation.navigate('Notices')} />} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi icon="bus" accent="navy" label="Buses on trip" value={ready ? buses.length : null} note={`of ${tot.buses ?? '—'}`} onPress={() => navigation.navigate('FleetMap')} />
        <Kpi icon="signal" accent="emerald" label="Live now" value={ready ? counts.live ?? 0 : null} note="GPS < 30 s" onPress={() => navigation.navigate('FleetMap')} />
        <Kpi icon="clock" accent="amber" label="Delayed" value={ready ? counts.delayed ?? 0 : null} note={counts.offline ? `${counts.offline} offline` : 'signal late'} tone={counts.delayed ? C.delayed : undefined} onPress={() => navigation.navigate('FleetMap')} />
        <Kpi icon="check" accent="emerald" label="Attendance" value={k.presentUpToday == null ? null : `${k.presentUpToday}/${k.presentDownToday}`} note="in / out today" onPress={() => navigation.navigate('AttendanceAdmin')} />
        <Kpi icon="alert" accent="danger" label="Open incidents" value={k.openIncidents} tone={k.openIncidents ? C.danger : undefined} onPress={() => navigation.navigate('Notices')} />
        <Kpi icon="card" accent="navy" label="Active passes" value={tot.subscribers} note="students" onPress={() => navigation.navigate('Reports')} />
      </View>
      {k.awaitingReview ? (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AttendanceAdmin')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line2 }, pressed && { opacity: 0.85 }]}>
          <Badge tone="delayed">{k.awaitingReview} to review</Badge>
          <Txt bold style={{ flex: 1 }}>Attendance disputes</Txt>
          <Icon name="arrow" size={18} color={C.faint} />
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Trips today" variant="ghost" icon="clock" onPress={() => navigation.navigate('Trips')} style={{ flex: 1 }} />
        <Button title="Announce" variant="ghost" icon="bell" onPress={() => navigation.navigate('Notices')} style={{ flex: 1 }} />
      </View>

      <Block
        title={trend === 'present' ? 'Riders, last 7 days' : 'Trips, last 7 days'}
        caption={weekTotal == null ? ' ' : `${weekTotal} ${trend === 'present' ? 'students boarded' : 'trips run'} this week`}
      >
        <Segmented value={trend} onChange={setTrend} options={[{ value: 'present', label: 'Riders' }, { value: 'trips', label: 'Trips' }]} />
        <ColumnChart data={series} color={trend === 'present' ? C.navy : C.emerald} />
      </Block>

      <Block title="Fleet status" caption="Buses on trip by signal, and active buses waiting">
        {ready && o ? (
          <Donut
            caption="buses"
            center={tot.buses_active ?? buses.length}
            segments={[
              { label: 'Live', value: counts.live ?? 0, color: C.live },
              { label: 'Delayed signal', value: counts.delayed ?? 0, color: C.delayed },
              { label: 'Offline', value: counts.offline ?? 0, color: C.offline },
              { label: 'Not on trip', value: idle, color: C.navy100 },
            ]}
          />
        ) : <Skeleton height={128} />}
        <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.glassEdge }}>
          <MiniMap buses={buses} labels height={180} />
        </View>
        <Button small variant="ghost" icon="map" title="Open fleet map" onPress={() => navigation.navigate('FleetMap')} />
      </Block>

      <Block title="How students boarded" caption="Last 7 days, by attendance method">
        {o == null ? <Skeleton height={128} /> : o.methods.length === 0 ? <Txt muted>No boardings recorded this week.</Txt> : (
          <Donut caption="boardings" segments={o.methods.map((m, i) => ({ label: METHOD_TEXT[m.method] ?? m.method, value: m.n, color: SERIES[i % SERIES.length] }))} />
        )}
      </Block>

      <Block title="Busiest routes" caption="Students boarded in the last 7 days">
        <HBars rows={o?.routes} label={(r) => `${r.code} · ${r.name}`} value={(r) => r.riders} />
      </Block>

      <SectionTitle title="Operations" />
      <StatGrid>
        <Stat icon="signal" label="Avg update delay" value={k.avgUpdateDelayS == null ? '—' : `${k.avgUpdateDelayS}s`} />
        <Stat icon="shield" label="GPS rejects today" value={k.gpsFailuresToday} tone={k.gpsFailuresToday ? 'delayed' : undefined} />
        <Stat icon="user" label="Active drivers" value={tot.drivers} />
        <Stat icon="route" label="Active routes" value={tot.routes} />
      </StatGrid>

      <ViewCard
        icon="bus"
        title="Trips running now"
        summary={trips.data == null ? 'Loading…' : trips.data.length === 0 ? 'No trips running' : `${trips.data.length} trip${trips.data.length === 1 ? '' : 's'} · ${trips.data.reduce((n, t) => n + (Number(t.attendance) || 0), 0)} riders on board`}
        badge={trips.data?.some((t) => t.flagged) ? <Badge tone="danger">Flagged</Badge> : null}
      >
        {(close) => (<>
        <SearchBox value={tripQuery} onChange={setTripQuery} placeholder="Search route, bus or driver" />
        {trips.data == null ? <Skeleton /> : shownTrips.length === 0 ? <Txt muted>{tripQuery ? 'No trips match.' : 'No trips running.'}</Txt> : shownTrips.map((t) => (
          <ListCard
            key={t.id}
            tone={t.flagged ? 'danger' : 'live'}
            lead={<RouteCode code={t.route_code} />}
            title={t.route_name}
            lines={[`${t.fleet_code} · ${t.driver_name ?? 'No driver'}`, t.flagged ? t.flag_reason : `Since ${time(t.started_at)}`]}
            count={t.attendance}
            countLabel="RIDERS"
            onPress={() => { close(); navigation.navigate('Trips'); }}
          />
        ))}
        <LinkButton title="All trips" icon="arrow" onPress={() => { close(); navigation.navigate('Trips'); }} />
        </>)}
      </ViewCard>

      <ViewCard
        icon="list"
        title="Recent activity"
        summary={o == null ? 'Loading…' : o.activity.length ? `${ACTIVITY[o.activity[0].kind].text(o.activity[0])} · ${dateTime(o.activity[0].at)}` : 'No activity yet'}
      >
        <SearchBox value={activityQuery} onChange={setActivityQuery} placeholder="Search route, bus or person" />
        {o == null ? <Skeleton /> : shownActivity.length === 0 ? <Txt muted>{activityQuery ? 'No activity matches.' : 'No activity yet.'}</Txt> : shownActivity.map((a, idx) => {
          const kind = ACTIVITY[a.kind];
          return (
            <ListCard
              key={`${a.kind}-${a.at}-${idx}`}
              lead={<View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: `${kind.color}1f`, alignItems: 'center', justifyContent: 'center' }}><Icon name={kind.icon} size={18} color={kind.color} /></View>}
              title={kind.text(a)}
              lines={[kind.sub(a), dateTime(a.at)]}
            />
          );
        })}
      </ViewCard>
    </Screen>
  );
}
