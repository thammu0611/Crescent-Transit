import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { Badge, IconBubble, Screen, Skeleton, Text, Txt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { METHOD_TEXT, thisMonth, time } from '../../lib/format.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { routeData, useT } from '../../lib/offline.js';
import { formatMinutes, parseTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { getJSON, setJSON } from '../../lib/storage.js';
import { C, F, R, shadow } from '../../theme.js';

const KEY = 'ubts.alertsRead';

// Filters by what the notice is about, not by who sent it.
const FILTERS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'delays', label: 'Delays', kinds: ['DELAY', 'BREAKDOWN'] },
  { key: 'attendance', label: 'Attendance', kinds: ['ATTENDANCE'] },
  { key: 'news', label: 'Announcements', kinds: ['ANNOUNCEMENT', 'ROUTE_CHANGE'] },
  { key: 'safety', label: 'Safety', kinds: ['EMERGENCY'] },
];
const LOOK = {
  DELAY: { icon: 'clock', accent: 'amber' },
  BREAKDOWN: { icon: 'alert', accent: 'amber' },
  ROUTE_CHANGE: { icon: 'route', accent: 'navy' },
  ANNOUNCEMENT: { icon: 'bell', accent: 'navy' },
  EMERGENCY: { icon: 'shield', accent: 'violet' },
  ATTENDANCE: { icon: 'check', accent: 'emerald' },
};
const delayOf = (n) => Number(String(n.message ?? n.title).match(/(\d+)\s*min/)?.[1]) || null;
const Dot = () => <View accessibilityLabel="Unread" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.navy, marginTop: 6 }} />;

const dayKey = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Repeated delay updates for one route on one day become a single thread: the
 * latest update first, then a short timeline of the earlier ones.
 */
function group(items) {
  const out = [];
  const threads = new Map();
  for (const n of items) {
    if (n.kind === 'DELAY' && n.route_code) {
      const k = `${n.route_code}|${dayKey(n.created_at)}`;
      const t = threads.get(k);
      if (t) { t.updates.push(n); continue; }
      const thread = { id: `t${n.id}`, thread: true, latest: n, updates: [n], created_at: n.created_at };
      threads.set(k, thread);
      out.push(thread);
    } else {
      out.push({ id: n.id, thread: false, latest: n, updates: [n], created_at: n.created_at });
    }
  }
  return out;
}

function Thread({ item, unread, stopName, stopTime, onTrack }) {
  const [open, setOpen] = useState(false);
  const n = item.latest;
  const all = item.updates;
  const shown = open ? all : all.slice(0, 3);
  const late = delayOf(n);
  const at = stopTime != null && late != null ? formatMinutes(stopTime + late) : null;
  return (
    <View style={[card, { gap: 12 }]}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <IconBubble name="clock" accent="amber" size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, lineHeight: 22, ...F[700], color: C.ink }}>{late ? `Bus ${n.route_code} delayed by ${late} min` : n.title}</Text>
          <Txt muted small>Updated {time(n.created_at)} · Route {n.route_code}{all.length > 1 ? ` · ${all.length} updates` : ''}</Txt>
        </View>
        {unread ? <Dot /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Badge tone="delayed">{late ? `Delayed ${late} min` : 'Delayed'}</Badge>
        {at ? <Badge tone="info">At your stop {at}</Badge> : null}
      </View>
      <Txt style={{ color: C.muted }}>{stopName ? `Affects ${stopName}. ` : ''}{n.message}</Txt>
      {all.length > 1 ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.raised, gap: 10 }}>
          {shown.map((u, k) => (
            <View key={u.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k === 0 ? C.delayed : C.faint, marginTop: 6 }} />
              <Text style={{ width: 72, fontSize: 13.5, ...F[600], color: C.ink, fontVariant: ['tabular-nums'] }}>{time(u.created_at)}</Text>
              <Txt small muted style={{ flex: 1 }} numberOfLines={2}>{delayOf(u) ? `+${delayOf(u)} min` : u.message}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {all.length > 3 ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: C.link, ...F[600], fontSize: 14 }}>{open ? 'Show fewer updates' : `Show ${all.length - 3} earlier updates`}</Text>
          </Pressable>
        ) : <View />}
        <Pressable accessibilityRole="button" onPress={onTrack} hitSlop={8} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: C.link, ...F[600], fontSize: 14 }}>Track bus</Text>
          <Icon name="arrow" size={16} color={C.link} />
        </Pressable>
      </View>
    </View>
  );
}

function Single({ n, unread }) {
  const look = LOOK[n.kind] ?? LOOK.ANNOUNCEMENT;
  return (
    <View style={[card, { flexDirection: 'row', gap: 12, padding: 14, shadowOpacity: 0 }]}>
      <IconBubble name={look.icon} accent={look.accent} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, ...F[700], color: C.ink }}>{n.title}</Text>
          <Txt muted small style={{ paddingTop: 2 }}>{time(n.created_at)}</Txt>
          {unread ? <Dot /> : null}
        </View>
        <Txt style={{ color: C.muted }}>{n.message}</Txt>
      </View>
    </View>
  );
}

/** Notifications: grouped delay threads, filters and day headers; "Clear all" hides what you've read. */
export default function Alerts({ navigation }) {
  const { token, entitlement, user } = useSession();
  const t = useT();
  const entitled = Boolean(entitlement?.active);
  const list = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const [readAt, setReadAt] = useState(null);
  // Attendance marks become notices too ("Marked present · to campus").
  const marks = useAsync(() => (entitled ? api(`/api/attendance/me?month=${thisMonth()}`, { token }) : Promise.resolve(null)), [token, entitled]);
  const home = useAsync(() => (user?.homeRouteCode ? routeData(`/api/routes/${encodeURIComponent(user.homeRouteCode)}`) : Promise.resolve(null)), [user?.homeRouteCode]);
  const myStop = home.data?.stops?.find((x) => x.seq === user?.homeStopSeq);
  const [filter, setFilter] = useState('all');
  const { refreshing, onRefresh } = useRefresh(list, marks);
  useEffect(() => { getJSON(KEY, 0).then((v) => setReadAt(Number(v) || 0)); }, []);
  const all = useMemo(() => {
    const since = Date.now() - 3 * 86400000;
    const att = (marks.data?.records ?? []).filter((r) => r.present && new Date(r.boarded_at).getTime() > since).map((r) => ({
      id: `a${r.attendance_id}`, kind: 'ATTENDANCE', created_at: r.boarded_at, route_code: r.route_code,
      title: `Marked present · ${r.direction === 'DOWN' ? 'from' : 'to'} campus`,
      message: `${METHOD_TEXT[r.method] ?? 'Checked in'} on ${String(r.fleet_code ?? '').replace('BSACIST-', 'Bus ')}.`,
    }));
    return [...(list.data ?? []), ...att].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [list.data, marks.data]);
  const isUnread = (n) => readAt != null && new Date(n.created_at).getTime() > readAt;
  const unreadCount = all.filter(isUnread).length;
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
  const items = group(kinds ? all.filter((n) => kinds.includes(n.kind)) : all);
  const count = (f) => (f.kinds ? all.filter((n) => f.kinds.includes(n.kind)).length : all.length);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: unreadCount
        ? () => (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { const now = Date.now(); setJSON(KEY, now); setReadAt(now); }}>
            <Text style={{ color: C.link, ...F[600], fontSize: 14 }}>{t('Mark all read')}</Text>
          </Pressable>
        )
        : undefined,
    });
  }, [navigation, unreadCount, t]);

  let lastDay = null;
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }}>
        <View style={{ width: 8 }} />
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setFilter(f.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: on ? C.navyFill : C.line, backgroundColor: on ? C.navyFill : C.card }}>
              <Text style={{ color: on ? '#fff' : C.ink, ...F[600], fontSize: 13.5 }}>{t(f.label)}</Text>
              <Text style={{ color: on ? 'rgba(255,255,255,0.85)' : C.muted, ...F[500], fontSize: 13 }}>{count(f)}</Text>
            </Pressable>
          );
        })}
        <View style={{ width: 8 }} />
      </ScrollView>
      {!entitled && <Txt muted small>Showing the notice board. Route alerts (delays, breakdowns, route changes) come with the subscription.</Txt>}
      {list.data == null || readAt == null ? <View style={{ gap: 10 }}><Skeleton height={140} /><Skeleton height={80} /><Skeleton height={80} /></View> : items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 16 }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={filter === 'safety' ? 'shield' : 'bell'} size={32} color={C.navy} />
          </View>
          <Text style={{ fontSize: 20, ...F.display, color: C.ink, textAlign: 'center' }}>{filter === 'safety' ? 'No safety alerts' : "You're all caught up"}</Text>
          <Txt muted style={{ textAlign: 'center' }}>{filter === 'safety' ? 'If there is a safety notice for your route or campus, it shows here straight away.' : 'New alerts for your route will appear here.'}</Txt>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((it) => {
            const day = dayLabel(it.created_at);
            const head = day !== lastDay;
            lastDay = day;
            return (
              <View key={it.id} style={{ gap: 10 }}>
                {head ? <Txt muted small style={{ ...F[600], marginTop: 4 }}>{t(day)}</Txt> : null}
                {it.thread
                  ? <Thread item={it} unread={it.updates.some(isUnread)} stopName={it.latest.route_code === user?.homeRouteCode ? myStop?.name : null} stopTime={it.latest.route_code === user?.homeRouteCode ? parseTime(myStop?.scheduled_time) : null} onTrack={() => navigation.navigate('StudentTabs', { screen: 'Track', params: { routeCode: it.latest.route_code } })} />
                  : <Single n={it.latest} unread={isUnread(it.latest)} />}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const card = { backgroundColor: C.card, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.line2, ...shadow };
