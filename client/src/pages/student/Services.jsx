import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { date, dateTime } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { FEEDBACK_TEXT, LOST_STATUS_TEXT, REQUEST_TEXT } from '../../../../shared/service.js';
import Icon from '../../components/Icon.jsx';
import { ViewCard, ViewList } from '../../components/adminkit.jsx';
import { Badge, Empty, ErrorText, Field, ListCard, Notice, Page, Segmented } from '../../components/ui.jsx';

const REQUEST_TONE = { PENDING: 'delayed', APPROVED: 'live', REJECTED: 'danger', CANCELLED: 'offline' };

/** The student decides who can see their trips: a one-time code, and removing a parent. */
function ParentAccess({ token }) {
  const t = useT();
  const parents = useAsync(() => api('/api/guardians', { token }), [token]);
  const [made, setMade] = useState(null);
  const a = useAction();
  const make = () => a.run(() => api('/api/guardians/code', { token, method: 'POST' })).then((r) => r && setMade(r));
  const remove = (p) => {
    if (window.confirm(`Stop ${p.full_name} seeing your trips?`)) a.run(() => api(`/api/guardians/${p.id}`, { token, method: 'DELETE' })).then(parents.reload);
  };
  const list = parents.data ?? [];
  return (
    <ViewCard icon="users" title={t('Parent access')} summary={list.length ? `${list.length} parent${list.length === 1 ? '' : 's'} linked` : 'Let a parent see your bus and trips'}>
      <p className="muted">A parent sees your route, today's trips and where your bus is, never your phone's location. Give them a code to sign up in the app, under Parent.</p>
      {made ? (
        <div className="link-code">
          <b className="tabular">{made.code.replace(/(.{4})/, '$1 ')}</b>
          <small>Works once, until {dateTime(made.expiresAt)}</small>
        </div>
      ) : null}
      <div className="parent-actions">
        <button type="button" className="btn primary inline" disabled={a.busy} onClick={make}><Icon name="plus" size={14} /> {t('Make a code')}</button>
      </div>
      <ErrorText>{a.error}</ErrorText>
      {list.length > 0 && <h4 className="parent-list-title">{t('Linked parents')}</h4>}
      <div className="kit-list">
        {list.map((p) => (
          <ListCard key={p.id} lead={<Icon name="user" size={18} />} title={p.full_name} lines={[p.email, `Linked ${date(p.created_at)}`].filter(Boolean)} side={<button type="button" className="link danger" onClick={() => remove(p)}>Remove</button>} />
        ))}
      </div>
    </ViewCard>
  );
}

/**
 * A parent who will not install the app: the student adds their WhatsApp (or
 * SMS) number, and the same boarded, reached, late and SOS messages go there.
 */
function ParentWhatsApp({ token }) {
  const t = useT();
  const data = useAsync(() => api('/api/me/parent-contacts', { token }), [token]);
  const [form, setForm] = useState({ name: '', phone: '', channel: 'whatsapp' });
  const a = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = (e) => {
    e.preventDefault();
    a.run(() => api('/api/me/parent-contacts', { token, body: form }), t('Added. They will get a message now.'))
      .then((r) => { if (r) { setForm({ name: '', phone: '', channel: 'whatsapp' }); data.reload(); } });
  };
  const remove = (c) => {
    if (window.confirm(`Stop messages to ${c.name}?`)) a.run(() => api(`/api/me/parent-contacts/${c.id}`, { token, method: 'DELETE' })).then(data.reload);
  };
  const d = data.data;
  const list = d?.contacts ?? [];
  const ready = d && (d.channels.whatsapp || d.channels.sms);
  return (
    <ViewCard icon="phone" title={t('Parent on WhatsApp')} summary={list.length ? `${list.length} number${list.length === 1 ? '' : 's'} added` : t('For a parent without the app')}>
      <p className="muted">They get a message when you board and reach, if the bus is late, and in an emergency. No app needed.</p>
      {d && !ready && <p className="notice">{t('Messages start once the transport office switches WhatsApp or SMS on.')}</p>}
      <div className="kit-list">
        {list.map((c) => (
          <ListCard key={c.id} lead={<Icon name="phone" size={18} />} title={c.name} lines={[`${c.phone} · ${c.channel === 'sms' ? 'SMS' : 'WhatsApp'}`]} side={<button type="button" className="link danger" onClick={() => remove(c)}>{t('Remove')}</button>} />
        ))}
      </div>
      {d && list.length < d.max && (
        <form onSubmit={add}>
          <div className="grid2">
            <Field label="Parent's name"><input value={form.name} onChange={set('name')} maxLength={60} required /></Field>
            <Field label="Mobile number"><input type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="98400 12345" required /></Field>
          </div>
          <Segmented value={form.channel} onChange={(channel) => setForm((f) => ({ ...f, channel }))} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }]} />
          <Notice>{a.message}</Notice>
          <ErrorText>{a.error}</ErrorText>
          <button className="btn primary inline" disabled={a.busy}><Icon name="plus" size={14} /> {t('Add number')}</button>
        </form>
      )}
    </ViewCard>
  );
}

/** Ask to move to another route or stop. */
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
  const send = (e) => {
    e.preventDefault();
    a.run(() => api('/api/route-requests', { token, body: { routeCode: form.routeCode, stopSeq: Number(form.stopSeq), reason: form.reason } }), 'Request sent to the transport office.')
      .then((r) => { if (r) { setForm({ routeCode: '', stopSeq: '', reason: '' }); requests.reload(); } });
  };
  const cancel = (r) => a.run(() => api(`/api/route-requests/${r.id}`, { token, method: 'DELETE' })).then(requests.reload);
  return (
    <ViewCard
      icon="route"
      title={t('Change route or stop')}
      summary={waiting ? `Waiting: Route ${waiting.to_route_code}` : 'Ask the transport office to move you'}
      badge={waiting ? <Badge tone="delayed">Waiting</Badge> : null}
    >
      <Notice>{a.message}</Notice>
      {!waiting && (
        <form onSubmit={send}>
          <div className="grid2">
            <Field label="New route">
              <select value={form.routeCode} onChange={(e) => setForm((f) => ({ ...f, routeCode: e.target.value, stopSeq: '' }))} required>
                <option value="">Choose a route</option>
                {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
              </select>
            </Field>
            <Field label="New stop">
              <select value={form.stopSeq} onChange={(e) => setForm((f) => ({ ...f, stopSeq: e.target.value }))} required disabled={!stops.length}>
                <option value="">Choose a stop</option>
                {stops.map((s) => <option key={s.seq} value={s.seq}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Why do you need the change?"><input value={form.reason} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
          <button className="btn primary" disabled={a.busy}>{t('Send request')}</button>
        </form>
      )}
      <ErrorText>{a.error}</ErrorText>
      <div className="kit-list">
        {list.map((r) => (
          <ListCard
            key={r.id}
            lead={<span className="route-code sm">{r.to_route_code}</span>}
            title={`${r.to_route_name} · ${r.to_stop_name ?? ''}`}
            lines={[date(r.created_at), r.admin_note].filter(Boolean)}
            side={<><Badge tone={REQUEST_TONE[r.status]}>{REQUEST_TEXT[r.status]}</Badge>{r.status === 'PENDING' && <button type="button" className="link" onClick={() => cancel(r)}>{t('Cancel')}</button>}</>}
          />
        ))}
      </div>
    </ViewCard>
  );
}

/** Things lost on a bus, and things found. */
function LostAndFound({ token, user }) {
  const t = useT();
  const [mineOnly, setMineOnly] = useState('route');
  const q = mineOnly === 'route' && user.homeRouteCode ? `?route=${encodeURIComponent(user.homeRouteCode)}` : '';
  const items = useAsync(() => api(`/api/lost-items${q}`, { token }), [q, token]);
  const [form, setForm] = useState({ kind: 'LOST', title: '', description: '' });
  const a = useAction();
  const send = (e) => {
    e.preventDefault();
    a.run(() => api('/api/lost-items', { token, body: form })).then((r) => { if (r) { setForm({ kind: 'LOST', title: '', description: '' }); items.reload(); } });
  };
  const close = (i) => a.run(() => api(`/api/lost-items/${i.id}/status`, { token, body: { status: 'RETURNED' } })).then(items.reload);
  const list = items.data ?? [];
  return (
    <ViewCard icon="search" title={t('Lost and found')} summary={items.data ? `${list.length} open item${list.length === 1 ? '' : 's'}` : 'Loading…'}>
      <form onSubmit={send}>
        <Segmented value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} options={[{ value: 'LOST', label: 'I lost something' }, { value: 'FOUND', label: 'I found something' }]} />
        <Field label="What is it?"><input value={form.title} maxLength={80} required minLength={3} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Blue water bottle" /></Field>
        <Field label="Details (colour, seat, when)"><input value={form.description} maxLength={400} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <button className="btn primary" disabled={a.busy}>{t('Report')}</button>
      </form>
      <ErrorText>{a.error}</ErrorText>
      <Segmented value={mineOnly} onChange={setMineOnly} options={[{ value: 'route', label: 'My bus' }, { value: 'all', label: 'All buses' }]} />
      {list.length === 0 ? <Empty>Nothing reported here.</Empty> : (
        <div className="kit-list">
          {list.map((i) => (
            <ListCard
              key={i.id}
              lead={<Badge tone={i.kind === 'FOUND' ? 'live' : 'delayed'}>{i.kind === 'FOUND' ? 'Found' : 'Lost'}</Badge>}
              title={i.title}
              lines={[i.description, `${i.fleet_code ?? 'Bus not known'} · ${date(i.created_at)}`].filter(Boolean)}
              side={i.mine ? <button type="button" className="link" onClick={() => close(i)}>Mark returned</button> : <small>{LOST_STATUS_TEXT[i.status]}</small>}
            />
          ))}
        </div>
      )}
    </ViewCard>
  );
}

function MyFeedback({ token }) {
  const t = useT();
  const list = useAsync(() => api('/api/feedback/me', { token }), [token]).data ?? [];
  const replied = list.filter((f) => f.response).length;
  return (
    <ViewCard icon="check" title={t('My feedback')} summary={list.length ? `${list.length} rated · ${replied} replied` : 'Rate a trip from your attendance record'}>
      {list.length === 0 ? <Empty>Open Attendance and choose Rate trip after you travel.</Empty> : (
        <div className="kit-list">
          {list.map((f) => (
            <ListCard
              key={f.id}
              lead={<span className="route-code sm">{f.route_code}</span>}
              title={`${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)} · ${date(f.created_at)}`}
              lines={[f.tags.map((k) => FEEDBACK_TEXT[k]).join(', '), f.comment, f.response && `Transport office: ${f.response}`].filter(Boolean)}
              side={f.status === 'OPEN' ? <Badge tone="delayed">Open</Badge> : f.status === 'RESOLVED' ? <Badge tone="live">Replied</Badge> : null}
            />
          ))}
        </div>
      )}
    </ViewCard>
  );
}

/** Everything a student asks of the transport office, one card each. */
export default function Services() {
  const { token, user } = useSession();
  const t = useT();
  return (
    <Page eyebrow="Student" title={t('Services')}>
      <ViewList label="Services">
        <ParentAccess token={token} />
        <ParentWhatsApp token={token} />
        <RouteChange token={token} />
        <LostAndFound token={token} user={user} />
        <MyFeedback token={token} />
      </ViewList>
    </Page>
  );
}
