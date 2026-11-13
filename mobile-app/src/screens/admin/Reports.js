import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { Block, ColumnChart, HBars, Table } from '../../components/adminkit.js';
import {
  Badge, Button, DateField, ErrorText, KV, ListCard, Row, RouteCode, Screen, SearchBox, Segmented, Select, Sheet, Skeleton,
  Stat, StatGrid, Text, TextField, Txt, YesNo, DirectionBadge,
} from '../../components/ui.js';
import { api, download, pickTextFile } from '../../lib/api.js';
import { METHOD_TEXT, daysAgo, thisMonth, today } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { DIRECTION_NAME } from '../../lib/rules.js';
import { useSession } from '../../lib/session.js';
import { C, F, R, shadow } from '../../theme.js';

const STATUS_TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'offline', REJECTED: 'offline', VOID: 'danger' };
const statusText = (s) => s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Horizontal bars, kept for screens that still import them. */
export function Bars({ rows, value, label, max, unit = '' }) {
  return <HBars rows={rows} value={value} label={label} max={max} unit={unit} />;
}

const SECTIONS = [
  { value: 'register', label: 'Attendance' },
  { value: 'demand', label: 'Stop demand' },
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'exceptions', label: 'Exceptions' },
  { value: 'leakage', label: 'Leakage' },
  { value: 'eta', label: 'ETA accuracy' },
  { value: 'accuracy', label: 'Attendance accuracy' },
];

const PRESETS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return { y, text: `${d} ${MON[m - 1]}` }; };
const rangeText = (from, to) => { const a = dm(from); const b = dm(to); return `${a.text}${a.y !== b.y ? ` ${a.y}` : ''} – ${b.text} ${b.y}`; };
const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const card = { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, ...shadow };

/** A key figure: its name, a big number and a short note. */
function Kpi({ label, value, note, tone }) {
  return (
    <View style={[card, { flexBasis: '47%', flexGrow: 1, padding: 14, gap: 4, shadowOpacity: 0 }]}>
      <Text style={{ fontSize: 13, ...F[500], color: C.muted }} numberOfLines={1}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 26, lineHeight: 32, ...F.displayBold, color: tone ?? C.ink, fontVariant: ['tabular-nums'] }}>{value ?? '—'}</Text>
        {note ? <Text style={{ fontSize: 12.5, ...F[500], color: C.muted, paddingBottom: 5 }} numberOfLines={1}>{note}</Text> : null}
      </View>
    </View>
  );
}

/** Columns per day with the average as a dashed line; the latest day is highlighted. */
function DayBars({ title, data, height = 120 }) {
  if (!data.length) return <View style={[card, { padding: 18 }]}><Txt muted>No boardings in this period.</Txt></View>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const avg = Math.round(data.reduce((n, d) => n + d.value, 0) / data.length);
  return (
    <View style={[card, { padding: 18, gap: 14 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 16, ...F[600], color: C.ink, flex: 1 }}>{title}</Text>
        <Txt muted small>Avg {avg}</Txt>
      </View>
      <View accessibilityRole="image" accessibilityLabel={data.map((d) => `${d.label} ${d.value}`).join(', ')} style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={{ flex: 1, height: `${Math.max(3, (d.value / max) * 100)}%`, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: i === data.length - 1 ? C.navy : C.dark ? '#3A4A6E' : '#C9D2E3' }} />
        ))}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: (avg / max) * height, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.faint }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt muted small>{data[0].label}</Txt>
        <Txt muted small>{data[data.length - 1].label}</Txt>
      </View>
    </View>
  );
}

const loading = <View style={{ gap: 10 }}><Skeleton height={90} /><Skeleton height={160} /></View>;
/** Register rows grouped by bus, each with a per-student summary. */
function byBus(rows) {
  const buses = new Map();
  for (const r of rows) {
    if (!buses.has(r.bus)) buses.set(r.bus, { bus: r.bus, route: r.route, rows: [], students: new Map() });
    const b = buses.get(r.bus);
    b.rows.push(r);
    const st = b.students.get(r.username) ?? { username: r.username, name: r.full_name, reg: r.register_no, trips: 0, present: 0, up: 0, down: 0 };
    st.trips += 1;
    if (r.present) {
      st.present += 1;
      if (r.direction === 'DOWN') st.down += 1;
      else st.up += 1;
    }
    b.students.set(r.username, st);
  }
  return [...buses.values()]
    .map((b) => ({ ...b, students: [...b.students.values()].sort((x, y) => x.name.localeCompare(y.name)), present: b.rows.filter((r) => r.present).length }))
    .sort((x, y) => x.bus.localeCompare(y.bus, undefined, { numeric: true }));
}

/** One bus's attendance report: its students, then every record. */
function BusRegister({ group, onRow, onCsv, onClose, visible }) {
  return (
    <Sheet visible={visible} title={`${group.bus} · Route ${group.route}`} onClose={onClose}>
      <Txt muted small>{`${group.students.length} student${group.students.length === 1 ? '' : 's'} · ${group.rows.length} records · ${group.present} present`}</Txt>
      <Table
        rows={group.students}
        keyOf={(st) => st.username}
        columns={[
          { key: 'name', label: 'Student', flex: 1.8, render: (st) => <View><Txt small bold numberOfLines={1}>{st.name}</Txt><Txt small muted numberOfLines={1}>{st.reg ?? st.username}</Txt></View> },
          { key: 'up', label: 'Inbound', flex: 0.8, align: 'right', render: (st) => `${st.up}` },
          { key: 'down', label: 'Outbound', flex: 0.9, align: 'right', render: (st) => `${st.down}` },
          { key: 'rate', label: 'Rate', flex: 0.9, align: 'right', render: (st) => <Badge tone={st.present === st.trips ? 'live' : st.present ? 'delayed' : 'danger'}>{`${Math.round((st.present / st.trips) * 100)}%`}</Badge> },
        ]}
      />
      <Table
        rows={group.rows}
        keyOf={(r) => `${r.trip_id}:${r.username}`}
        onRowPress={onRow}
        columns={[
          { key: 'date', label: 'Date', flex: 1, render: (r) => `${r.date.slice(5)} ${DIRECTION_NAME[r.direction]}${r.boarded ? `\n${r.boarded}` : ''}` },
          { key: 'student', label: 'Student', flex: 1.6, render: (r) => <View><Txt small bold numberOfLines={1}>{r.full_name}</Txt><Txt small muted numberOfLines={1}>{r.boarding_stop ?? r.register_no ?? r.username}</Txt></View> },
          { key: 'status', label: 'Status', flex: 1.2, align: 'right', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'offline'}>{statusText(r.status)}</Badge> },
        ]}
      />
      <Button small variant="ghost" icon="download" title={`CSV for ${group.bus}`} onPress={onCsv} />
    </Sheet>
  );
}

const CsvButton = ({ title = 'Export CSV', onPress }) => <Button small variant="ghost" icon="download" title={title} onPress={onPress} />;

/** ETA mean absolute error (doc 7.3): target under 3 minutes. */
function EtaAccuracy({ token, q }) {
  const { data, error } = useAsync(() => api(`/api/reports/eta-accuracy?${q}`, { token }), [q, token]);
  if (error) return <ErrorText>{error.message}</ErrorText>;
  if (!data) return loading;
  const ok = data.overall.maeMin != null && data.overall.maeMin <= data.targetMin;
  return (
    <>
      <StatGrid>
        <Stat icon="clock" label="Overall error" value={data.overall.maeMin == null ? '—' : `${data.overall.maeMin} min`} tone={data.overall.maeMin == null ? undefined : ok ? 'live' : 'delayed'} />
        <Stat icon="chart" label="Predictions scored" value={data.overall.n} />
      </StatGrid>
      <Txt muted small>Target: under {data.targetMin} minutes. Each minute the server logs its prediction for the next three stops; when the bus reaches the stop the error is |actual − predicted|.</Txt>
      {[['By route', data.byRoute], ['By method', data.byMethod], ['By how far ahead', data.byLead], ['By hour', data.byHour]].map(([title, rows]) => (
        <Block key={title} title={title}>
          <HBars rows={rows} label={(r) => `${r.key} (${r.n})`} value={(r) => r.maeMin} unit=" min" />
        </Block>
      ))}
    </>
  );
}

/** Precision and recall against a hand-taken register (doc 9.9). */
function AccuracyUpload({ token }) {
  const [csv, setCsv] = useState('trip_id,username\n');
  const a = useAction();
  const [result, setResult] = useState(null);
  return (
    <>
      <Block title="Manual register" caption="Paste the register taken on the same trips: one row per student seen on the bus.">
        <TextField value={csv} onChangeText={setCsv} multiline autoCapitalize="none" autoCorrect={false} accessibilityLabel="Manual register CSV" style={{ fontFamily: 'monospace', minHeight: 130 }} />
        <Row gap={10}>
          <Button small variant="ghost" icon="download" title="Choose CSV file" style={{ flex: 1 }} onPress={() => pickTextFile().then((t) => t != null && setCsv(t)).catch((e) => a.setError(e.message))} />
          <Button small title="Compare" busy={a.busy} style={{ flex: 1 }} onPress={() => a.run(() => api('/api/reports/attendance-accuracy', { token, body: { csv } })).then((r) => r && setResult(r))} />
        </Row>
        <ErrorText>{a.error}</ErrorText>
      </Block>
      {result && (
        <>
          <StatGrid>
            <Stat label={`Precision (≥ ${result.targets.precisionPct}%)`} value={result.precisionPct == null ? '—' : `${result.precisionPct}%`} tone={result.precisionPct >= result.targets.precisionPct ? 'live' : 'delayed'} />
            <Stat label={`Recall (≥ ${result.targets.recallPct}%)`} value={result.recallPct == null ? '—' : `${result.recallPct}%`} tone={result.recallPct >= result.targets.recallPct ? 'live' : 'delayed'} />
            <Stat label="Prompt response" value={result.promptResponsePct == null ? '—' : `${result.promptResponsePct}%`} />
            <Stat label="Provisional share" value={result.provisionalSharePct == null ? '—' : `${result.provisionalSharePct}%`} />
          </StatGrid>
          <Block title="Breakdown">
            <KV k="Trips" v={result.trips} />
            <KV k="True positives" v={result.truePositives} />
            <KV k="False positives" v={result.falsePositives} />
            <KV k="False negatives" v={result.falseNegatives} />
            <KV k="False prompts" v={result.falsePrompts} />
            {result.falsePositiveList.length > 0 && <Txt muted small>Marked but not seen: {result.falsePositiveList.join(', ')}</Txt>}
            {result.falseNegativeList.length > 0 && <Txt muted small>Seen but not marked: {result.falseNegativeList.join(', ')}</Txt>}
          </Block>
        </>
      )}
    </>
  );
}

export default function Reports({ navigation }) {
  const { token } = useSession();
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState({ from: daysAgo(29), to: today(), route: '' });
  const [tab, setTab] = useState('register');
  const [row, setRow] = useState(null); // register row shown in the detail sheet
  const [busId, setBusId] = useState(null); // bus whose register is open
  const [busQuery, setBusQuery] = useState('');
  const q = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
  const [error, setError] = useState(null);
  const routes = useAsync(() => api('/api/routes'), []);
  const get = (path) => () => api(`${path}?${q}`, { token });
  const register = useAsync(tab === 'register' ? get('/api/reports/attendance') : async () => null, [tab, q]);
  const demand = useAsync(tab === 'demand' ? get('/api/reports/demand') : async () => null, [tab, q]);
  const occupancy = useAsync(tab === 'occupancy' ? get('/api/reports/occupancy') : async () => null, [tab, q]);
  const exceptions = useAsync(tab === 'exceptions' ? get('/api/reports/exceptions') : async () => null, [tab, q]);
  const leakage = useAsync(tab === 'leakage' ? get('/api/reports/leakage') : async () => null, [tab, q]);
  const csv = (path, name, extra = '') => download(`${path}?${q}&format=csv${extra}`, token, `${name}.csv`).catch((e) => setError(e.message));
  const loadError = [register, demand, occupancy, exceptions, leakage].find((x) => x.error)?.error?.message;

  const choosePreset = (p) => {
    setPreset(p);
    if (p === '7') setRange((r) => ({ ...r, from: daysAgo(6), to: today() }));
    if (p === '30') setRange((r) => ({ ...r, from: daysAgo(29), to: today() }));
    if (p === 'month') setRange((r) => ({ ...r, from: `${thisMonth()}-01`, to: today() }));
  };

  // Register: presents per day (last 14 days of the range) and headline counts.
  const reg = register.data;
  const regStats = useMemo(() => {
    if (!reg) return null;
    const byDay = {};
    for (const r of reg) if (r.present) byDay[r.date] = (byDay[r.date] ?? 0) + 1;
    return {
      present: reg.filter((r) => r.present).length,
      pending: reg.filter((r) => ['PROVISIONAL', 'DISPUTED'].includes(r.status)).length,
      flagged: reg.filter((r) => r.flagged).length,
      students: new Set(reg.map((r) => r.username)).size,
      days: Object.keys(byDay).sort().slice(-14).map((d) => ({ label: dm(d).text, value: byDay[d] })),
    };
  }, [reg]);

  const regBuses = useMemo(() => (reg ? byBus(reg) : []), [reg]);
  const openBus = regBuses.find((g) => g.bus === busId);
  const shownBuses = regBuses.filter((g) => !busQuery.trim() || `${g.bus} ${g.route}`.toLowerCase().includes(busQuery.trim().toLowerCase()));

  // Stop demand: total per stop across hours, and per hour across stops.
  const demandByStop = useMemo(() => Object.values((demand.data ?? []).reduce((m, r) => {
    const k = `${r.route}:${r.seq}`;
    m[k] = m[k] ?? { label: `${r.route} · ${r.stop}`, n: 0 };
    m[k].n += r.boardings;
    return m;
  }, {})).sort((a, b) => b.n - a.n).slice(0, 12), [demand.data]);
  const demandByHour = useMemo(() => Object.values((demand.data ?? []).reduce((m, r) => {
    m[r.hour] = m[r.hour] ?? { hour: r.hour, label: String(r.hour).padStart(2, '0'), value: 0 };
    m[r.hour].value += r.boardings;
    return m;
  }, {})).sort((a, b) => a.hour - b.hour), [demand.data]);
  const demandTotal = demandByHour.reduce((n, h) => n + h.value, 0);
  const peak = demandByHour.reduce((best, h) => (!best || h.value > best.value ? h : best), null);

  const occ = occupancy.data;
  const occLoads = (occ ?? []).filter((r) => r.load_pct != null);
  const ex = exceptions.data;
  const leak = leakage.data;

  // CSV and PDF of the report on screen.
  const CSV = { register: ['/api/reports/attendance', 'attendance-register'], demand: ['/api/reports/demand', 'stop-demand'], occupancy: ['/api/reports/occupancy', 'occupancy'], leakage: ['/api/reports/leakage', 'subscriber-vs-traveller'] };
  const exportCsv = () => (CSV[tab] ? csv(...CSV[tab]) : setError('This report has no CSV. Use Export PDF.'));
  const exportPdf = async () => {
    setError(null);
    const name = SECTIONS.find((x) => x.value === tab)?.label ?? 'Report';
    const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    let body = '';
    if (tab === 'register' && reg) {
      body = `<p>${reg.length} records · ${regStats.present} present · ${regStats.students} students · ${regStats.pending} pending · ${regStats.flagged} flagged</p>`
        + table(['Bus', 'Route', 'Students', 'Records', 'Present'], regBuses.map((g) => [g.bus, g.route, g.students.length, g.rows.length, g.present]))
        + table(['Day', 'Present'], regStats.days.map((d) => [d.label, d.value]));
    } else if (tab === 'demand' && demand.data) {
      body = `<p>${demandTotal} boardings · peak ${peak ? `${peak.label}:00` : '—'}</p>` + table(['Stop', 'Boardings'], demandByStop.map((r) => [r.label, r.n]));
    } else if (tab === 'occupancy' && occ) {
      body = table(['Started', 'Route', 'Riders', 'Capacity', 'Load %'], occ.map((r) => [r.started, r.route, r.travelled, r.capacity ?? '—', r.load_pct ?? '—']));
    } else if (tab === 'leakage' && leak) {
      body = table(['Date', 'Student', 'Register no', 'Route', 'Method'], leak.map((r) => [r.date, r.full_name, r.register_no ?? r.username, r.route, r.method]));
    } else if (tab === 'exceptions' && ex) {
      body = table(['Student', 'Trip', 'Status'], ex.provisionalOrFlagged.map((r) => [r.username, r.trip_id, r.flag_reason ?? r.status]));
    } else {
      return setError('Open the report first, then export it.');
    }
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Roboto,Arial,sans-serif;color:#0F172A;padding:24px}h1{font-size:22px;margin:0 0 4px}p{color:#475569}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:12px}th,td{border:1px solid #E2E8F0;padding:6px 8px;text-align:left}th{background:#EEF2F7}</style></head><body><h1>Crescent Transit · ${esc(name)}</h1><p>${esc(rangeText(range.from, range.to))} · ${range.route ? `Route ${esc(range.route)}` : 'All routes'}</p>${body}</body></html>`;
    try {
      if (Platform.OS === 'web') return Print.printAsync({ html });
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${name}.pdf` });
    } catch (e) {
      setError(e.message);
    }
    return undefined;
  };
  useLayoutEffect(() => {
    navigation?.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Export CSV" onPress={exportCsv} hitSlop={8}
          style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line2, backgroundColor: C.card }, pressed && { opacity: 0.8 }]}>
          <Icon name="download" size={20} color={C.ink} />
        </Pressable>
      ),
    });
  });
  const routeName = range.route ? `Route ${range.route}` : 'All routes';

  return (
    <Screen>
      <Segmented full value={preset} onChange={choosePreset} options={PRESETS} />
      {preset === 'custom' && (
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}><DateField label="From" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} /></View>
          <View style={{ flex: 1 }}><DateField label="To" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} /></View>
        </Row>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Select
          label="Route"
          value={range.route}
          onChange={(v) => setRange((r) => ({ ...r, route: v }))}
          searchable
          options={[{ value: '', label: 'All routes' }, ...(routes.data ?? []).map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))]}
          trigger={(open) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`${routeName}, change route`} onPress={open}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised }, pressed && { opacity: 0.85 }]}>
              <Icon name="route" size={16} color={C.muted} />
              <Text style={{ fontSize: 15, ...F[600], color: C.ink }}>{routeName}</Text>
              <Icon name="down" size={16} color={C.faint} />
            </Pressable>
          )}
        />
        <Txt muted style={{ flex: 1 }} numberOfLines={1}>{rangeText(range.from, range.to)}</Txt>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }} style={{ marginRight: -16 }}>
        {SECTIONS.map((x) => {
          const on = tab === x.value;
          return (
            <Pressable key={x.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(x.value)}
              style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: on ? C.navyFill : C.line, backgroundColor: on ? C.navyFill : C.card, justifyContent: 'center' }}>
              <Text style={{ fontSize: 14, ...F[600], color: on ? '#fff' : C.ink }}>{x.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ErrorText>{error ?? loadError}</ErrorText>

      {tab === 'register' && (reg == null ? loading : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi label="Boarding records" value={reg.length} note={PRESETS.find((x) => x.value === preset)?.label.toLowerCase()} />
            <Kpi label="Present" value={reg.length ? `${Math.round((regStats.present / reg.length) * 100)}%` : '—'} note={`${regStats.present} of ${reg.length}`} tone={C.live} />
            <Kpi label="Students riding" value={regStats.students} note="students" />
            <Kpi label="Pending · flagged" value={`${regStats.pending} · ${regStats.flagged}`} note={regStats.pending || regStats.flagged ? 'need review' : 'all clear'} tone={regStats.pending || regStats.flagged ? C.delayed : undefined} />
          </View>
          <DayBars title="Students present per day" data={regStats.days} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Export CSV" variant="ghost" icon="list" onPress={exportCsv} style={{ flex: 1 }} />
            <Button title="Export PDF" variant="ghost" icon="download" onPress={exportPdf} style={{ flex: 1 }} />
          </View>
          <Block
            title="Register by bus"
            caption={`${regBuses.length} bus${regBuses.length === 1 ? '' : 'es'} · ${reg.length} records · tap a bus to open it`}
          >
            {regBuses.length > 4 ? <SearchBox value={busQuery} onChange={setBusQuery} placeholder="Search bus or route" /> : null}
            {shownBuses.length === 0 ? <Txt muted>{busQuery ? 'No buses match.' : 'No attendance in this period.'}</Txt> : shownBuses.map((g) => (
              <ListCard
                key={g.bus}
                onPress={() => setBusId(g.bus)}
                lead={<RouteCode code={g.route} />}
                title={g.bus}
                lines={[`${g.students.length} student${g.students.length === 1 ? '' : 's'} · ${g.rows.length} record${g.rows.length === 1 ? '' : 's'}`]}
                count={g.present}
                countLabel="PRESENT"
              />
            ))}
            <Button small variant="ghost" icon="download" title="CSV per student" onPress={() => csv('/api/reports/attendance', 'attendance-per-student', '&group=student')} />
          </Block>
        </>
      ))}

      {tab !== 'register' && tab !== 'accuracy' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {CSV[tab] ? <Button title="Export CSV" variant="ghost" icon="list" onPress={exportCsv} style={{ flex: 1 }} /> : null}
          {tab !== 'eta' ? <Button title="Export PDF" variant="ghost" icon="download" onPress={exportPdf} style={{ flex: 1 }} /> : null}
        </View>
      ) : null}

      {tab === 'demand' && (demand.data == null ? loading : (
        <>
          <StatGrid>
            <Stat icon="users" label="Boardings" value={demandTotal} />
            <Stat icon="clock" label="Peak hour" value={peak ? `${peak.label}:00` : '—'} />
          </StatGrid>
          <Block title="Busiest boarding stops" caption="Top 12 by boardings" right={<CsvButton title="CSV" onPress={() => csv('/api/reports/demand', 'stop-demand')} />}>
            <HBars rows={demandByStop} label={(r) => r.label} value={(r) => r.n} />
          </Block>
          <Block title="Boardings by hour" caption="Hour of the day (campus time)">
            <ColumnChart data={demandByHour} highlightLast={false} color={C.emerald} />
          </Block>
        </>
      ))}

      {tab === 'occupancy' && (occ == null ? loading : (
        <>
          <StatGrid>
            <Stat icon="bus" label="Trips" value={occ.length} />
            <Stat icon="chart" label="Average load" value={occLoads.length ? `${Math.round(occLoads.reduce((n, r) => n + r.load_pct, 0) / occLoads.length)}%` : '—'} />
            <Stat icon="alert" label="Over capacity" value={occ.filter((r) => r.load_pct > 100).length} tone={occ.some((r) => r.load_pct > 100) ? 'danger' : undefined} />
            <Stat icon="users" label="Near full (> 85%)" value={occ.filter((r) => r.load_pct > 85 && r.load_pct <= 100).length} tone="delayed" />
          </StatGrid>
          <Block title="Occupancy against capacity" right={<CsvButton title="CSV" onPress={() => csv('/api/reports/occupancy', 'occupancy')} />}>
            <Table
              rows={occ}
              keyOf={(r) => r.trip_id}
              empty="No trips in this period."
              columns={[
                { key: 'started', label: 'Started', flex: 1.2, render: (r) => r.started.slice(5) },
                { key: 'route', label: 'Route', flex: 0.7, align: 'center' },
                { key: 'travelled', label: 'Riders', flex: 0.9, align: 'right', render: (r) => `${r.travelled}/${r.capacity ?? '—'}` },
                { key: 'load', label: 'Load', flex: 0.9, align: 'right', render: (r) => <Badge tone={r.load_pct > 100 ? 'danger' : r.load_pct > 85 ? 'delayed' : 'live'}>{`${r.load_pct ?? '—'}%`}</Badge> },
              ]}
            />
          </Block>
        </>
      ))}

      {tab === 'exceptions' && (ex == null ? loading : (
        <>
          <StatGrid>
            <Stat icon="alert" label="Provisional / flagged" value={ex.provisionalOrFlagged.length} tone={ex.provisionalOrFlagged.length ? 'delayed' : undefined} />
            <Stat icon="edit" label="Manual overrides" value={ex.manualOverrides.length} />
            <Stat icon="signal" label="System incidents" value={ex.systemIncidents.length} tone={ex.systemIncidents.length ? 'danger' : undefined} />
            <Stat icon="shield" label="Flagged devices" value={ex.flaggedDevices.length} tone={ex.flaggedDevices.length ? 'danger' : undefined} />
          </StatGrid>
          <Block title="Provisional, auto-confirmed or flagged records">
            <Table
              rows={ex.provisionalOrFlagged}
              keyOf={(r) => r.attendance_id}
              empty="None in this period."
              columns={[
                { key: 'username', label: 'Student', flex: 1.4, bold: true },
                { key: 'trip_id', label: 'Trip', flex: 0.6, align: 'center' },
                { key: 'status', label: 'Status', flex: 1.4, align: 'right', render: (r) => <Badge tone={r.flagged ? 'danger' : 'delayed'}>{r.flag_reason ?? `${statusText(r.status)}${r.auto_confirmed ? ' · auto' : ''}`}</Badge> },
              ]}
            />
          </Block>
          <Block title="Manual overrides">
            <Table
              rows={ex.manualOverrides}
              keyOf={(r, i) => i}
              empty="No overrides in this period."
              columns={[
                { key: 'username', label: 'Student', flex: 1.1, bold: true },
                { key: 'trip_id', label: 'Trip', flex: 0.5, align: 'center' },
                { key: 'detail', label: 'Detail', flex: 1.6 },
              ]}
            />
          </Block>
          <Block title="System incidents" caption="Capacity, tracker, conflicts and mock location">
            <Table
              rows={ex.systemIncidents}
              empty="No system incidents."
              columns={[
                { key: 'kind', label: 'Kind', flex: 1.2, render: (r) => statusText(r.kind) },
                { key: 'message', label: 'Message', flex: 1.8 },
                { key: 'status', label: 'Status', flex: 0.9, align: 'right', render: (r) => <Badge tone={r.status === 'OPEN' ? 'danger' : 'offline'}>{statusText(r.status)}</Badge> },
              ]}
            />
          </Block>
          <Block title="Flagged devices and trips">
            <Table rows={ex.flaggedDevices} keyOf={(r) => r.username} empty="No mock-location devices." columns={[{ key: 'username', label: 'Student', flex: 1.4, bold: true }, { key: 'platform', label: 'Platform', flex: 1, align: 'right' }]} />
            <Table rows={ex.flaggedTrips} keyOf={(r) => r.trip_id} empty="No flagged trips." columns={[{ key: 'trip_id', label: 'Trip', flex: 0.6 }, { key: 'route', label: 'Route', flex: 0.6, align: 'center' }, { key: 'flag_reason', label: 'Reason', flex: 1.6 }]} />
          </Block>
        </>
      ))}

      {tab === 'leakage' && (leak == null ? loading : (
        <>
          <StatGrid>
            <Stat icon="alert" label="Rides without a pass" value={leak.length} tone={leak.length ? 'danger' : 'live'} />
            <Stat icon="users" label="Students" value={new Set(leak.map((r) => r.username)).size} />
          </StatGrid>
          <Block
            title="Travelled without a subscription"
            caption="Recorded on a bus (by QR or the driver) with no subscription covering that day."
            right={<CsvButton title="CSV" onPress={() => csv('/api/reports/leakage', 'subscriber-vs-traveller')} />}
          >
            <Table
              rows={leak}
              keyOf={(r) => `${r.trip_id}:${r.username}`}
              empty="Nobody travelled without a pass in this period."
              columns={[
                { key: 'date', label: 'Date', flex: 0.8, render: (r) => r.date.slice(5) },
                { key: 'student', label: 'Student', flex: 1.7, render: (r) => <View><Txt small bold numberOfLines={1}>{r.full_name}</Txt><Txt small muted numberOfLines={1}>{r.register_no ?? r.username}</Txt></View> },
                { key: 'route', label: 'Route', flex: 0.6, align: 'center' },
                { key: 'method', label: 'Method', flex: 0.8, align: 'right' },
              ]}
            />
          </Block>
        </>
      ))}

      {tab === 'eta' && <EtaAccuracy token={token} q={q} />}
      {tab === 'accuracy' && <AccuracyUpload token={token} />}

      {openBus ? (
        <BusRegister
          group={openBus}
          visible={!row}
          onRow={setRow}
          onClose={() => setBusId(null)}
          onCsv={() => download(`/api/reports/attendance?${new URLSearchParams({ from: range.from, to: range.to, route: openBus.route })}&format=csv`, token, `attendance-${openBus.bus}.csv`).catch((e) => setError(e.message))}
        />
      ) : null}
      {row && (
        <Sheet title={row.full_name} onClose={() => setRow(null)}>
          <View style={{ gap: 10 }}>
            <KV k="Student" v={`${row.register_no ?? row.username}${row.department ? ` · ${row.department}` : ''}`} />
            <KV k="Date" v={row.date} />
            <KV k="Route / bus" v={`${row.route} · ${row.bus}`} />
            <KV k="Trip" v={`#${row.trip_id}`} />
            <KV k="Direction" v={<DirectionBadge direction={row.direction} />} />
            <KV k="Status" v={<Badge tone={STATUS_TONE[row.status] ?? 'offline'}>{`${statusText(row.status)}${row.auto_confirmed ? ' (auto)' : ''}`}</Badge>} />
            <KV k="Method" v={METHOD_TEXT[row.method] ?? row.method} />
            <KV k="Boarded" v={`${row.boarded ?? '—'} ${row.boarding_stop ?? ''}`} />
            <KV k="Alighted" v={`${row.alighted ?? '—'} ${row.alighting_stop ?? ''}`} />
            <KV k="Present" v={<YesNo value={row.present} />} />
            {row.flagged ? <KV k="Flag" v={<Badge tone="danger">flagged</Badge>} /> : null}
          </View>
        </Sheet>
      )}
    </Screen>
  );
}
