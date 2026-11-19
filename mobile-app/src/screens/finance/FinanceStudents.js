import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DetailModal } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import {
  alpha, Badge, DataList, Empty, ErrorText, ItemCard, KV, LinkButton, Notice, PageHead, Panel, RouteCode, Screen, SearchBox, Segmented, Skeleton, Text,
  Txt, usePrompt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G, R } from '../../theme.js';

// Who to show: everyone, subscribers, students without a subscription, or suspended accounts.
const matches = (s, show) => (show === 'paid' ? s.subscribed : show === 'unpaid' ? !s.subscribed : show === 'suspended' ? s.status !== 'active' : true);
const NO_BUS = '—';

/**
 * Every bus in the fleet, each with the students whose home route it serves (none yet
 * shows 0), and a last card for students whose route has no bus or who chose none.
 */
function busesOf(students, fleet) {
  const list = fleet.map((b) => ({ key: b.fleet_code, routeCode: b.route_code, routeName: b.route_name, fleetCode: b.fleet_code, students: [] }));
  const byCode = new Map(list.map((b) => [b.fleetCode, b]));
  const loose = { key: NO_BUS, routeCode: null, routeName: null, fleetCode: null, students: [] };
  for (const s of students) (byCode.get(s.fleet_code) ?? loose).students.push(s);
  const sorted = list.sort((a, b) => String(a.routeCode ?? '~').localeCompare(String(b.routeCode ?? '~'), undefined, { numeric: true }) || a.fleetCode.localeCompare(b.fleetCode));
  return loose.students.length ? [...sorted, loose] : sorted;
}
const busTitle = (b) => b.fleetCode ?? 'No bus';
const busNote = (b) => (b.fleetCode ? b.routeName ?? 'No route assigned' : 'Students without a bus on their route');

/** Students with their subscription, a filter and the suspend action. */
function StudentList({ students, onChange, showRoute = true }) {
  const [show, setShow] = useState('');
  return (
    <>
      <Segmented value={show} onChange={setShow} options={[{ value: '', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'suspended', label: 'Suspended' }]} />
      <DataList
        rows={students ? students.filter((s) => matches(s, show)) : null}
        empty={show ? 'No students match.' : 'No students yet.'}
        render={(s) => (
          <ItemCard title={s.full_name} subtitle={[s.username, s.register_no, s.department].filter(Boolean).join(' · ')} right={<Badge tone={s.status === 'active' ? 'live' : 'danger'}>{s.status === 'active' ? 'Active' : 'Suspended'}</Badge>}>
            {showRoute ? <KV k="Bus" v={s.fleet_code ?? (s.route_code ? `Route ${s.route_code}` : '—')} /> : null}
            <KV k="Paid until" v={s.paid_until ? date(s.paid_until) : '—'} />
            <KV k="Subscriber" v={<Badge tone={s.subscribed ? 'live' : 'offline'}>{s.subscribed ? 'Yes' : 'No'}</Badge>} />
            <KV k="Payments" v={s.payments} />
            <LinkButton danger={s.status === 'active'} title={s.status === 'active' ? 'Suspend' : 'Reinstate'} onPress={() => onChange(s)} />
          </ItemCard>
        )}
      />
    </>
  );
}

/** One bus: its route, how many of its students have paid, and a bar. Opens its students. */
function BusCard({ bus, onPress }) {
  const paid = bus.students.filter((s) => s.subscribed).length;
  const suspended = bus.students.filter((s) => s.status !== 'active').length;
  const Num = ({ v, k, color }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 18, ...F.displayBold, color: color ?? C.ink, fontVariant: ['tabular-nums'] }}>{v}</Text>
      <Txt muted small>{k}</Txt>
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${busTitle(bus)}, ${bus.students.length} students, ${paid} paid`} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, padding: 14, gap: 10 }, pressed && { opacity: 0.85 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {bus.routeCode ? <RouteCode code={bus.routeCode} /> : <Badge>No bus</Badge>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt bold numberOfLines={1}>{busTitle(bus)}</Txt>
          <Txt muted small numberOfLines={1}>{busNote(bus)}</Txt>
        </View>
        {suspended ? <Badge tone="danger">{`${suspended} suspended`}</Badge> : null}
        <Icon name="arrow" size={16} color={C.faint} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Num v={bus.students.length} k="students" />
        <Num v={paid} k="paid" color={C.live} />
        <Num v={bus.students.length - paid} k="unpaid" color={C.delayed} />
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: alpha(C.offline, 0.25), overflow: 'hidden' }}>
        <View style={{ height: 5, borderRadius: 3, width: `${bus.students.length ? (paid / bus.students.length) * 100 : 0}%`, backgroundColor: C.live }} />
      </View>
    </Pressable>
  );
}

/** Subscriptions by bus; open a bus for its students; suspend accounts that have not paid (doc 4.4). */
export default function FinanceStudents() {
  const { token } = useSession();
  const prompt = usePrompt();
  const [view, setView] = useState('buses');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // the bus key whose students are shown
  const list = useAsync(() => api(`/api/finance/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }), [q, token]);
  const fleet = useAsync(() => api('/api/finance/buses', { token }), [token]);
  // While searching, only buses with a matching student are shown.
  const buses = useMemo(() => (list.data && fleet.data ? busesOf(list.data, fleet.data).filter((b) => !q || b.students.length) : null), [list.data, fleet.data, q]);
  const bus = open ? buses?.find((b) => b.key === open) : null;
  const a = useAction();
  const { refreshing, onRefresh } = useRefresh(list, fleet);
  const change = async (s) => {
    const action = s.status === 'active' ? 'suspend' : 'unsuspend';
    const reason = await prompt(`${action === 'suspend' ? 'Suspend' : 'Reinstate'} ${s.full_name}? Reason:`);
    if (reason) a.run(() => api(`/api/finance/users/${s.id}/${action}`, { token, body: { reason } }), `${s.full_name}: ${action === 'suspend' ? 'suspended' : 'reinstated'}.`).then(list.reload);
  };
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="users" colors={G.navy} eyebrow="Finance office" title="Students" subtitle="Subscriptions by bus. Open a bus to see its students." />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message ?? fleet.error?.message}</ErrorText>
      <Segmented value={view} onChange={setView} options={[{ value: 'buses', label: 'By bus' }, { value: 'all', label: 'All students' }]} />
      <SearchBox value={q} onChange={setQ} placeholder="Search by name or username" />
      {view === 'buses' ? (
        buses == null ? <View style={{ gap: 10 }}><Skeleton /><Skeleton /><Skeleton /></View>
          : buses.length === 0 ? <Empty icon="users">{q ? 'No students match.' : 'No students yet.'}</Empty>
            : <View style={{ gap: 10 }}>{buses.map((b) => <BusCard key={b.key} bus={b} onPress={() => setOpen(b.key)} />)}</View>
      ) : (
        <Panel title="All students" icon="users">
          <StudentList students={list.data ?? null} onChange={change} />
        </Panel>
      )}
      {bus ? (
        <DetailModal title={busTitle(bus)} subtitle={bus.routeCode ? `Route ${bus.routeCode} · ${bus.routeName ?? ''}` : busNote(bus)} onClose={() => setOpen(null)} refreshing={refreshing} onRefresh={onRefresh}>
          <Notice>{a.message}</Notice>
          <ErrorText>{a.error}</ErrorText>
          <StudentList students={bus.students} onChange={change} showRoute={false} />
        </DetailModal>
      ) : null}
    </Screen>
  );
}
