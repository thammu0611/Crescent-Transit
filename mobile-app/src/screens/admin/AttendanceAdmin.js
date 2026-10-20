import { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Chips, DetailModal, Figure } from '../../components/adminkit.js';
import Icon from '../../components/Icon.js';
import {
  Avatar, Badge, Button, DataList, Empty, ErrorText, ItemCard, KV, LinkButton, Notice, PageHead, Panel, RouteCode, Row, Screen,
  SearchBox, SectionTitle, Segmented, Sheet, Skeleton, Stat, StatGrid, Text, TextField, Txt, usePrompt, YesNo,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { METHOD_TEXT, STATUS_TEXT, date, dateTime, daysAgo, thisMonth, time, today } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { C, F, G, shadow } from '../../theme.js';

const DAY_TONE = { PRESENT: 'live', ABSENT: 'danger', PENDING: 'delayed' };
const DAY_TEXT = { PRESENT: 'Present', ABSENT: 'Absent', PENDING: 'Pending review' };
const RECORD_TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'info', REJECTED: 'offline', VOID: 'danger' };
const RECORD_TEXT = { ...STATUS_TEXT, REJECTED: 'Said No', PROMPTED: 'Awaiting answer' };

/** One provisional or disputed record, with the evidence behind it (doc 9.8). */
function Review({ token, item, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  const decide = (decision) => a.run(() => api(`/api/admin/attendance/${item.attendance_id}/resolve`, { token, body: { decision, reason } })).then((r) => r && onDone());
  const disputed = item.status === 'DISPUTED';
  const spanS = item.first_match_at && item.last_match_at ? Math.round((new Date(item.last_match_at) - new Date(item.first_match_at)) / 1000) : null;
  const ok = reason.trim().length >= 3;
  return (
    <Sheet title={`${item.full_name} · ${item.fleet_code} · trip #${item.trip_id}`} onClose={onClose}>
      <View style={{ gap: 10 }}>
        {disputed ? (
          <Txt>
            <Txt bold>Dispute:</Txt> “{item.dispute_reason}” - the student says they were <Txt bold>{item.claimed_present ? 'on' : 'not on'}</Txt> the bus.
            Record was {STATUS_TEXT[item.previous_status]}.
          </Txt>
        ) : (
          <View style={{ gap: 6 }}>
            <Txt><Txt bold>Provisional:</Txt> the phone and the bus moved together{spanS != null ? ` for ${spanS} s` : ''} but the student did not answer the prompt.</Txt>
            {item.flagged ? <Row><Badge tone="danger">{item.flag_reason ?? 'flagged'}</Badge><Txt small muted>never auto-confirms</Txt></Row> : null}
          </View>
        )}
        <Txt bold>Evidence</Txt>
        <DataList
          rows={item.evidence ?? []}
          empty="No stored evidence (manual or QR record)."
          render={(e) => (
            <ItemCard title={`${time(e.server_ts)} · ${e.event_type}`}>
              <Txt small muted>
                {e.distance_m != null ? `${Math.round(e.distance_m)} m` : '—'} · {e.speed_kmph != null ? `${Math.round(e.speed_kmph)} km/h` : '—'} · Δ {e.bearing_delta != null ? `${Math.round(e.bearing_delta)}°` : '—'}
              </Txt>
              {e.detail ? <Txt small>{e.detail}</Txt> : null}
            </ItemCard>
          )}
        />
        <TextField label="Reason (recorded with your decision)" value={reason} onChangeText={setReason} />
        <ErrorText>{a.error}</ErrorText>
        <Row>
          {disputed ? (
            <>
              <Button title="Mark present" disabled={!ok} busy={a.busy} onPress={() => decide('PRESENT')} style={{ flex: 1 }} />
              <Button title="Mark absent" variant="danger" disabled={!ok || a.busy} onPress={() => decide('ABSENT')} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <Button title="Confirm present" disabled={!ok} busy={a.busy} onPress={() => decide('CONFIRM')} style={{ flex: 1 }} />
              <Button title="Void" variant="danger" disabled={!ok || a.busy} onPress={() => decide('VOID')} style={{ flex: 1 }} />
            </>
          )}
        </Row>
      </View>
    </Sheet>
  );
}

const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];
const periodRange = (p) => {
  if (p === 'all') return { from: '2020-01-01', to: today() };
  if (p === 'month') return { from: `${thisMonth()}-01`, to: today() };
  return { from: daysAgo(Number(p) - 1), to: today() };
};

/** One student's attendance, date by date (doc 9.14), with the phone binding. */
function StudentHistory({ token, student: initial, onClose, onUnbind }) {
  const [student, setStudent] = useState(initial);
  const [unbinding, setUnbinding] = useState(null); // reason text while the unbind form is open
  const [busy, setBusy] = useState(false);
  const unbind = async () => {
    setBusy(true);
    const ok = await onUnbind(student, unbinding.trim());
    setBusy(false);
    if (ok) { setStudent({ ...student, device: null, mock_location_flag: false }); setUnbinding(null); }
  };
  const [period, setPeriod] = useState('30');
  const [status, setStatus] = useState('');
  const q = new URLSearchParams(periodRange(period)).toString();
  const h = useAsync(() => api(`/api/admin/students/${student.id}/attendance?${q}`, { token }), [student.id, q, token]);
  const days = h.data?.days ?? null;
  const shown = days?.filter((d) => !status || d.status === status);
  const sm = h.data?.summary;
  return (
    <DetailModal title={student.full_name} subtitle={`${student.register_no ?? student.username} · attendance history`} onClose={onClose} refreshing={h.loading && h.data != null} onRefresh={h.reload}>
      <View style={{ backgroundColor: C.glass, borderRadius: 22, padding: 18, gap: 14, borderWidth: 1, borderColor: C.glassEdge, ...shadow }}>
        <Row gap={14}>
          <Avatar name={student.full_name} size={54} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 18, ...F[700], color: C.ink }}>{student.full_name}</Text>
            <Txt small muted>{[student.register_no, student.department, `@${student.username}`].filter(Boolean).join(' · ')}</Txt>
            <Row gap={6} wrap>
              <Badge tone={student.subscribed ? 'live' : 'danger'}>{student.subscribed ? 'Pass active' : 'No active pass'}</Badge>
              {student.location_consent ? <Badge tone="info">GPS consent</Badge> : <Badge tone="offline">No GPS consent</Badge>}
            </Row>
          </View>
        </Row>
        <KV k="Route" v={student.route_code ? `${student.route_code} · ${student.route_name ?? ''}` : '—'} />
        <KV k="Boarding stop" v={student.home_stop ?? 'Not chosen'} />
        <KV k="Phone app" v={student.device ? <Row gap={6}><Txt small>{student.device}</Txt>{student.mock_location_flag ? <Badge tone="danger">mock location</Badge> : null}</Row> : 'Not bound'} />
        {student.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${student.phone}`)} accessibilityRole="link">
            <Row gap={6}><Icon name="phone" size={14} color={C.red} /><Text style={{ color: C.red, ...F[600] }}>{student.phone}</Text></Row>
          </Pressable>
        ) : null}
        {student.device && unbinding == null ? <LinkButton title="Unbind phone" onPress={() => setUnbinding('')} /> : null}
        {student.device && unbinding != null ? (
          <View style={{ gap: 8 }}>
            <TextField label="Reason for unbinding (lost or replaced phone)" value={unbinding} onChangeText={setUnbinding} />
            <Row gap={10}>
              <Button small variant="ghost" title="Cancel" style={{ flex: 1 }} onPress={() => setUnbinding(null)} />
              <Button small variant="danger" title="Unbind" style={{ flex: 1 }} busy={busy} disabled={unbinding.trim().length < 3} onPress={unbind} />
            </Row>
          </View>
        ) : null}
        <View style={{ height: 1, backgroundColor: C.line2 }} />
        <Row>
          <Figure value={sm ? (sm.attendancePct == null ? '—' : `${sm.attendancePct}%`) : '…'} label="Attendance" />
          <Figure value={sm?.present ?? '…'} label="Present" />
          <Figure value={sm?.absent ?? '…'} label="Absent" />
          <Figure value={sm?.trips ?? '…'} label="Trips" />
        </Row>
        {sm?.lastBoardedAt ? <Txt small muted>Last boarded {dateTime(sm.lastBoardedAt)}</Txt> : null}
      </View>

      <View style={{ gap: 10 }}>
        <Chips value={period} onChange={setPeriod} options={PERIODS} />
        <Chips
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All days', count: days?.length },
            { value: 'PRESENT', label: 'Present', count: sm?.present },
            { value: 'ABSENT', label: 'Absent', count: sm?.absent },
            { value: 'PENDING', label: 'Pending', count: sm?.pending },
          ]}
        />
      </View>
      <Txt small muted>A day is listed when the student's route ran a trip or the student was recorded on any bus. Absent: the route ran and nothing was recorded.</Txt>
      <ErrorText>{h.error?.message}</ErrorText>
      {shown == null ? <View style={{ gap: 10 }}><Skeleton /><Skeleton /><Skeleton /></View> : shown.length === 0 ? <Empty icon="check">No days in this period.</Empty> : shown.map((d) => (
        <View key={d.date} style={{ backgroundColor: C.glass, borderRadius: 16, borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C[DAY_TONE[d.status]] ?? C.delayed }} />
          <View style={{ padding: 14, paddingLeft: 18, gap: 10 }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt bold>{date(`${d.date}T06:30:00Z`)}</Txt>
                <Txt small muted>{d.routeTrips ? `Route ran ${d.routeTrips} trip${d.routeTrips === 1 ? '' : 's'}` : 'Rode another route'}</Txt>
              </View>
              <Badge tone={DAY_TONE[d.status]}>{DAY_TEXT[d.status]}</Badge>
            </Row>
            {d.records.length === 0 ? <Txt small muted>No boarding recorded.</Txt> : d.records.map((r) => (
              <Row key={r.attendance_id} gap={10} style={{ alignItems: 'flex-start', paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line2 }}>
                <RouteCode code={r.route_code} small />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt small bold style={{ fontVariant: ['tabular-nums'] }}>{time(r.boarded_at)}{r.alighted_at ? ` – ${time(r.alighted_at)}` : ''} · {r.fleet_code}</Txt>
                  <Txt small muted numberOfLines={2}>{[r.boarding_stop, r.alighting_stop].filter(Boolean).join(' → ') || r.route_name}</Txt>
                  <Txt small muted>{METHOD_TEXT[r.method] ?? r.method} · trip #{r.trip_id}{r.auto_confirmed ? ' · auto-confirmed' : ''}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge tone={RECORD_TONE[r.status] ?? 'offline'}>{RECORD_TEXT[r.status] ?? r.status}</Badge>
                  {r.flagged ? <Badge tone="danger">{r.flag_reason ?? 'flagged'}</Badge> : null}
                </View>
              </Row>
            ))}
          </View>
        </View>
      ))}
    </DetailModal>
  );
}

/** The students whose home route is this bus's route, by stop. */
function BusStudents({ token, bus, onClose, onUnbind }) {
  const [open, setOpen] = useState(null);
  const students = useAsync(() => api(`/api/admin/students?route=${encodeURIComponent(bus.route_code)}`, { token }), [bus.route_code, token]);
  const [q, setQ] = useState('');
  const [pass, setPass] = useState('');
  const list = students.data ?? null;
  const needle = q.trim().toLowerCase();
  const shown = list?.filter((s) => (!pass || (pass === 'yes') === Boolean(s.subscribed))
    && (!needle || [s.full_name, s.username, s.register_no, s.department, s.home_stop].some((v) => v && String(v).toLowerCase().includes(needle))));
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of shown ?? []) {
      const k = s.home_stop ?? 'No stop chosen';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return [...m.entries()];
  }, [shown]);
  const withPass = (list ?? []).filter((s) => s.subscribed).length;
  return (
    <DetailModal title={bus.fleet_code} subtitle={`Route ${bus.route_code} · ${bus.route_name}`} onClose={onClose} refreshing={students.loading && students.data != null} onRefresh={students.reload}>
      <View style={{ backgroundColor: C.glass, borderRadius: 22, padding: 18, gap: 14, borderWidth: 1, borderColor: C.glassEdge, ...shadow }}>
        <Row gap={12}>
          <RouteCode code={bus.route_code} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, ...F[700], color: C.ink }} numberOfLines={1}>{bus.route_name}</Text>
            <Txt small muted numberOfLines={1}>{bus.driver_name ? `Driver ${bus.driver_name}` : 'No driver assigned'}{bus.registration_number ? ` · ${bus.registration_number}` : ''}</Txt>
          </View>
          {bus.live ? <Badge tone="live">On trip</Badge> : null}
        </Row>
        <Row>
          <Figure value={list?.length ?? '…'} label="Students" />
          <Figure value={list ? withPass : '…'} label="With pass" />
          <Figure value={bus.capacity ?? '—'} label="Seats" />
        </Row>
      </View>
      <SearchBox value={q} onChange={setQ} placeholder="Search name, register no or stop" />
      <Chips value={pass} onChange={setPass} options={[{ value: '', label: 'All', count: list?.length }, { value: 'yes', label: 'Pass active', count: list ? withPass : undefined }, { value: 'no', label: 'No pass', count: list ? list.length - withPass : undefined }]} />
      <ErrorText>{students.error?.message}</ErrorText>
      {shown == null ? <View style={{ gap: 10 }}><Skeleton /><Skeleton /></View> : shown.length === 0 ? <Empty icon="users">No students on this route match.</Empty> : groups.map(([stop, rows]) => (
        <View key={stop} style={{ gap: 8 }}>
          <Row gap={6} style={{ marginTop: 4 }}>
            <Icon name="pin" size={13} color={C.navy} />
            <Text style={{ flex: 1, fontSize: 12, ...F[700], color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }} numberOfLines={1}>{stop}</Text>
            <Txt small muted>{rows.length}</Txt>
          </Row>
          {rows.map((s) => (
            <Pressable key={s.id} onPress={() => setOpen(s)} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge }, pressed && { opacity: 0.8 }]}>
              <Avatar name={s.full_name} size={40} />
              <View style={{ flex: 1 }}>
                <Txt bold numberOfLines={1}>{s.full_name}</Txt>
                <Txt small muted numberOfLines={1}>{[s.register_no ?? s.username, s.department].filter(Boolean).join(' · ')}</Txt>
              </View>
              <Badge tone={s.subscribed ? 'live' : 'danger'}>{s.subscribed ? 'Pass' : 'No pass'}</Badge>
              <Icon name="arrow" size={15} color={C.faint} />
            </Pressable>
          ))}
        </View>
      ))}
      {open && <StudentHistory token={token} student={open} onClose={() => setOpen(null)} onUnbind={onUnbind} />}
    </DetailModal>
  );
}

/** Every bus as a card: route, driver, students and whether it is on a trip. */
function BusesTab({ buses, onOpen }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = buses.data?.filter((b) => !needle || [b.fleet_code, b.route_code, b.route_name, b.driver_name].some((v) => v && String(v).toLowerCase().includes(needle)));
  const total = (buses.data ?? []).reduce((n, b) => n + (b.students ?? 0), 0);
  return (
    <>
      <StatGrid>
        <Stat icon="bus" label="Buses" value={buses.data?.length} />
        <Stat icon="users" label="Students" value={buses.data ? total : null} />
      </StatGrid>
      <SearchBox value={q} onChange={setQ} placeholder="Search bus, route or driver" />
      <ErrorText>{buses.error?.message}</ErrorText>
      {list == null ? <View style={{ gap: 10 }}><Skeleton /><Skeleton /></View> : list.length === 0 ? <Empty icon="bus">No buses match.</Empty> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {list.map((b) => {
            const off = !b.route_code;
            return (
              <Pressable
                key={b.id}
                disabled={off}
                onPress={() => onOpen(b)}
                accessibilityRole="button"
                style={({ pressed }) => [{ flexBasis: '47%', flexGrow: 1, padding: 14, gap: 10, borderRadius: 18, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, borderTopWidth: b.live ? 3 : 1, borderTopColor: b.live ? C.live : C.glassEdge, ...shadow, shadowOpacity: 0.04 }, !b.students && { opacity: 0.78 }, off && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}
              >
                <Row>
                  {b.route_code ? <RouteCode code={b.route_code} small /> : <Badge tone="offline">No route</Badge>}
                  <View style={{ flex: 1 }} />
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: b.live ? C.live : b.status === 'active' ? C.navy100 : C.delayed }} />
                </Row>
                <View>
                  <Txt bold numberOfLines={1}>{b.fleet_code}</Txt>
                  <Txt small muted numberOfLines={1}>{b.route_name ?? '—'}</Txt>
                </View>
                <Row gap={6}>
                  <Icon name="users" size={13} color={C.navy} />
                  <Txt small bold>{b.students ?? 0}</Txt>
                  <Txt small muted style={{ flex: 1 }} numberOfLines={1}>students</Txt>
                </Row>
                <Txt small muted numberOfLines={1}>{b.driver_name ?? 'No driver'}</Txt>
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
}

export default function AttendanceAdmin() {
  const { token } = useSession();
  const prompt = usePrompt();
  const [tab, setTab] = useState('buses');
  const queue = useAsync(() => api('/api/admin/attendance/review', { token }), [token]);
  const buses = useAsync(() => api('/api/admin/buses', { token }), [token]);
  const [q, setQ] = useState('');
  const students = useAsync(() => (tab === 'tools' ? api(`/api/admin/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }) : Promise.resolve(null)), [tab, q, token]);
  const [open, setOpen] = useState(null);
  const [bus, setBus] = useState(null);
  const [student, setStudent] = useState(null);
  const [manual, setManual] = useState({ tripId: '', username: '', reason: '', status: 'PRESENT' });
  const a = useAction();
  const { refreshing, onRefresh } = useRefresh(queue, buses, students);

  const unbind = async (st, given) => {
    const reason = given ?? await prompt(`Unbind ${st.username}'s phone (lost or replaced)? Reason:`);
    if (!reason) return false;
    const ok = await a.run(() => api(`/api/admin/students/${st.id}/device`, { token, method: 'DELETE', body: { reason } }), `${st.username} can bind a new phone.`);
    students.reload();
    return Boolean(ok);
  };

  const saveManual = () => {
    if (!/^\d+$/.test(manual.tripId) || !manual.username.trim() || manual.reason.trim().length < 3) return a.setError('Trip number, username and a reason (3+ characters) are required.');
    a.run(() => api('/api/attendance/manual', { token, body: { ...manual, tripId: Number(manual.tripId) } }), 'Saved.');
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="check" colors={G.emerald} eyebrow="Transport office" title="Attendance" subtitle="Pick a bus to see its students and each student's day-by-day record. Admins see registers, never where a student is." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'buses', label: 'By bus' }, { value: 'review', label: `Review${queue.data?.length ? ` (${queue.data.length})` : ''}` }, { value: 'tools', label: 'Tools' }]} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>

      {tab === 'buses' && <BusesTab buses={buses} onOpen={setBus} />}

      {tab === 'review' && (
        <Panel title={`Review queue (${queue.data?.length ?? '…'})`} icon="alert">
          <Txt muted small>Provisional records and disputes need a human decision.</Txt>
          <ErrorText>{queue.error?.message}</ErrorText>
          {queue.data?.length === 0 ? <Empty>Nothing to review.</Empty> : (
            <DataList
              rows={queue.data}
              keyOf={(r) => r.attendance_id}
              render={(r) => (
                <ItemCard
                  title={`${r.full_name} (${r.username})`}
                  subtitle={`${r.fleet_code} · #${r.trip_id} · ${dateTime(r.boarded_at)}`}
                  tone={r.status === 'DISPUTED' ? 'delayed' : 'offline'}
                  right={<View style={{ gap: 4, alignItems: 'flex-end' }}><Badge tone={r.status === 'DISPUTED' ? 'delayed' : 'offline'}>{r.status}</Badge>{r.flagged ? <Badge tone="danger">{r.flag_reason ?? 'flagged'}</Badge> : null}</View>}
                  onPress={() => setOpen(r)}
                >
                  <LinkButton title="Review" onPress={() => setOpen(r)} />
                </ItemCard>
              )}
            />
          )}
        </Panel>
      )}

      {tab === 'tools' && (
        <>
          <Panel title="Correct a record" icon="edit">
            <Txt muted small>Mark a student present or absent on a trip, with a reason. Recorded as a manual override.</Txt>
            <Row gap={10}>
              <TextField label="Trip #" value={manual.tripId} onChangeText={(v) => setManual((m) => ({ ...m, tripId: v.replace(/\D/g, '') }))} keyboardType="number-pad" style={{ flex: 1 }} />
              <TextField label="Username" value={manual.username} onChangeText={(v) => setManual((m) => ({ ...m, username: v }))} autoCapitalize="none" style={{ flex: 1 }} />
            </Row>
            <Segmented value={manual.status} onChange={(v) => setManual((m) => ({ ...m, status: v }))} options={[{ value: 'PRESENT', label: 'Present' }, { value: 'ABSENT', label: 'Absent (void)' }]} />
            <TextField label="Reason" value={manual.reason} onChangeText={(v) => setManual((m) => ({ ...m, reason: v }))} />
            <Button title="Save" busy={a.busy} onPress={saveManual} />
          </Panel>

          <SectionTitle title="Find a student" />
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, username or register no" />
          <DataList
            rows={students.data}
            render={(st) => (
              <ItemCard title={st.full_name} subtitle={`${st.username}${st.register_no ? ` · ${st.register_no}` : ''}${st.department ? ` · ${st.department}` : ''}`} onPress={() => setStudent(st)}>
                <KV k="Route / stop" v={st.route_code ? `${st.route_code} ${st.home_stop ?? ''}` : '—'} />
                <KV k="Subscriber" v={<YesNo value={st.subscribed} />} />
                <KV k="Phone" v={st.device ? <Row gap={6}><Txt small>{st.device}</Txt>{st.mock_location_flag ? <Badge tone="danger">mock</Badge> : null}</Row> : 'Not bound'} />
                <Row gap={12}>
                  <LinkButton icon="eye" title="History" onPress={() => setStudent(st)} />
                  {st.device ? <LinkButton title="Unbind phone" onPress={() => unbind(st)} /> : null}
                </Row>
              </ItemCard>
            )}
          />

          <Panel title="Scheduled jobs" icon="clock">
            <Txt muted small>Run now instead of waiting: prompt timeouts (every 15 s) and the nightly 23:30 lock and auto-confirm.</Txt>
            <Row gap={10}>
              <Button small variant="ghost" title="Run timeouts" style={{ flex: 1 }} onPress={() => a.run(() => api('/api/admin/jobs/tick', { token, method: 'POST' }), (r) => `Timeouts: ${JSON.stringify(r)}`).then(queue.reload)} />
              <Button small variant="ghost" title="Run nightly" style={{ flex: 1 }} onPress={() => a.run(() => api('/api/admin/jobs/nightly', { token, method: 'POST' }), (r) => `Nightly: ${JSON.stringify(r.attendance)}`).then(queue.reload)} />
            </Row>
          </Panel>
        </>
      )}

      {open && <Review token={token} item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); queue.reload(); }} />}
      {bus && <BusStudents token={token} bus={bus} onClose={() => setBus(null)} onUnbind={unbind} />}
      {student && <StudentHistory token={token} student={student} onClose={() => setStudent(null)} onUnbind={unbind} />}
    </Screen>
  );
}
