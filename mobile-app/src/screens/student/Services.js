import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { FEEDBACK_TEXT, LOST_STATUS_TEXT, REQUEST_TEXT } from '../../../../shared/service.js';
import { ViewCard } from '../../components/adminkit.js';
import {
  Badge, Button, confirm, Empty, ErrorText, LinkButton, ListCard, Notice, PageHead, RouteCode, Screen, Segmented, Select, Text, TextField, Txt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date, dateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { useT } from '../../lib/offline.js';
import { useSession } from '../../lib/session.js';
import { C, F, G } from '../../theme.js';

const REQUEST_TONE = { PENDING: 'delayed', APPROVED: 'live', REJECTED: 'danger', CANCELLED: 'offline' };

function ParentAccess({ token }) {
  const t = useT();
  const parents = useAsync(() => api('/api/guardians', { token }), [token]);
  const [made, setMade] = useState(null);
  const a = useAction();
  const make = () => a.run(() => api('/api/guardians/code', { token, method: 'POST' })).then((r) => r && setMade(r));
  const remove = async (p) => {
    if (await confirm('Remove parent', `Stop ${p.full_name} seeing your trips?`, 'Remove', true)) a.run(() => api(`/api/guardians/${p.id}`, { token, method: 'DELETE' })).then(parents.reload);
  };
  const list = parents.data ?? [];
  return (
    <ViewCard icon="users" title={t('Parent access')} summary={list.length ? `${list.length} parent${list.length === 1 ? '' : 's'} linked` : 'Let a parent see your bus and trips'}>
      <Txt muted small>A parent sees your route, today's trips and where your bus is, never your phone's location. Give them a code to sign up in the app, under Parent.</Txt>
      {made ? (
        <View style={{ alignItems: 'center', gap: 4, padding: 14, borderRadius: 16, backgroundColor: C.navy50 }}>
          <Text style={{ fontSize: 26, letterSpacing: 3, color: C.navy, ...F[700] }}>{made.code.replace(/(.{4})/, '$1 ')}</Text>
          <Txt muted small>Works once, until {dateTime(made.expiresAt)}</Txt>
          <LinkButton title="Share code" onPress={() => Share.share({ message: `Crescent Transit parent code: ${made.code}` })} />
        </View>
      ) : null}
      <Button title={t('Make a code')} icon="plus" busy={a.busy} onPress={make} />
      <ErrorText>{a.error}</ErrorText>
      {list.map((p) => <ListCard key={p.id} title={p.full_name} lines={[p.email, `Linked ${date(p.created_at)}`].filter(Boolean)} right={<LinkButton title="Remove" danger onPress={() => remove(p)} />} />)}
    </ViewCard>
  );
}

function RouteChange({ token }) {
  const t = useT();
  const requests = useAsync(() => api('/api/route-requests/me', { token }), [token]);
  const routes = useAsync(() => api('/api/routes'), []);
  const [form, setForm] = useState({ routeCode: '', stopSeq: '', reason: '' });
  const [stops, setStops] = useState([]);
  const a = useAction();
  useEffect(() => {
    setStops([]);
    if (form.routeCode) api(`/api/routes/${encodeURIComponent(form.routeCode)}`).then((r) => setStops(r.stops.slice(0, -1))).catch(() => {});
  }, [form.routeCode]);
  const list = requests.data ?? [];
  const waiting = list.find((r) => r.status === 'PENDING');
  const send = () => a.run(() => api('/api/route-requests', { token, body: { routeCode: form.routeCode, stopSeq: Number(form.stopSeq), reason: form.reason } }), 'Request sent to the transport office.')
    .then((r) => { if (r) { setForm({ routeCode: '', stopSeq: '', reason: '' }); requests.reload(); } });
  const cancel = (r) => a.run(() => api(`/api/route-requests/${r.id}`, { token, method: 'DELETE' })).then(requests.reload);
  return (
    <ViewCard icon="route" title={t('Change route or stop')} summary={waiting ? `Waiting: Route ${waiting.to_route_code}` : 'Ask the transport office to move you'} badge={waiting ? <Badge tone="delayed">Waiting</Badge> : null}>
      <Notice>{a.message}</Notice>
      {!waiting ? (
        <>
          <Select label="New route" value={form.routeCode} onChange={(v) => setForm((f) => ({ ...f, routeCode: v, stopSeq: '' }))} placeholder="Choose a route" searchable options={(routes.data ?? []).map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))} />
          <Select label="New stop" value={form.stopSeq} onChange={(v) => setForm((f) => ({ ...f, stopSeq: v }))} placeholder="Choose a stop" disabled={!stops.length} options={stops.map((s) => ({ value: s.seq, label: s.name }))} />
          <TextField label="Why do you need the change?" value={form.reason} maxLength={300} onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))} />
          <Button title={t('Send request')} busy={a.busy} disabled={!form.routeCode || !form.stopSeq} onPress={send} />
        </>
      ) : null}
      <ErrorText>{a.error}</ErrorText>
      {list.map((r) => (
        <ListCard
          key={r.id}
          lead={<RouteCode code={r.to_route_code} small />}
          title={`${r.to_route_name} · ${r.to_stop_name ?? ''}`}
          lines={[date(r.created_at), r.admin_note].filter(Boolean)}
          right={<View style={{ alignItems: 'flex-end', gap: 4 }}><Badge tone={REQUEST_TONE[r.status]}>{REQUEST_TEXT[r.status]}</Badge>{r.status === 'PENDING' ? <LinkButton title={t('Cancel')} onPress={() => cancel(r)} /> : null}</View>}
        />
      ))}
    </ViewCard>
  );
}

function LostAndFound({ token, user }) {
  const t = useT();
  const [scope, setScope] = useState('route');
  const q = scope === 'route' && user.homeRouteCode ? `?route=${encodeURIComponent(user.homeRouteCode)}` : '';
  const items = useAsync(() => api(`/api/lost-items${q}`, { token }), [q, token]);
  const [form, setForm] = useState({ kind: 'LOST', title: '', description: '' });
  const a = useAction();
  const send = () => a.run(() => api('/api/lost-items', { token, body: form })).then((r) => { if (r) { setForm({ kind: 'LOST', title: '', description: '' }); items.reload(); } });
  const close = (i) => a.run(() => api(`/api/lost-items/${i.id}/status`, { token, body: { status: 'RETURNED' } })).then(items.reload);
  const list = items.data ?? [];
  return (
    <ViewCard icon="search" title={t('Lost and found')} summary={items.data ? `${list.length} open item${list.length === 1 ? '' : 's'}` : 'Loading…'}>
      <Segmented value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} options={[{ value: 'LOST', label: 'I lost it' }, { value: 'FOUND', label: 'I found it' }]} />
      <TextField label="What is it?" value={form.title} maxLength={80} placeholder="e.g. Blue water bottle" onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
      <TextField label="Details (colour, seat, when)" value={form.description} maxLength={400} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} />
      <Button title={t('Report')} busy={a.busy} disabled={form.title.trim().length < 3} onPress={send} />
      <ErrorText>{a.error}</ErrorText>
      <Segmented value={scope} onChange={setScope} options={[{ value: 'route', label: 'My bus' }, { value: 'all', label: 'All buses' }]} />
      {list.length === 0 ? <Empty icon="search">Nothing reported here.</Empty> : list.map((i) => (
        <ListCard
          key={i.id}
          lead={<Badge tone={i.kind === 'FOUND' ? 'live' : 'delayed'}>{i.kind === 'FOUND' ? 'Found' : 'Lost'}</Badge>}
          title={i.title}
          lines={[i.description, `${i.fleet_code ?? 'Bus not known'} · ${date(i.created_at)}`].filter(Boolean)}
          right={i.mine ? <LinkButton title="Returned" onPress={() => close(i)} /> : <Txt muted small>{LOST_STATUS_TEXT[i.status]}</Txt>}
        />
      ))}
    </ViewCard>
  );
}

function MyFeedback({ token }) {
  const t = useT();
  const list = useAsync(() => api('/api/feedback/me', { token }), [token]).data ?? [];
  const replied = list.filter((f) => f.response).length;
  return (
    <ViewCard icon="check" title={t('My feedback')} summary={list.length ? `${list.length} rated · ${replied} replied` : 'Rate a trip from your attendance record'}>
      {list.length === 0 ? <Empty icon="check">Open Attendance and choose Rate trip after you travel.</Empty> : list.map((f) => (
        <ListCard
          key={f.id}
          lead={<RouteCode code={f.route_code} small />}
          title={`${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)} · ${date(f.created_at)}`}
          lines={[f.tags.map((k) => FEEDBACK_TEXT[k]).join(', '), f.comment, f.response && `Transport office: ${f.response}`].filter(Boolean)}
          right={f.status === 'OPEN' ? <Badge tone="delayed">Open</Badge> : f.status === 'RESOLVED' ? <Badge tone="live">Replied</Badge> : null}
        />
      ))}
    </ViewCard>
  );
}

/** Everything a student asks of the transport office, one card each. */
export default function Services() {
  const { token, user } = useSession();
  const t = useT();
  return (
    <Screen>
      <PageHead icon="sparkle" colors={G.navy} eyebrow="Student" title={t('Services')} />
      <ParentAccess token={token} />
      <RouteChange token={token} />
      <LostAndFound token={token} user={user} />
      <MyFeedback token={token} />
    </Screen>
  );
}
