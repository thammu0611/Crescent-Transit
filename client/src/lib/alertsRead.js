import { useEffect, useSyncExternalStore } from 'react';
import { markedLocally } from '../../../shared/alerts.js';
import { api } from './api.js';

// Which notifications are read, kept on the server and shared by every screen
// here: the bell's count drops the moment something is marked read.
let state = null;
let loadedFor = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };

export function reloadAlertsRead(token) {
  loadedFor = token;
  return api('/api/me/alerts-read', { token })
    .then((v) => { if (loadedFor === token) { state = v; emit(); } })
    .catch(() => { if (loadedFor === token) loadedFor = null; });
}

/** { readAt, readIds }, or null while it loads. */
export function useAlertsRead(token) {
  const read = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!token) { state = null; loadedFor = null; return; }
    if (loadedFor !== token) reloadAlertsRead(token);
  }, [token]);
  return read;
}

/** Mark everything ({ all: true }) or some notifications ({ ids }) read. */
export async function markAlertsRead(token, body) {
  const before = state;
  state = markedLocally(state, body);
  emit();
  try {
    state = await api('/api/me/alerts-read', { token, method: 'PUT', body });
    emit();
  } catch (err) {
    state = before;
    emit();
    throw err;
  }
}
