import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Block, ColumnChart, Donut, Figure, HBars, SERIES, dayLabel } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import { MiniMap } from '../../components/maps';
import {
  Avatar, Badge, Button, FoldCard, GradientCard, HeaderIconButton, HeroHeader, IconBubble, LinkButton, RouteCode, Row, Screen, SectionTitle,
  Segmented, Skeleton, Stat, StatGrid, Text, Txt,
} from '../../components/ui.js';
import { api, getSocket } from '../../lib/api.js';
import { METHOD_TEXT, dateTime, longDate, time } from '../../lib/format.js';
import { useAsync, useLive, useRefresh } from '../../lib/hooks.js';
import { greeting } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F, FRESH_COLOR, G, shadow } from '../../theme.js';

const URGENT = ['SOS', 'EMERGENCY', 'BREAKDOWN', 'CAPACITY_BREACH'];
const titleCase = (k) => k.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Card({ title, icon, onSeeAll, seeAll = 'See all', children, right }) {
  return (
    <View style={{ backgroundColor: C.glass, borderRadius: 20, padding: 16, gap: 10, ...shadow }}>
      <Row gap={10}>
        <IconBubble name={icon} accent="navy" size={34} />
        <Txt bold style={{ flex: 1, fontSize: 16 }}>{title}</Txt>
        {right}
        {onSeeAll ? <Pressable onPress={onSeeAll} hitSlop={8}><Text style={{ color: C.indigo, ...F[700] }}>{seeAll}</Text></Pressable> : null}
      </Row>
      {children}
    </View>
  );
}

export function GreetHeader({ title, right, name }) {
  return (
    <HeroHeader colors={G.navy}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={name ?? title} size={48} light />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#f9d27a', fontSize: 15, ...F[500] }}>{greeting()},</Text>
          <Text style={{ color: '#fff', fontSize: 24, ...F.display }}>{title}</Text>
        </View>
        {right}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 14, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Icon name="clock" size={13} color={C.gold} />
        <Text style={{ color: '#fff', ...F[700], fontSize: 13 }}>{longDate()}</Text>
      </View>
    </HeroHeader>
  );
}

// Each shortcut in its own colour from the site's palette, as on the web dashboard:
// [gradient, soft tint, line].
const SHORTCUT_TONE = {
  navy: [['#2a4787', '#1c315e'], 'rgba(28,49,94,0.08)', '#1c315e'],
  green: [['#61ce70', '#2b8a3e'], 'rgba(97,206,112,0.14)', '#2b8a3e'],
  blue: [['#6ec1e4', '#0170b9'], 'rgba(110,193,228,0.18)', '#0170b9'],
  red: [['#c4373a', '#a02022'], 'rgba(160,32,34,0.10)', '#a02022'],
};

/** A shortcut tile: a coloured icon, the label, and a coloured line along the bottom. */
function Shortcut({ icon, label, tone = 'navy', onPress }) {
  const [colors, soft, line] = SHORTCUT_TONE[tone];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ flex: 1, alignItems: 'center', gap: 8, paddingTop: 14, paddingBottom: 16, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden', ...shadow, shadowOpacity: 0.06 }, pressed && { transform: [{ scale: 0.96 }] }]}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: soft }} />
      <IconBubble name={icon} colors={colors} size={40} />
      <Text style={{ fontSize: 12, ...F.navBold, color: C.ink }} numberOfLines={1}>{label}</Text>
      <View style={{ position: 'absolute', left: 14, right: 14, bottom: 0, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: line, opacity: 0.85 }} />
    </Pressable>
  );
}

const ACTIVITY = {
  trip_started: { icon: 'arrow', color: C.live, text: (a) => `Trip started · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  trip_ended: { icon: 'check', color: C.navy, text: (a) => `Trip completed · route ${a.route_code}`, sub: (a) => `${a.fleet_code}${a.who ? ` · ${a.who}` : ''}` },
  incident: { icon: 'alert', color: C.danger, text: (a) => titleCase(a.who ?? 'Incident'), sub: (a) => [a.fleet_code ?? (a.route_code && `route ${a.route_code}`), a.detail].filter(Boolean).join(' · ') || 'No details given' },
};

/** The transport office's home: fleet now, today's figures, trends and what needs attention. */
export default function Dashboard({ navigation }) {
  const { token, user } = useSession();
  const kpis = useAsync(() => api('/api/admin/kpis', { token }), [token]);
  const overview = useAsync(() => api('/api/admin/overview?days=7', { token }), [token]);
  const incidents = useAsync(() => api('/api/admin/incidents?status=OPEN', { token }), [token]);
  const trips = useAsync(() => api('/api/admin/trips?status=active', { token }), [token]);
  const { buses, ready } = useLive(token, null, true);
  const { refreshing, onRefresh } = useRefresh(kpis, overview, incidents, trips);
  const [trend, setTrend] = useState('present');

  useEffect(() => {
    const id = setInterval(() => { kpis.reload(); trips.reload(); }, 15000);
    const slow = setInterval(() => overview.reload(), 60000);
    const socket = getSocket(token);
    const onIncident = () => { incidents.reload(); kpis.reload(); overview.reload(); };
    socket.on('incident', onIncident);
    return () => { clearInterval(id); clearInterval(slow); socket.off('incident', onIncident); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const k = kpis.data ?? {};
  const o = overview.data;
  const tot = o?.totals ?? {};
  const counts = buses.reduce((c, b) => ({ ...c, [b.freshness]: (c[b.freshness] ?? 0) + 1 }), {});
  const idle = Math.max(0, (tot.buses_active ?? 0) - buses.length);
  const open = incidents.data ?? null;
  const series = o?.series?.map((d) => ({ label: dayLabel(d.date), value: d[trend] }));
  const weekTotal = o?.series?.reduce((n, d) => n + d[trend], 0);

  return (
    <Screen
      header={<GreetHeader title="Transport office" name={user?.name} right={<HeaderIconButton icon="bell" label="Alerts and incidents" badge={k.openIncidents} onPress={() => navigation.navigate('Notices')} />} />}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Fleet now */}
      <GradientCard colors={G.navy}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: C.gold, fontSize: 11, ...F[700], letterSpacing: 1.8 }}>FLEET NOW</Text>
          <Row gap={6}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#61ce70' }} />
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Live</Text>
          </Row>
        </Row>
        <Row gap={12} style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 46, lineHeight: 52, ...F.display }}>{ready ? buses.length : '—'}</Text>
          <View style={{ paddingBottom: 8 }}>
            <Text style={{ color: '#fff', ...F[700] }}>buses on trip</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>of {tot.buses ?? '—'} in the fleet</Text>
          </View>
        </Row>
        <Row gap={8} wrap>
          {['live', 'delayed', 'offline'].map((f) => (
            <Row key={f} gap={6} style={{ backgroundColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: f === 'live' ? '#61ce70' : FRESH_COLOR[f] }} />
              <Text style={{ color: '#fff', fontSize: 12.5, ...F[600] }}>{counts[f] ?? 0} {f}</Text>
            </Row>
          ))}
        </Row>
        <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <Row>
          <Figure light value={tot.trips_today} label="Trips today" />
          <Figure light value={tot.scheduled_today} label="Scheduled" />
          <Figure light value={k.onTimePct == null ? '—' : `${k.onTimePct}%`} label="On time" />
        </Row>
      </GradientCard>

      <Row gap={10}>
        <Shortcut icon="clock" label="Trips" tone="navy" onPress={() => navigation.navigate('Trips')} />
        <Shortcut icon="check" label="Attendance" tone="green" onPress={() => navigation.navigate('AttendanceAdmin')} />
        <Shortcut icon="chart" label="Reports" tone="blue" onPress={() => navigation.navigate('Reports')} />
        <Shortcut icon="bell" label="Announce" tone="red" onPress={() => navigation.navigate('Notices')} />
      </Row>

      <SectionTitle title="Today at a glance" />
      <StatGrid>
        <Stat icon="users" label="Students present" value={k.presentToday} tone="live" />
        <Stat icon="card" label="Active passes" value={tot.subscribers} />
        <Stat icon="alert" label="Open incidents" value={k.openIncidents} tone={k.openIncidents ? 'danger' : undefined} />
        <Stat icon="check" label="Awaiting review" value={k.awaitingReview} tone={k.awaitingReview ? 'delayed' : undefined} />
      </StatGrid>

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

      <FoldCard
        icon="alert"
        title="Needs attention"
        summary={open == null ? 'Loading…' : open.length === 0 && !k.awaitingReview ? 'All quiet on the fleet' : [k.awaitingReview ? `${k.awaitingReview} to review` : null, open.length ? `${open.length} open incident${open.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
        badge={open && open.length + (k.awaitingReview ?? 0) > 0 ? <Badge tone="danger">{open.length + (k.awaitingReview ?? 0)}</Badge> : null}
      >
        {open == null ? <Skeleton /> : open.length === 0 && !k.awaitingReview ? <Txt muted>Nothing needs attention. All quiet on the fleet.</Txt> : (
          <View style={{ gap: 8 }}>
            {k.awaitingReview > 0 && (
              <Pressable onPress={() => navigation.navigate('AttendanceAdmin')} style={{ padding: 12, paddingLeft: 15, borderRadius: 14, backgroundColor: 'rgba(247,188,49,0.12)', borderWidth: 1, borderColor: 'rgba(247,188,49,0.4)', borderLeftWidth: 4, borderLeftColor: C.gold, gap: 2 }}>
                <Txt bold>{k.awaitingReview} attendance record{k.awaitingReview === 1 ? '' : 's'} to review</Txt>
                <Txt small muted>Provisional records and disputes need a decision.</Txt>
                <Text style={{ color: C.navy, ...F[700], marginTop: 2 }}>Review now →</Text>
              </Pressable>
            )}
            {open.slice(0, 5).map((i) => (
              <View key={i.id} style={{ padding: 12, borderRadius: 14, backgroundColor: URGENT.includes(i.kind) ? C.danger50 : C.delayed50, gap: 2 }}>
                <Txt bold>{titleCase(i.kind)}{i.fleet_code ? ` · ${i.fleet_code}` : i.route_code ? ` · route ${i.route_code}` : ''}</Txt>
                <Txt small>{i.message ?? 'No details given.'}</Txt>
                <Txt small muted>{i.source}{i.username ? ` ${i.username}` : ''} · {dateTime(i.created_at)}</Txt>
              </View>
            ))}
          </View>
        )}
        <LinkButton title="See all alerts and incidents" icon="arrow" onPress={() => navigation.navigate('Notices')} />
      </FoldCard>

      <Card title="Trips running now" icon="bus" onSeeAll={() => navigation.navigate('Trips')} seeAll="All trips">
        {trips.data == null ? <Skeleton /> : trips.data.length === 0 ? <Txt muted>No trips running.</Txt> : trips.data.map((t, idx) => (
          <Row key={t.id} gap={12} style={{ paddingVertical: 10, borderTopWidth: idx ? 1 : 0, borderTopColor: C.line2 }}>
            <RouteCode code={t.route_code} />
            <View style={{ flex: 1 }}>
              <Txt bold numberOfLines={1}>{t.route_name}</Txt>
              <Txt small muted numberOfLines={1}>{t.fleet_code} · {t.driver_name ?? 'No driver'} · since {time(t.started_at)}</Txt>
              {t.flagged ? <View style={{ marginTop: 4 }}><Badge tone="danger">{t.flag_reason}</Badge></View> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}><Txt bold>{t.attendance}</Txt><Txt small muted>riders</Txt></View>
          </Row>
        ))}
      </Card>

      <FoldCard
        icon="list"
        title="Recent activity"
        summary={o == null ? 'Loading…' : o.activity.length ? `${ACTIVITY[o.activity[0].kind].text(o.activity[0])} · ${dateTime(o.activity[0].at)}` : 'No activity yet'}
      >
        {o == null ? <Skeleton /> : o.activity.length === 0 ? <Txt muted>No activity yet.</Txt> : o.activity.map((a, idx) => {
          const kind = ACTIVITY[a.kind];
          return (
            <Row key={`${a.kind}-${a.at}-${idx}`} gap={12} style={{ alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${kind.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={kind.icon} size={14} color={kind.color} />
                </View>
                {idx < o.activity.length - 1 ? <View style={{ width: 1.5, flex: 1, minHeight: 16, backgroundColor: C.line2, marginTop: 4 }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 10 }}>
                <Txt bold small>{kind.text(a)}</Txt>
                <Txt small muted numberOfLines={2}>{kind.sub(a)}</Txt>
                <Txt small style={{ color: C.faint, marginTop: 2 }}>{dateTime(a.at)}</Txt>
              </View>
            </Row>
          );
        })}
      </FoldCard>
    </Screen>
  );
}
