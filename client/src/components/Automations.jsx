import { useState } from 'react';
import { api, download } from '../lib/api.js';
import { date, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { useAsync } from '../lib/useAsync.js';
import Icon from './Icon.jsx';
import { Block } from './adminkit.jsx';
import { Badge, ErrorText, Notice } from './ui.jsx';

const KIND = {
  TIMETABLE: { icon: 'clock', tone: 'delayed', label: 'Timetable' },
  OVERCROWDING: { icon: 'users', tone: 'danger', label: 'Overcrowding' },
  REPLACEMENT: { icon: 'bus', tone: 'danger', label: 'Breakdown' },
};

/** What a suggestion would change, in a few lines. */
function SuggestionDetail({ s }) {
  const d = s.detail ?? {};
  if (s.kind === 'TIMETABLE') {
    return (
      <ul className="sugg-stops">
        {(d.stops ?? []).slice(0, 8).map((c) => (
          <li key={c.seq}><span>{c.name}</span><s>{c.current}</s><Icon name="arrow" size={12} /><b>{c.proposed}</b><small>{c.diff > 0 ? `+${c.diff}` : c.diff} min</small></li>
        ))}
        {(d.stops ?? []).length > 8 && <li className="muted">{`and ${d.stops.length - 8} more stops`}</li>}
      </ul>
    );
  }
  if (s.kind === 'OVERCROWDING') {
    return (
      <p className="muted">
        {`Most on one trip: ${d.most ?? '—'} for ${d.capacity ?? '—'} seats. `}
        {d.spareBus ? `Spare bus: ${d.spareBus.fleetCode}${d.spareBus.driver ? ` (${d.spareBus.driver})` : ''}. ` : 'No spare bus is free. '}
        {d.nearbyRoutes?.length ? `Less crowded nearby: ${d.nearbyRoutes.map((r) => `Route ${r.routeCode} (${r.avgLoad}% full)`).join(', ')}.` : ''}
      </p>
    );
  }
  const r = d.replacement ?? {};
  return (
    <p className="muted">
      {`${r.fleetCode}${r.driver ? `, driver ${r.driver}` : ''}${r.km != null ? `, ${r.km} km away` : ''}. Approving tells the route's students and parents, and sends the driver there.`}
      {d.alternatives?.length ? ` Other free buses: ${d.alternatives.map((b) => b.fleetCode).join(', ')}.` : ''}
    </p>
  );
}

const STATUS_TEXT = { APPLIED: 'Approved', DISMISSED: 'Dismissed' };

/**
 * The transport office's queue: approve or dismiss in one click. On the
 * dashboard (`compact`) it shows only what is waiting and hides when empty;
 * the Suggestions page passes a status filter and shows decided ones too.
 */
export function SuggestionsBlock({ status = 'PENDING', compact = true, reloadKey = 0 }) {
  const { token } = useSession();
  const list = useAsync(() => api(`/api/admin/suggestions?status=${status === 'ALL' ? 'all' : status}`, { token }), [token, status, reloadKey]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const decide = async (s, action) => {
    setBusy(s.id);
    setError(null);
    try {
      await api(`/api/admin/suggestions/${s.id}/${action}`, { token, method: 'POST' });
      setDone(action === 'apply' ? (s.kind === 'TIMETABLE' ? 'Timetable updated.' : s.kind === 'REPLACEMENT' ? 'Students, parents and the driver have been told.' : 'Marked as done.') : 'Dismissed.');
      list.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  if (compact && !list.data?.length && !done) return null;
  return (
    <Block
      title={compact ? 'Suggestions' : null}
      caption={compact ? 'Worked out from how the buses really ran. Nothing changes until you approve.' : null}
      actions={compact ? <a className="btn ghost inline" href="#/suggestions">See all<Icon name="arrow" size={14} /></a> : null}
    >
      <Notice>{done}</Notice>
      <ErrorText>{error}</ErrorText>
      {!compact && list.data?.length === 0 && <p className="muted">{status === 'PENDING' ? 'Nothing is waiting for you.' : 'None yet.'}</p>}
      {!compact && list.data == null && <div className="skeleton-block short" />}
      <div className="sugg-list">
        {(list.data ?? []).map((s) => {
          const k = KIND[s.kind];
          return (
            <article key={s.id} className="sugg" data-c={k.tone}>
              <span className="sugg-icon"><Icon name={k.icon} size={18} /></span>
              <div className="sugg-body">
                <div className="sugg-top"><Badge tone={k.tone}>{k.label}</Badge><small className="muted">{dateTime(s.created_at)}</small></div>
                <b>{s.title}</b>
                <SuggestionDetail s={s} />
              </div>
              {s.status === 'PENDING' ? (
                <div className="sugg-actions">
                  <button className="btn primary inline" disabled={busy === s.id} onClick={() => decide(s, 'apply')}>{s.kind === 'OVERCROWDING' ? 'Mark done' : 'Approve'}</button>
                  <button className="btn ghost inline" disabled={busy === s.id} onClick={() => decide(s, 'dismiss')}>Dismiss</button>
                </div>
              ) : (
                <div className="sugg-actions">
                  <Badge tone={s.status === 'APPLIED' ? 'live' : 'offline'}>{STATUS_TEXT[s.status]}</Badge>
                  <small className="muted">{[s.decided_by_name, s.decided_at && dateTime(s.decided_at)].filter(Boolean).join(' · ')}</small>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Block>
  );
}

/** Last week at a glance, the PDF, and "email it now". The server emails it every Monday. */
export function WeeklyReportBlock() {
  const { token, user } = useSession();
  const week = useAsync(() => api('/api/admin/weekly-report', { token }), [token]);
  const auto = useAsync(() => api('/api/admin/automations', { token }), [token]);
  const [to, setTo] = useState(user?.email ?? '');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const w = week.data;
  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    setMsg(null);
    setError(null);
    try {
      await api('/api/admin/weekly-report/send', { token, body: { to } });
      setMsg(`Sent to ${to}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };
  const a = auto.data;
  // Preview: the same one-page PDF the transport head gets, opened in a new tab.
  const preview = async () => {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/admin/weekly-report.pdf', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError(err.message);
    }
  };
  return (
    <Block
      title="Weekly report"
      caption={w ? `${date(w.from).replace(/ \d{4}$/, '')} – ${date(w.to)} · emailed ${w.schedule}${w.recipients?.length ? ` to ${w.recipients.join(', ')}` : ' (no address set on the server)'}` : ' '}
      actions={(
        <>
          <button className="btn ghost inline" onClick={preview}><Icon name="eye" size={14} />Preview</button>
          <button className="btn ghost inline" onClick={() => download('/api/admin/weekly-report.pdf', token, 'transport-report.pdf').catch((err) => setError(err.message))}><Icon name="download" size={14} />Download</button>
        </>
      )}
    >
      {w ? (
        <div className="weekly-figs">
          <div><b>{w.onTimePct == null ? '—' : `${w.onTimePct}%`}</b><small>On time</small></div>
          <div><b>{w.trips.ran}</b><small>Trips run</small></div>
          <div><b>{w.lateBuses.length}</b><small>Late buses</small></div>
          <div><b>{w.incidents.reduce((n, i) => n + i.n, 0)}</b><small>Incidents</small></div>
          <div><b>{w.riders.students}</b><small>Riders</small></div>
          <div><b>{w.feedback.complaints}</b><small>Complaints</small></div>
          <div><b>{`₹${(w.collections.paise / 100).toLocaleString('en-IN')}`}</b><small>Collected</small></div>
        </div>
      ) : <div className="skeleton-block short" />}
      <form className="weekly-send" onSubmit={send}>
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Email address" required aria-label="Email address" />
        <button className="btn ghost inline" disabled={sending}><Icon name="mail" size={14} />{sending ? 'Sending…' : 'Send now'}</button>
      </form>
      <Notice>{msg}</Notice>
      <ErrorText>{error}</ErrorText>
      {a && (
        <details className="auto-list">
          <summary>What runs by itself</summary>
          <ul>
            <li>{`Renewal reminders ${a.renewalReminders.daysBefore[0]} days before, on the last day, and when grace starts`}</li>
            <li>{`Pre-trip check reminder ${a.checklistReminderMin} min before each run`}</li>
            <li>{`Unanswered complaints: reminder after ${a.complaintHours.remind} h, transport head after ${a.complaintHours.escalate} h`}</li>
            <li>{`SOS not acknowledged in ${a.escalation.afterMinutes} min goes to ${a.escalation.chain.length ? a.escalation.chain.map((p) => p.name).join(', then ') : 'every administrator by text and email'}`}</li>
            <li>{a.phoneAutoStart ? 'Trips start by themselves when a phone-only bus leaves the depot' : 'Automatic trip start for phone-only buses is off'}</li>
            <li>{a.serviceCredits ? 'A day is added to subscriptions when a route does not run' : 'Service credit is off'}</li>
            <li>{a.messaging.whatsapp || a.messaging.sms ? `Parents without the app get ${[a.messaging.whatsapp && 'WhatsApp', a.messaging.sms && 'SMS'].filter(Boolean).join(' and ')} messages` : 'WhatsApp/SMS for parents is not set up on the server'}</li>
          </ul>
        </details>
      )}
    </Block>
  );
}
