import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { api, getSocket } from '../lib/api.js';
import { ATTENDANCE_CHANGED, emit } from '../lib/events.js';
import { time } from '../lib/format.js';
import { showNotification } from '../lib/notify.js';
import { useSession } from '../lib/session.js';
import { C, F } from '../theme.js';
import { Button, ErrorText, Sheet, Text, Txt } from './ui.js';

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
      showNotification(`Are you on ${p.fleetCode}?`, `${p.routeName} · boarded around ${time(p.boardedAt)}`);
    };
    socket.on('attendance:prompt', onPrompt);
    socket.on('connect', loadPending);
    // Back from the background (e.g. the boarding notification was tapped): the
    // socket may have stayed connected, so look for a waiting question here too.
    const appState = AppState.addEventListener('change', (s) => s === 'active' && loadPending());
    return () => {
      socket.off('attendance:prompt', onPrompt);
      socket.off('connect', loadPending);
      appState.remove();
    };
  }, [token, user?.role, loadPending]);

  if (!prompt) return null;

  const answer = async (a) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/attendance/${prompt.attendanceId}/confirm`, { token, body: { answer: a } });
      setPrompt(null);
      emit(ATTENDANCE_CHANGED);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) setTimeout(() => setPrompt(null), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={() => setPrompt(null)}>
      <View style={{ gap: 10, paddingBottom: 4 }}>
        <Text style={{ fontSize: 22, ...F.display, color: C.ink, textAlign: 'center' }}>
          Are you on {prompt.fleetCode.replace('BSACIST-', 'Bus ')} — {prompt.routeName}?
        </Text>
        <Txt muted style={{ textAlign: 'center' }}>Boarded around {time(prompt.boardedAt)}{prompt.stopName ? ` at ${prompt.stopName}` : ''}</Txt>
        <ErrorText>{error}</ErrorText>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="No" variant="ghost" disabled={busy} onPress={() => answer('NO')} style={{ flex: 1, minHeight: 60 }} />
          <Button title="Yes" variant="primary" disabled={busy} onPress={() => answer('YES')} style={{ flex: 1, minHeight: 60 }} />
        </View>
        <Txt muted small style={{ textAlign: 'center' }}>Your location is compared with the bus and then discarded. Only this answer is kept.</Txt>
      </View>
    </Sheet>
  );
}
