// In-app events (the web app uses window CustomEvents for these).
const listeners = new Map();

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

export function emit(name, payload) {
  for (const fn of listeners.get(name) ?? []) fn(payload);
}

export const ATTENDANCE_CHANGED = 'ubts:attendance-changed';
