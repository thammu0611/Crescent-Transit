import { useCallback, useEffect, useState } from 'react';
import { api, getSocket } from '../lib/api.js';
import { time } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import Icon from './Icon.jsx';
import { ErrorText, Modal } from './ui.jsx';

const busName = (fleetCode) => fleetCode.replace('BSACIST-', 'Bus ');

/**
 * "Did you board Bus 118 at Velachery?" (server/boarding.js). Asked when the
 * bus GPS shows the bus leaving the student's saved stop, and asked again
 * every 10 minutes until the student answers. "Later" only hides it until the
 * next reminder.
 */
export default function BoardingCheck() {
  const { token, user } = useSession();
  const [checks, setChecks] = useState([]);
  const [snoozed, setSnoozed] = useState(() => new Map()); // checkId -> hidden until (ms)
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const student = user?.role === 'student';

  const loadPending = useCallback(async () => {
    if (!token || !student) return;
    try {
      setChecks(await api('/api/boarding-checks/pending', { token }));
    } catch {
      // Not critical: the next reminder or reload brings it.
    }
  }, [token, student]);

  useEffect(() => {
    if (!token || !student) return undefined;
    loadPending();
    const socket = getSocket(token);
    const onCheck = (c) => {
      setChecks((list) => [c, ...list.filter((x) => x.checkId !== c.checkId)]);
      setSnoozed((m) => { const next = new Map(m); next.delete(c.checkId); return next; });
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          // One notification per question: a reminder replaces the last one.
          new Notification(`${c.reminder ? 'Reminder: did' : 'Did'} you board ${busName(c.fleetCode)}?`, {
            body: `${c.stopName ? `${c.stopName} · ` : ''}Route ${c.routeCode} · tap to answer`,
            tag: `boarding-${c.checkId}`,
            renotify: true,
          });
        }
      } catch {
        // Notifications unsupported: the popup is enough.
      }
    };
    const onClosed = ({ checkId }) => setChecks((list) => list.filter((x) => x.checkId !== checkId));
    const onVisible = () => document.visibilityState === 'visible' && loadPending();
    socket.on('boarding:check', onCheck);
    socket.on('boarding:closed', onClosed);
    socket.on('connect', loadPending);
    document.addEventListener('visibilitychange', onVisible);
    // A tab whose socket dropped still brings the question back when it is due.
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
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [token, student, loadPending]);

  const check = checks.find((c) => !snoozed.has(c.checkId));
  if (!check) return null;

  const answer = async (a) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/boarding-checks/${check.checkId}/answer`, { token, body: { answer: a } });
      setChecks((list) => list.filter((x) => x.checkId !== check.checkId));
      window.dispatchEvent(new CustomEvent('ubts:attendance-changed'));
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
    <Modal title={null} onClose={later} width={400}>
      <div className="prompt boarding-check">
        {check.reminders > 0 && <span className="badge delayed">Reminder {check.reminders}</span>}
        <p className="prompt-q">Did you board {busName(check.fleetCode)}?</p>
        <p className="muted">
          Route {check.routeCode} · {check.routeName}
          <br />
          The bus left {check.stopName ?? 'your stop'} at {time(check.departedAt)}
          {check.tripRunning ? '' : ' · trip finished'}
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="prompt-actions">
          <button className="btn ghost big" disabled={busy} onClick={() => answer('NO')}>No, I didn't</button>
          <button className="btn primary big" disabled={busy} onClick={() => answer('YES')}>Yes, I'm on it</button>
        </div>
        <button className="link boarding-later" disabled={busy} onClick={later}>
          <Icon name="clock" size={14} /> Ask me again in {check.remindEveryMinutes} minutes
        </button>
        <p className="hint">Based on your bus's GPS. We remind you every {check.remindEveryMinutes} minutes until you answer; "Yes" marks your attendance for this trip.</p>
      </div>
    </Modal>
  );
}
