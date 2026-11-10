import { useState } from 'react';
import { api } from '../../lib/api.js';
import { date, dateTime } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { CHECKLIST_ITEMS, DAY_KIND_TEXT, FEEDBACK_TEXT, LOST_STATUS_TEXT, REQUEST_TEXT } from '../../../../shared/service.js';
import { dayText } from '../../components/DayBanner.jsx';
import { DIRECTION_TEXT } from '../../../../shared/direction.js';
import { HBars } from '../../components/adminkit.jsx';
import { Badge, Dropdown, Empty, ErrorText, Field, ListCard, Modal, Page, Panel, Segmented, Stat } from '../../components/ui.jsx';

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
    <Panel title="Trip feedback and complaints" icon="alert">
      <div className="att-filters narrow">
        <Dropdown label="Show" icon="list" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open complaints' }, { value: 'RESOLVED', label: 'Replied' }, { value: 'NOTED', label: 'Ratings only' }, { value: '', label: 'Everything' }]} />
      </div>
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <div className="skeleton-block" /> : list.data.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="kit-list">
          {list.data.map((f) => (
            <ListCard
              key={f.id}
              lead={<span className="route-code sm">{f.route_code}</span>}
              title={`${stars(f.rating)} · ${f.full_name}`}
              lines={[`${f.fleet_code} · ${DIRECTION_TEXT[f.direction]} · ${dateTime(f.started_at)}`, f.tags.map((k) => FEEDBACK_TEXT[k]).join(', '), f.comment, f.response && `Replied: ${f.response}`].filter(Boolean)}
              tone={f.status === 'OPEN' ? 'alert' : undefined}
              side={f.status === 'OPEN' ? <button type="button" className="btn ghost inline" onClick={() => setReplying(f)}>Reply</button> : <Badge tone={f.status === 'RESOLVED' ? 'live' : 'offline'}>{f.status === 'RESOLVED' ? 'Replied' : 'Rating'}</Badge>}
            />
          ))}
        </div>
      )}
      {replying && (
        <Modal title={`Reply to ${replying.full_name}`} onClose={() => setReplying(null)}>
          <p className="muted">{replying.comment ?? replying.tags.map((k) => FEEDBACK_TEXT[k]).join(', ')}</p>
          <Field label="Your reply"><textarea rows={3} value={response} maxLength={500} onChange={(e) => setResponse(e.target.value)} /></Field>
          <ErrorText>{a.error}</ErrorText>
          <button type="button" className="btn primary" disabled={a.busy || response.trim().length < 3} onClick={send}>Send and close</button>
        </Modal>
      )}
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
      <div className="att-filters narrow">
        <Dropdown label="Show" icon="list" value={status} onChange={setStatus} options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Not approved' }, { value: '', label: 'Everything' }]} />
      </div>
      <ErrorText>{list.error?.message}</ErrorText>
      {list.data == null ? <div className="skeleton-block" /> : list.data.length === 0 ? <Empty>No requests here.</Empty> : (
        <div className="kit-list">
          {list.data.map((r) => (
            <ListCard
              key={r.id}
              lead={<span className="route-code sm">{r.to_route_code}</span>}
              title={r.full_name}
              lines={[`${r.from_route_code ?? 'No route'} ${r.from_stop_name ?? ''} → ${r.to_route_code} ${r.to_stop_name ?? ''}`, `${r.students} students, ${r.seats} seats${r.full ? ' · full' : ''}`, r.reason].filter(Boolean)}
              onClick={r.status === 'PENDING' ? () => setOpen(r) : undefined}
              side={<Badge tone={r.full && r.status === 'PENDING' ? 'danger' : REQUEST_TONE[r.status]}>{r.full && r.status === 'PENDING' ? 'Route full' : REQUEST_TEXT[r.status]}</Badge>}
            />
          ))}
        </div>
      )}
      {open && (
        <Modal title={`${open.full_name} → Route ${open.to_route_code}`} onClose={() => setOpen(null)}>
          <p className="muted">{open.to_route_name} · {open.to_stop_name}<br />{open.students} students for {open.seats} seats on this route.</p>
          <Field label="Note to the student (needed to refuse)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorText>{a.error}</ErrorText>
          <div className="btn-row spaced">
            <button type="button" className="btn primary inline" disabled={a.busy} onClick={() => decide('APPROVE', open.full)}>{open.full ? 'Approve anyway' : 'Approve'}</button>
            <button type="button" className="btn danger inline" disabled={a.busy || note.trim().length < 3} onClick={() => decide('REJECT')}>Refuse</button>
          </div>
        </Modal>
      )}
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
      <div className="att-filters narrow">
        <Dropdown label="Show" icon="list" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RETURNED', label: 'Returned' }, { value: 'CLOSED', label: 'Closed' }, { value: 'all', label: 'Everything' }]} />
      </div>
      <ErrorText>{list.error?.message ?? a.error}</ErrorText>
      {list.data == null ? <div className="skeleton-block" /> : list.data.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="kit-list">
          {list.data.map((i) => (
            <ListCard
              key={i.id}
              lead={<Badge tone={i.kind === 'FOUND' ? 'live' : 'delayed'}>{i.kind === 'FOUND' ? 'Found' : 'Lost'}</Badge>}
              title={i.title}
              lines={[i.description, `${i.fleet_code ?? 'Bus not known'} · ${date(i.created_at)}`, [i.reporter, i.reporter_phone ?? i.reporter_email].filter(Boolean).join(' · ')].filter(Boolean)}
              side={i.status === 'OPEN' ? <><button type="button" className="link" onClick={() => close(i, 'RETURNED')}>Returned</button><button type="button" className="link" onClick={() => close(i, 'CLOSED')}>Close</button></> : <small>{LOST_STATUS_TEXT[i.status]}</small>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function DriverChecks({ token }) {
  const list = useAsync(() => api('/api/admin/checklists', { token }), [token]);
  const rows = list.data?.rows;
  return (
    <Panel title="Today's pre-trip checks" icon="check">
      <ErrorText>{list.error?.message}</ErrorText>
      {rows == null ? <div className="skeleton-block" /> : rows.length === 0 ? <Empty>No checks submitted today.</Empty> : (
        <div className="kit-list">
          {rows.map((c) => (
            <ListCard
              key={c.id}
              lead={<span className="route-code sm">{c.route_code ?? '—'}</span>}
              title={`${c.fleet_code} · ${DIRECTION_TEXT[c.direction]}`}
              lines={[`${c.driver_name ?? 'Driver'} · ${dateTime(c.created_at)}`, c.failed ? `Failed: ${CHECKLIST_ITEMS.filter(([k]) => !c.results[k]).map(([, v]) => v).join(', ')}` : 'Everything passed', c.note].filter(Boolean)}
              tone={c.failed ? 'alert' : undefined}
              side={<Badge tone={c.failed ? 'danger' : 'live'}>{c.failed ? `${c.failed} failed` : 'Passed'}</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Calendar({ token }) {
  const cal = useAsync(() => api('/api/calendar'), []);
  const blank = { day: '', kind: 'HOLIDAY', title: '', note: '', morningShift: '', eveningShift: '' };
  const [form, setForm] = useState(blank);
  const a = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const holiday = form.kind === 'HOLIDAY';
  const save = (e) => {
    e.preventDefault();
    a.run(() => api('/api/admin/calendar', { token, body: { ...form, morningShift: Number(form.morningShift || 0), eveningShift: Number(form.eveningShift || 0) } }), 'Saved.')
      .then((r) => { if (r) { setForm(blank); cal.reload(); } });
  };
  const remove = (d) => a.run(() => api(`/api/admin/calendar/${d.day}`, { token, method: 'DELETE' })).then(cal.reload);
  const list = cal.data?.upcoming ?? [];
  return (
    <>
      <Panel title="Holidays and special days" icon="clock" summary="On a holiday, boarding questions, attendance prompts and bus alerts stop">
        <form onSubmit={save}>
          <div className="grid2">
            <Field label="Date"><input type="date" value={form.day} onChange={set('day')} required /></Field>
            <Field label="Kind">
              <select value={form.kind} onChange={set('kind')}>
                {Object.entries(DAY_KIND_TEXT).map(([k, v]) => <option key={k} value={k}>{v}{k === 'HOLIDAY' ? ' (no buses)' : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Name"><input value={form.title} maxLength={80} required minLength={2} onChange={set('title')} placeholder="e.g. Pongal" /></Field>
          {!holiday && (
            <div className="grid2">
              <Field label="Morning timetable moves by (minutes)" hint="60 is an hour later, -30 half an hour earlier"><input type="number" value={form.morningShift} onChange={set('morningShift')} /></Field>
              <Field label="Evening timetable moves by (minutes)"><input type="number" value={form.eveningShift} onChange={set('eveningShift')} /></Field>
            </div>
          )}
          <Field label="Note for students"><input value={form.note} maxLength={300} onChange={set('note')} /></Field>
          <ErrorText>{a.error}</ErrorText>
          <button className="btn primary" disabled={a.busy}>Save day</button>
        </form>
      </Panel>
      <Panel title="Coming up" icon="list">
        {cal.data == null ? <div className="skeleton-block" /> : list.length === 0 ? <Empty>Nothing on the calendar.</Empty> : (
          <div className="kit-list">
            {list.map((d) => (
              <ListCard
                key={d.day}
                lead={<Badge tone={d.no_service ? 'danger' : 'delayed'}>{DAY_KIND_TEXT[d.kind]}</Badge>}
                title={`${d.title} · ${date(d.day)}`}
                lines={[dayText(d), d.note]}
                side={<button type="button" className="link danger" onClick={() => remove(d)}>Remove</button>}
              />
            ))}
          </div>
        )}
      </Panel>
      <p className="fine-print">One-off trips are added under Trips, Schedule.</p>
    </>
  );
}

/** The transport office's desk: what students and drivers have raised. */
export default function ServiceDesk() {
  const { token } = useSession();
  const [tab, setTab] = useState('feedback');
  const quality = useAsync(() => api('/api/admin/service-quality', { token }), [token]);
  const q = quality.data;
  return (
    <Page eyebrow="Transport office" title="Service desk" wide>
      <div className="kit-stats">
        <Stat icon="check" label="Trip rating, 30 days" value={q ? (q.rating == null ? '—' : `${q.rating} / 5`) : null} tone="live" />
        <Stat icon="alert" label="Open complaints" value={q?.open_complaints} tone={q?.open_complaints ? 'danger' : ''} />
        <Stat icon="route" label="Route requests" value={q?.route_requests} tone={q?.route_requests ? 'delayed' : ''} />
        <Stat icon="search" label="Lost items open" value={q?.lost_items} />
      </div>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'feedback', label: 'Feedback' }, { value: 'routes', label: 'Route requests' }, { value: 'lost', label: 'Lost and found' }, { value: 'checks', label: 'Driver checks' }, { value: 'calendar', label: 'Calendar' }]} />
      {tab === 'feedback' && <Feedback token={token} onChanged={quality.reload} />}
      {tab === 'routes' && <RouteRequests token={token} onChanged={quality.reload} />}
      {tab === 'lost' && <LostItems token={token} onChanged={quality.reload} />}
      {tab === 'checks' && <DriverChecks token={token} />}
      {tab === 'calendar' && <Calendar token={token} />}
      {tab === 'feedback' && q?.topTags?.length > 0 && (
        <Panel title="Most mentioned, 30 days" icon="chart">
          <HBars rows={q.topTags} label={(r) => FEEDBACK_TEXT[r.tag] ?? r.tag} value={(r) => r.n} />
        </Panel>
      )}
    </Page>
  );
}
