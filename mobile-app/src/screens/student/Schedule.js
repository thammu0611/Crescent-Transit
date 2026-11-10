import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { dayText } from '../../components/DayBanner.js';
import { Badge, Screen, Select, Skeleton, Text, Txt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { etaText } from '../../lib/format.js';
import { useAsync, useLive, useNow, useRefresh } from '../../lib/hooks.js';
import { routeData, useT } from '../../lib/offline.js';
import { estimateArrival } from '../../lib/rules.js';
import { formatMinutes, nowMinutes, parseTime, prettyTime } from '../../lib/schedule.js';
import { useSession } from '../../lib/session.js';
import { C, F, R, shadow } from '../../theme.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const moved = (text, shift) => {
  const t = parseTime(text);
  return shift && t != null ? formatMinutes(t + shift) : prettyTime(text);
};

/** This week, Monday first. */
function week() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { key: iso(d), dow: DOW[d.getDay()], n: d.getDate(), weekend: d.getDay() === 0 || d.getDay() === 6, today: iso(d) === iso(today) };
  });
}

/** One stop on the timeline: time, a dot on the line, the stop's name and its chips. */
function Stop({ time, name, kind, first, last, busBetween, chips, lineDone, lineBus }) {
  const passed = kind === 'passed';
  const mine = kind === 'mine';
  const end = kind === 'end';
  const dot = mine || end ? 14 : 12;
  const dotBg = passed ? C.faint : mine ? C.navy : end ? C.live : C.card;
  const dotBd = passed ? C.faint : mine ? C.navy : end ? C.live : C.faint;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingHorizontal: 16, minHeight: mine ? 78 : busBetween ? 64 : 46, backgroundColor: mine ? C.navy50 : 'transparent' }}>
      <Text style={{ width: 62, paddingTop: 12, fontSize: 13, lineHeight: 18, ...(mine ? F[700] : F[500]), color: passed ? C.faint : C.muted, fontVariant: ['tabular-nums'] }}>{time}</Text>
      <View style={{ width: 16, alignItems: 'center' }}>
        <View style={{ width: 2, height: 13, backgroundColor: first ? 'transparent' : lineDone ? C.faint : C.line }} />
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: dotBg, borderWidth: 2, borderColor: dotBd }} />
        <View style={{ width: 2, flex: 1, backgroundColor: last ? 'transparent' : lineBus ? C.navy : lineDone ? C.faint : C.line }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 10, gap: 6 }}>
        <Text style={{ fontSize: 14.5, lineHeight: 20, ...(mine || end ? F[700] : F[500]), color: passed ? C.faint : C.ink }}>{name}</Text>
        {chips ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{chips}</View> : null}
        {busBetween ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            <View style={{ paddingTop: 1 }}><Icon name="bus" size={14} color={C.navy} /></View>
            <Text style={{ flex: 1, color: C.navy, fontSize: 12.5, lineHeight: 17, ...F[600] }}>{busBetween}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The route timetable: direction switch (to / from campus), the week, and the
 * stops as a timeline with your stop, the live bus and its arrival estimate.
 */
export default function Schedule({ navigation }) {
  const { token, user, entitlement } = useSession();
  const t = useT();
  const days = useMemo(week, []);
  const [dayKey, setDayKey] = useState(days.find((d) => d.today)?.key ?? days[0].key);
  const [dir, setDir] = useState(nowMinutes() >= 13 * 60 ? 'down' : 'up');
  const cal = useAsync(() => api('/api/calendar'), []);
  const routes = useAsync(() => routeData('/api/routes'), []);
  const [code, setCode] = useState(user?.homeRouteCode ?? '');
  useEffect(() => { if (!code && routes.data?.length) setCode(routes.data[0].code); }, [routes.data, code]);
  const route = useAsync(() => (code ? routeData(`/api/routes/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const { buses } = useLive(token, code, Boolean(entitlement?.active && code));
  const { refreshing, onRefresh } = useRefresh(routes, route, cal);
  const now = useNow(15000);

  const r = route.data;
  const special = [cal.data?.today, ...(cal.data?.upcoming ?? [])].find((d) => d?.day === dayKey) ?? null;
  const isToday = days.find((d) => d.key === dayKey)?.today;
  const bus = isToday && dir === 'up' ? buses.find((b) => b.freshness !== 'offline' && b.routeCode === code) : null;
  const here = bus?.nearestStop?.seq;
  const mine = code === user?.homeRouteCode ? user?.homeStopSeq : null;
  const stops = r?.stops ?? [];
  const eta = bus && mine && r ? estimateArrival(stops, bus, mine, r.segmentMinutes, { now, segmentSource: r.segmentsLearned ? 'segment-history' : 'timetable' }) : null;
  const arrive = r ? formatMinutes((parseTime(r.departure_time) ?? 0) + (r.duration_minutes ?? 0) + (special?.morning_shift ?? 0)) : '—';
  const morning = moved(r?.departure_time, special?.morning_shift);
  const evening = moved(r?.evening_departure, special?.evening_shift);
  const nextSeq = isToday && !bus ? stops.find((s) => (parseTime(s.scheduled_time) ?? -1) >= nowMinutes())?.seq : null;

  const segOn = C.dark ? '#2A3546' : C.card;
  const DirTab = ({ k, label }) => {
    const on = dir === k;
    return (
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setDir(k)}
        style={{ flex: 1, minHeight: 44, paddingVertical: 4, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: on ? segOn : 'transparent', ...(on ? shadow : null) }}>
        <Text style={{ fontSize: 13.5, ...F[600], color: on ? C.ink : C.muted, textAlign: 'center' }} numberOfLines={2}>{label}</Text>
      </Pressable>
    );
  };

  // The rows for the chosen direction.
  let rows = [];
  if (r && dir === 'up') {
    rows = stops.map((s, i) => {
      const passed = Boolean(here && s.seq <= here);
      const kind = s.seq === mine ? 'mine' : passed ? 'passed' : 'up';
      const chips = [];
      if (s.seq === mine) {
        chips.push(<Badge key="m" tone="info">{t('Your stop')}</Badge>);
        if (eta && !eta.passed) chips.push(<Badge key="e" tone="live">Bus in {etaText(eta)}</Badge>);
        else if (eta?.passed) chips.push(<Badge key="e" tone="offline">Bus has passed</Badge>);
      }
      if (s.seq === nextSeq && s.seq !== mine) chips.push(<Badge key="n" tone="info">Next</Badge>);
      return {
        key: s.seq, time: moved(s.scheduled_time, special?.morning_shift), name: s.name, kind, chips: chips.length ? chips : null,
        busBetween: bus && s.seq === here ? `Bus ${code} is between here and the next stop` : null,
        lineDone: Boolean(here && s.seq <= here) && i > 0, lineBus: Boolean(bus && s.seq === here),
      };
    });
    rows.push({ key: 'campus', time: arrive, name: `Campus · ${r.end_point ?? 'BSACIST'}`, kind: 'end' });
  } else if (r) {
    rows = [{ key: 'campus', time: evening, name: `Campus · ${r.end_point ?? 'BSACIST'}`, kind: 'end' },
      ...[...stops].reverse().map((s) => ({ key: s.seq, time: '', name: s.name, kind: s.seq === mine ? 'mine' : 'up', chips: s.seq === mine ? [<Badge key="m" tone="info">{t('Your stop')}</Badge>] : null }))];
  }

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text style={{ fontSize: 28, lineHeight: 34, ...F.displayBold, color: C.ink, flexShrink: 1 }} numberOfLines={1}>{t('Schedule')}</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Track')}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised }, pressed && { opacity: 0.85 }]}>
          <Icon name="map" size={18} color={C.ink} />
          <Text style={{ fontSize: 14, ...F[600], color: C.ink }}>Stops on map</Text>
        </Pressable>
      </View>

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 14, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line2 }}>
        <DirTab k="up" label={`To campus · ${morning}`} />
        <DirTab k="down" label={`From campus · ${evening}`} />
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {days.map((d) => {
          const on = d.key === dayKey;
          return (
            <Pressable key={d.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${d.dow} ${d.n}${d.today ? ', today' : ''}`} onPress={() => setDayKey(d.key)}
              style={({ pressed }) => [{ flex: 1, height: 60, borderRadius: 14, borderWidth: 1, borderColor: on ? C.navyFill : C.line2, backgroundColor: on ? C.navyFill : C.card, alignItems: 'center', justifyContent: 'center', gap: 2 }, pressed && { opacity: 0.85 }]}>
              <Text style={{ fontSize: 11.5, ...F[500], color: on ? '#fff' : d.weekend ? C.faint : C.ink }}>{d.dow}</Text>
              <Text style={{ fontSize: 17, lineHeight: 20, ...F.display, color: on ? '#fff' : d.weekend ? C.faint : C.ink }}>{d.n}</Text>
              {d.today && !on ? <View style={{ position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: C.navy }} /> : null}
            </Pressable>
          );
        })}
      </View>

      {special ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: special.no_service ? C.danger50 : C.delayed50 }}>
          <Icon name="clock" size={18} color={special.no_service ? C.danger : C.delayed} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, ...F[600], fontSize: 14 }}>{special.title}</Text>
            <Txt small muted>{dayText(special)}{special.note ? ` · ${special.note}` : ''}</Txt>
          </View>
        </View>
      ) : null}

      {r == null ? (
        <View accessibilityLabel="Loading timetable" style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, padding: 16, gap: 18, ...shadow }}>
          {Array.from({ length: 9 }, (_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <View style={{ width: 58 }}><Skeleton height={14} /></View>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.raised }} />
              <View style={{ flex: 1 }}><Skeleton height={14} /></View>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, paddingVertical: 10, overflow: 'hidden', ...shadow }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
            <Text style={{ fontSize: 15, ...F[600], color: C.ink, flex: 1 }} numberOfLines={1}>Route {r.code} · {r.name}</Text>
            <Select label="Route" value={code} onChange={setCode} searchable options={(routes.data ?? []).map((x) => ({ value: x.code, label: `Route ${x.code} · ${x.name}` }))}
              trigger={(open) => (
                <Pressable accessibilityRole="button" accessibilityLabel="Change route" onPress={open} hitSlop={8} style={{ minHeight: 32, justifyContent: 'center', paddingLeft: 8 }}>
                  <Text style={{ color: C.navy, fontSize: 14, ...F[600] }}>Change</Text>
                </Pressable>
              )} />
          </View>
          {special?.no_service ? (
            <View style={{ alignItems: 'center', gap: 8, padding: 24 }}>
              <Icon name="calendar" size={26} color={C.muted} />
              <Text style={{ fontSize: 17, ...F.display, color: C.ink }}>No buses this day</Text>
              <Txt muted style={{ textAlign: 'center' }}>{special.title}. Pick another day to see the timetable.</Txt>
            </View>
          ) : rows.map((row, i) => (
            <Stop key={row.key} {...row} first={i === 0} last={i === rows.length - 1} />
          ))}
          {dir === 'down' && !special?.no_service ? <Txt muted small style={{ paddingHorizontal: 16, paddingTop: 8 }}>The evening bus stops in reverse order. Times for each stop are not printed in the timetable.</Txt> : null}
        </View>
      )}
    </Screen>
  );
}
