// The transport office's suggestions queue and the weekly report, for the
// phone's dashboard. Same endpoints as the website (server/routes/automations.js).
import { useState } from 'react';
import { View } from 'react-native';
import { api, download } from '../lib/api.js';
import { date, dateTime } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';
import { useSession } from '../lib/session.js';
import { C, F } from '../theme.js';
import { Block } from './adminkit.js';
import { Badge, Button, ErrorText, ItemCard, Notice, Row, Text, TextField, Txt } from './ui.js';

const KIND = {
  TIMETABLE: { tone: 'delayed', label: 'Timetable' },
  OVERCROWDING: { tone: 'danger', label: 'Overcrowding' },
  REPLACEMENT: { tone: 'danger', label: 'Breakdown' },
};

function detailLines(s) {
  const d = s.detail ?? {};
  if (s.kind === 'TIMETABLE') {
    return (d.stops ?? []).slice(0, 6).map((c) => `${c.name}: ${c.current} → ${c.proposed} (${c.diff > 0 ? '+' : ''}${c.diff} min)`)
      .concat((d.stops ?? []).length > 6 ? [`and ${d.stops.length - 6} more stops`] : []);
  }
  if (s.kind === 'OVERCROWDING') {
    return [
      `Most on one trip: ${d.most ?? '—'} for ${d.capacity ?? '—'} seats.`,
      d.spareBus ? `Spare bus: ${d.spareBus.fleetCode}${d.spareBus.driver ? ` (${d.spareBus.driver})` : ''}.` : 'No spare bus is free.',
      ...(d.nearbyRoutes?.length ? [`Less crowded nearby: ${d.nearbyRoutes.map((r) => `Route ${r.routeCode} (${r.avgLoad}% full)`).join(', ')}.`] : []),
    ];
  }
  const r = d.replacement ?? {};
  return [`${r.fleetCode}${r.driver ? `, driver ${r.driver}` : ''}${r.km != null ? `, ${r.km} km away` : ''}.`, 'Approving tells the route\'s students and parents, and sends the driver there.'];
}

const STATUS_TEXT = { APPLIED: 'Approved', DISMISSED: 'Dismissed' };

/**
 * Approve or dismiss what the server worked out. On the dashboard (`compact`)
 * only what is waiting, hidden when empty; the Suggestions screen passes a filter.
 */
export function SuggestionsCard({ status = 'PENDING', compact = true, reloadKey = 0, onSeeAll = null }) {
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
  const body = (
    <>
      <Notice>{done}</Notice>
      <ErrorText>{error}</ErrorText>
      {!compact && list.data?.length === 0 ? <Txt muted>{status === 'PENDING' ? 'Nothing is waiting for you.' : 'None yet.'}</Txt> : null}
      {(list.data ?? []).map((s) => {
        const k = KIND[s.kind];
        return (
          <ItemCard key={s.id} title={s.title} subtitle={dateTime(s.created_at)} tone={k.tone} right={<Badge tone={k.tone}>{k.label}</Badge>}>
            {detailLines(s).map((line) => <Txt key={line} small muted>{line}</Txt>)}
            {s.status === 'PENDING' ? (
              <Row gap={10}>
                <Button title={s.kind === 'OVERCROWDING' ? 'Mark done' : 'Approve'} busy={busy === s.id} onPress={() => decide(s, 'apply')} style={{ flex: 1 }} />
                <Button title="Dismiss" variant="ghost" disabled={busy === s.id} onPress={() => decide(s, 'dismiss')} style={{ flex: 1 }} />
              </Row>
            ) : (
              <Row gap={8} wrap>
                <Badge tone={s.status === 'APPLIED' ? 'live' : 'offline'}>{STATUS_TEXT[s.status]}</Badge>
                <Txt small muted>{[s.decided_by_name, s.decided_at && dateTime(s.decided_at)].filter(Boolean).join(' · ')}</Txt>
              </Row>
            )}
          </ItemCard>
        );
      })}
      {compact && onSeeAll ? <Button title="See all suggestions" variant="ghost" icon="arrow" onPress={onSeeAll} /> : null}
    </>
  );
  return compact ? <Block title="Suggestions" caption="Nothing changes until you approve">{body}</Block> : body;
}

const Fig = ({ value, label }) => (
  <View style={{ flexBasis: '30%', flexGrow: 1, padding: 10, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2 }}>
    <Text style={{ fontSize: 18, color: C.navy, ...F[700], fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Txt small muted numberOfLines={1}>{label}</Txt>
  </View>
);

/** Last week at a glance, the PDF, and "email it now". The server emails it every Monday. */
export function WeeklyReportCard() {
  const { token, user } = useSession();
  const week = useAsync(() => api('/api/admin/weekly-report', { token }), [token]);
  const [to, setTo] = useState(user?.email ?? '');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const w = week.data;
  const send = async () => {
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
  return (
    <Block title="Weekly report" caption={w ? `${date(w.from).replace(/ \d{4}$/, '')} – ${date(w.to)} · emailed ${w.schedule}` : ' '}>
      {w ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Fig value={w.onTimePct == null ? '—' : `${w.onTimePct}%`} label="On time" />
          <Fig value={w.trips.ran} label="Trips run" />
          <Fig value={w.lateBuses.length} label="Late buses" />
          <Fig value={w.incidents.reduce((n, i) => n + i.n, 0)} label="Incidents" />
          <Fig value={w.riders.students} label="Riders" />
          <Fig value={w.feedback.complaints} label="Complaints" />
        </View>
      ) : null}
      <Button title="Preview PDF" icon="eye" variant="ghost" onPress={() => download('/api/admin/weekly-report.pdf', token, 'transport-report.pdf').catch((err) => setError(err.message))} />
      <TextField label="Email it to" value={to} onChangeText={setTo} keyboardType="email-address" autoCapitalize="none" />
      <Button title={sending ? 'Sending…' : 'Send now'} icon="mail" busy={sending} disabled={!to.includes('@')} onPress={send} />
      <Notice>{msg}</Notice>
      <ErrorText>{error}</ErrorText>
    </Block>
  );
}
