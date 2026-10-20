import { useCallback, useEffect, useState } from 'react';
import { api, getSocket } from '../lib/api.js';
import { time } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { ErrorText, Modal } from './ui.jsx';

/**
 * The one-tap boarding question (doc 9.4): "Are you on Bus 14 — Velachery?"
 * Arrives over the socket, or is waiting in the app for up to 30 minutes if
 * the phone was not listening. At most one per trip.
 */
export default function AttendancePrompt() {
  const { token, user } = useSession();
  const [prompt, setPrompt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadPending = useCallback(async () => {
    if (!token || user?.role !== 'student') return;
    try {
      const list = await api('/api/attendance/pending', { token });
      setPrompt((p) => p ?? list[0] ?? null);
    } catch {
      // Not critical: the next socket event or reload will bring it.
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (!token || user?.role !== 'student') return undefined;
    loadPending();
    const socket = getSocket(token);
    const onPrompt = (p) => {
      setPrompt(p);
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`Are you on ${p.fleetCode}?`, { body: `${p.routeName} · boarded around ${time(p.boardedAt)}` });
        }
      } catch {
        // Notifications unsupported: the modal is enough.
      }
    };
    socket.on('attendance:prompt', onPrompt);
    return () => socket.off('attendance:prompt', onPrompt);
  }, [token, user?.role, loadPending]);

  if (!prompt) return null;

  const answer = async (a) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/attendance/${prompt.attendanceId}/confirm`, { token, body: { answer: a } });
      setPrompt(null);
      window.dispatchEvent(new CustomEvent('ubts:attendance-changed'));
    } catch (err) {
      setError(err.message);
      if (err.status === 409) setTimeout(() => setPrompt(null), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={null} onClose={() => setPrompt(null)} width={380}>
      <div className="prompt">
        <p className="prompt-q">Are you on {prompt.fleetCode.replace('BSACIST-', 'Bus ')} — {prompt.routeName}?</p>
        <p className="muted">Boarded around {time(prompt.boardedAt)}{prompt.stopName ? ` at ${prompt.stopName}` : ''}</p>
        <ErrorText>{error}</ErrorText>
        <div className="prompt-actions">
          <button className="btn ghost big" disabled={busy} onClick={() => answer('NO')}>No</button>
          <button className="btn primary big" disabled={busy} onClick={() => answer('YES')}>Yes</button>
        </div>
        <p className="hint">Your location is compared with the bus and then discarded. Only this answer is kept.</p>
      </div>
    </Modal>
  );
}
