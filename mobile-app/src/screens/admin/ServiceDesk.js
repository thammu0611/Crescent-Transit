import { useState } from 'react';
import { DIRECTION_TEXT } from '../../../../shared/direction.js';
import { CHECKLIST_ITEMS, DAY_KIND_TEXT, FEEDBACK_TEXT, LOST_STATUS_TEXT, REQUEST_TEXT } from '../../../../shared/service.js';
import { dayText } from '../../components/DayBanner.js';
import {
  Badge, Button, DateField, Empty, ErrorText, LinkButton, ListCard, PageHead, Panel, Row, RouteCode, Screen, Segmented, Select, Sheet, Skeleton, Stat, StatGrid, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date, dateTime } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';

const stars = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
const REQUEST_TONE = { PENDING: 'delayed', APPROVED: 'live', REJECTED: 'danger', CANCELLED: 'offline' };

function Feedback({ token, onChanged }) {
  const [status, setStatus] = useState('OPEN');
  const q = status ? `?status=${status}` : '';
  const list = useAsync(() => api(`/api/admin/feedback${q}`, { token }), [q, token]);
  const [replying, setReplying] = useState(null);
  const [response, setResponse] = useState('');
  const a = useAction();
  const send = () => a.run(() => api(`/api/admin/feedback/${replying.id}/respond`, { token, body: { response } })).then((r) => {
    if (r) { setReplying(null); setResponse(''); list.reload(); onChanged(); }
  });
  return (
    <Panel title="Feedback and complaints" icon="alert">
      <Select label="Show" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open complaints' }, { value: 'RESOLVED', label: 'Replied' }, { value: 'NOTED', label: 'Ratings only' }, { value: '', label: 'Everything' }]} />
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <Skeleton /> : list.data.length === 0 ? <Empty icon="check">Nothing here.</Empty> : list.data.map((f) => (
        <ListCard
          key={f.id}
          lead={<RouteCode code={f.route_code} small />}
          title={`${stars(f.rating)} · ${f.full_name}`}
          lines={[`${f.fleet_code} · ${DIRECTION_TEXT[f.direction]}`, f.tags.map((k) => FEEDBACK_TEXT[k]).join(', '), f.comment, f.response && `Replied: ${f.response}`].filter(Boolean)}
          right={f.status === 'OPEN' ? <LinkButton title="Reply" onPress={() => setReplying(f)} /> : null}
        />
      ))}
      {replying ? (
        <Sheet title={`Reply to ${replying.full_name}`} onClose={() => setReplying(null)}>
          <Txt muted small>{replying.comment ?? replying.tags.map((k) => FEEDBACK_TEXT[k]).join(', ')}</Txt>
          <TextField label="Your reply" value={response} multiline maxLength={500} onChangeText={setResponse} />
          <ErrorText>{a.error}</ErrorText>
          <Button title="Send and close" busy={a.busy} disabled={response.trim().length < 3} onPress={send} />
        </Sheet>
      ) : null}
    </Panel>
  );
}

function RouteRequests({ token, onChanged }) {
  const [status, setStatus] = useState('PENDING');
  const q = status ? `?status=${status}` : '';
  const list = useAsync(() => api(`/api/admin/route-requests${q}`, { token }), [q, token]);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const a = useAction();
  const decide = (decision, override = false) => a.run(() => api(`/api/admin/route-requests/${open.id}/decide`, { token, body: { decision, note, override } })).then((r) => {
    if (r) { setOpen(null); setNote(''); list.reload(); onChanged(); }
  });
  return (
    <Panel title="Route-change requests" icon="route">
      <Select label="Show" value={status} onChange={setStatus} options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Not approved' }, { value: '', label: 'Everything' }]} />
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <Skeleton /> : list.data.length === 0 ? <Empty icon="route">No requests here.</Empty> : list.data.map((r) => (
        <ListCard
          key={r.id}
          lead={<RouteCode code={r.to_route_code} small />}
          title={r.full_name}
          lines={[`${r.from_route_code ?? 'No route'} → ${r.to_route_code} ${r.to_stop_name ?? ''}`, `${r.students} students, ${r.seats} seats`, r.reason].filter(Boolean)}
          onPress={r.status === 'PENDING' ? () => setOpen(r) : undefined}
          right={<Badge tone={r.full && r.status === 'PENDING' ? 'danger' : REQUEST_TONE[r.status]}>{r.full && r.status === 'PENDING' ? 'Full' : REQUEST_TEXT[r.status]}</Badge>}
        />
      ))}
      {open ? (
        <Sheet title={`${open.full_name} → Route ${open.to_route_code}`} onClose={() => setOpen(null)}>
          <Txt muted small>{open.to_route_name} · {open.to_stop_name}{'\n'}{open.students} students for {open.seats} seats.</Txt>
          <TextField label="Note to the student (needed to refuse)" value={note} maxLength={300} onChangeText={setNote} />
          <ErrorText>{a.error}</ErrorText>
          <Row gap={10}>
            <Button title={open.full ? 'Approve anyway' : 'Approve'} busy={a.busy} style={{ flex: 1 }} onPress={() => decide('APPROVE', open.full)} />
            <Button title="Refuse" variant="danger" busy={a.busy} disabled={note.trim().length < 3} style={{ flex: 1 }} onPress={() => decide('REJECT')} />
          </Row>
        </Sheet>
      ) : null}
    </Panel>
  );
}

function LostItems({ token, onChanged }) {
  const [status, setStatus] = useState('OPEN');
  const list = useAsync(() => api(`/api/lost-items?status=${status}`, { token }), [status, token]);
  const a = useAction();
  const close = (i, next) => a.run(() => api(`/api/lost-items/${i.id}/status`, { token, body: { status: next } })).then(() => { list.reload(); onChanged(); });
  return (
    <Panel title="Lost and found" icon="search">
      <Select label="Show" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RETURNED', label: 'Returned' }, { value: 'CLOSED', label: 'Closed' }, { value: 'all', label: 'Everything' }]} />
      <ErrorText>{list.error?.message ?? a.error}</ErrorText>
      {list.data == null ? <Skeleton /> : list.data.length === 0 ? <Empty icon="search">Nothing here.</Empty> : list.data.map((i) => (
        <ListCard
          key={i.id}
          lead={<Badge tone={i.kind === 'FOUND' ? 'live' : 'delayed'}>{i.kind === 'FOUND' ? 'Found' : 'Lost'}</Badge>}
          title={i.title}
          lines={[i.description, `${i.fleet_code ?? 'Bus not known'} · ${date(i.created_at)}`, [i.reporter, i.reporter_phone ?? i.reporter_email].filter(Boolean).join(' · ')].filter(Boolean)}
          right={i.status === 'OPEN' ? <LinkButton title="Returned" onPress={() => close(i, 'RETURNED')} /> : <Txt muted small>{LOST_STATUS_TEXT[i.status]}</Txt>}
        />
      ))}
    </Panel>
  );
}

function DriverChecks({ token }) {
  const list = useAsync(() => api('/api/admin/checklists', { token }), [token]);
  const rows = list.data?.rows;
  return (
    <Panel title="Today's pre-trip checks" icon="check">
      <ErrorText>{list.error?.message}</ErrorText>
      {rows == null ? <Skeleton /> : rows.length === 0 ? <Empty icon="check">No checks submitted today.</Empty> : rows.map((c) => (
        <ListCard
          key={c.id}
          lead={<RouteCode code={c.route_code ?? '—'} small />}
          title={`${c.fleet_code} · ${DIRECTION_TEXT[c.direction]}`}
          lines={[`${c.driver_name ?? 'Driver'} · ${dateTime(c.created_at)}`, c.failed ? `Failed: ${CHECKLIST_ITEMS.filter(([k]) => !c.results[k]).map(([, v]) => v).join(', ')}` : 'Everything passed', c.note].filter(Boolean)}
          right={<Badge tone={c.failed ? 'danger' : 'live'}>{c.failed ? `${c.failed} failed` : 'Passed'}</Badge>}
        />
      ))}
    </Panel>
  );
}

function Calendar({ token }) {
  const cal = useAsync(() => api('/api/calendar'), []);
  const blank = { day: '', kind: 'HOLIDAY', title: '', note: '', morningShift: '', eveningShift: '' };
  const [form, setForm] = useState(blank);
  const a = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => a.run(() => api('/api/admin/calendar', { token, body: { ...form, morningShift: Number(form.morningShift || 0), eveningShift: Number(form.eveningShift || 0) } }))
    .then((r) => { if (r) { setForm(blank); cal.reload(); } });
  const remove = (d) => a.run(() => api(`/api/admin/calendar/${d.day}`, { token, method: 'DELETE' })).then(cal.reload);
  const list = cal.data?.upcoming ?? [];
  return (
    <>
      <Panel title="Holidays and special days" icon="clock" summary="On a holiday, questions and bus alerts stop">
        <DateField label="Date" value={form.day} onChange={set('day')} />
        <Select label="Kind" value={form.kind} onChange={set('kind')} options={Object.entries(DAY_KIND_TEXT).map(([value, label]) => ({ value, label }))} />
        <TextField label="Name" value={form.title} maxLength={80} placeholder="e.g. Pongal" onChangeText={set('title')} />
        {form.kind !== 'HOLIDAY' ? (
          <>
            <TextField label="Morning timetable moves by (minutes)" hint="60 is an hour later, -30 half an hour earlier" keyboardType="numbers-and-punctuation" value={form.morningShift} onChangeText={set('morningShift')} />
            <TextField label="Evening timetable moves by (minutes)" keyboardType="numbers-and-punctuation" value={form.eveningShift} onChangeText={set('eveningShift')} />
          </>
        ) : null}
        <TextField label="Note for students" value={form.note} maxLength={300} onChangeText={set('note')} />
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save day" busy={a.busy} disabled={!form.day || form.title.trim().length < 2} onPress={save} />
      </Panel>
      <Panel title="Coming up" icon="list">
        {cal.data == null ? <Skeleton /> : list.length === 0 ? <Empty icon="clock">Nothing on the calendar.</Empty> : list.map((d) => (
          <ListCard key={d.day} title={`${d.title} · ${date(d.day)}`} lines={[DAY_KIND_TEXT[d.kind], dayText(d), d.note].filter(Boolean)} right={<LinkButton title="Remove" danger onPress={() => remove(d)} />} />
        ))}
      </Panel>
    </>
  );
}

/** The transport office's desk: what students and drivers have raised. */
export default function ServiceDesk() {
  const { token } = useSession();
  const [tab, setTab] = useState('feedback');
  const quality = useAsync(() => api('/api/admin/service-quality', { token }), [token]);
  const { refreshing, onRefresh } = useRefresh(quality);
  const q = quality.data;
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="sparkle" colors={G.navy} eyebrow="Transport office" title="Service desk" />
      <StatGrid>
        <Stat icon="check" label="Trip rating" value={q ? (q.rating == null ? '—' : `${q.rating} / 5`) : null} tone="live" />
        <Stat icon="alert" label="Open complaints" value={q?.open_complaints} tone={q?.open_complaints ? 'danger' : undefined} />
        <Stat icon="route" label="Route requests" value={q?.route_requests} tone={q?.route_requests ? 'delayed' : undefined} />
        <Stat icon="search" label="Lost items" value={q?.lost_items} />
      </StatGrid>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'feedback', label: 'Feedback' }, { value: 'routes', label: 'Routes' }, { value: 'lost', label: 'Lost' }, { value: 'checks', label: 'Checks' }, { value: 'calendar', label: 'Calendar' }]} />
      {tab === 'feedback' ? <Feedback token={token} onChanged={quality.reload} /> : null}
      {tab === 'routes' ? <RouteRequests token={token} onChanged={quality.reload} /> : null}
      {tab === 'lost' ? <LostItems token={token} onChanged={quality.reload} /> : null}
      {tab === 'checks' ? <DriverChecks token={token} /> : null}
      {tab === 'calendar' ? <Calendar token={token} /> : null}
    </Screen>
  );
}
