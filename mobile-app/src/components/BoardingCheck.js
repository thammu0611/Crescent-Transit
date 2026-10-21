import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { api, getSocket } from '../lib/api.js';
import { ATTENDANCE_CHANGED, emit } from '../lib/events.js';
import { time } from '../lib/format.js';
import { cancelReminder, cancelReminders, pushRegistered, scheduleRepeatingReminder, showNotification } from '../lib/notify.js';
import { useSession } from '../lib/session.js';
import { C, F, R } from '../theme.js';
import Icon from './Icon.js';
import { Badge, Button, ErrorText, Sheet, Text, Txt } from './ui.js';

const busName = (fleetCode) => fleetCode.replace('BSACIST-', 'Bus ');
const reminderId = (checkId) => `boarding-${checkId}`;

/**
 * "Did you board Bus 118 at Velachery?" (server/boarding.js). Asked when the
 * bus GPS shows the bus leaving the student's saved stop, and asked again
 * every 10 minutes until the student answers: by the server (socket and push),
 * or - on a phone the server cannot push to - by a reminder the phone repeats
 * itself. "Later" only hides it until the next reminder.
 */
export default function BoardingCheck() {
  const { token, user } = useSession();
  const [checks, setChecks] = useState([]);
  const [snoozed, setSnoozed] = useState(() => new Map()); // checkId -> hidden until (ms)
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const student = user?.role === 'student';

  const remindLocally = useCallback((c) => {
    if (pushRegistered()) return; // the server's push reminders reach this phone
    scheduleRepeatingReminder(reminderId(c.checkId), {
      title: `Reminder: did you board ${busName(c.fleetCode)}?`,
      body: `${c.stopName ? `${c.stopName} · ` : ''}Route ${c.routeCode} · tap to answer`,
      minutes: c.remindEveryMinutes,
      data: { type: 'boarding:check', checkId: c.checkId },
    });
  }, []);

  const loadPending = useCallback(async () => {
    if (!token || !student) return;
    try {
      const list = await api('/api/boarding-checks/pending', { token });
      setChecks(list);
      // Answered elsewhere (another phone, the web app) while this app was closed.
      cancelReminders('boarding-', list.map((c) => reminderId(c.checkId)));
      list.forEach(remindLocally);
    } catch {
      // Not critical: the next reminder or app start brings it.
    }
  }, [token, student, remindLocally]);

  useEffect(() => {
    if (!token || !student) return undefined;
    loadPending();
    const socket = getSocket(token);
    const onCheck = (c) => {
      setChecks((list) => [c, ...list.filter((x) => x.checkId !== c.checkId)]);
      setSnoozed((m) => { const next = new Map(m); next.delete(c.checkId); return next; });
      if (pushRegistered()) return; // the push already showed it
      if (!c.reminder) remindLocally(c);
      showNotification(`${c.reminder ? 'Reminder: did' : 'Did'} you board ${busName(c.fleetCode)}?`, `${c.stopName ? `${c.stopName} · ` : ''}Route ${c.routeCode} · tap to answer`);
    };
    const onClosed = ({ checkId }) => {
      cancelReminder(reminderId(checkId));
      setChecks((list) => list.filter((x) => x.checkId !== checkId));
    };
    socket.on('boarding:check', onCheck);
    socket.on('boarding:closed', onClosed);
    socket.on('connect', loadPending);
    // Back from the background (a reminder was tapped): show the question again.
    const appState = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setSnoozed(new Map());
      loadPending();
    });
    const timer = setInterval(() => {
      setSnoozed((m) => {
        const now = Date.now();
        const next = new Map([...m].filter(([, until]) => until > now));
        return next.size === m.size ? m : next;
      });
    }, 30000);
    return () => {
      socket.off('boarding:check', onCheck);
      socket.off('boarding:closed', onClosed);
      socket.off('connect', loadPending);
      appState.remove();
      clearInterval(timer);
    };
  }, [token, student, loadPending, remindLocally]);

  const check = checks.find((c) => !snoozed.has(c.checkId));
  if (!check) return null;

  const answer = async (a) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/boarding-checks/${check.checkId}/answer`, { token, body: { answer: a } });
      cancelReminder(reminderId(check.checkId));
      setChecks((list) => list.filter((x) => x.checkId !== check.checkId));
      emit(ATTENDANCE_CHANGED);
    } catch (err) {
      setError(err.message);
      if (err.status === 409 || err.status === 404) setTimeout(loadPending, 1200);
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    const until = Math.max(Date.parse(check.nextReminderAt) || 0, Date.now() + check.remindEveryMinutes * 60000 * 0.9);
    setSnoozed((m) => new Map(m).set(check.checkId, until));
  };

  return (
    <Sheet onClose={later}>
      <View style={{ gap: 10, paddingBottom: 4, alignItems: 'stretch' }}>
        <View style={{ alignSelf: 'center', width: 58, height: 58, borderRadius: 18, backgroundColor: C.red50, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bus" size={28} color={C.red600} />
        </View>
        {check.reminders > 0 ? <View style={{ alignSelf: 'center' }}><Badge tone="delayed">{`Reminder ${check.reminders}`}</Badge></View> : null}
        <Text style={{ fontSize: 22, ...F.display, color: C.ink, textAlign: 'center' }}>Did you board {busName(check.fleetCode)}?</Text>
        <Txt muted style={{ textAlign: 'center' }}>
          Route {check.routeCode} · {check.routeName}{'\n'}The bus left {check.stopName ?? 'your stop'} at {time(check.departedAt)}{check.tripRunning ? '' : ' · trip finished'}
        </Txt>
        <ErrorText>{error}</ErrorText>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="No, I didn't" variant="ghost" disabled={busy} onPress={() => answer('NO')} style={{ flex: 1, minHeight: 60 }} />
          <Button title="Yes, I'm on it" variant="primary" disabled={busy} onPress={() => answer('YES')} style={{ flex: 1, minHeight: 60 }} />
        </View>
        <Button title={`Ask me again in ${check.remindEveryMinutes} minutes`} variant="light" icon="clock" small disabled={busy} onPress={later} />
        <View style={{ backgroundColor: C.surface, borderRadius: R.md, padding: 10 }}>
          <Txt muted small style={{ textAlign: 'center' }}>Based on your bus's GPS. We remind you every {check.remindEveryMinutes} minutes until you answer; "Yes" marks your attendance for this trip.</Txt>
        </View>
      </View>
    </Sheet>
  );
}
