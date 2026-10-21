// The student phone's side of automatic attendance (doc 9.2, 9.10).
//
// Samples location only when the server's plan says so: consent given,
// subscribed, device bound, and inside the student's travel window. One fix
// every 20 s, sent to the server, never stored on the phone or the server.
//
// Two sources: this device's GPS, or - for demonstrations without a real bus -
// "ride along", which follows a live bus's reported position.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';

const DEVICE_KEY = 'ubts.deviceId';

export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // No storage: a per-tab id; binding will ask for a code on the next visit.
    window.__ubtsDeviceId ??= `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return window.__ubtsDeviceId;
  }
}

let state = { plan: null, source: 'gps', rideBusId: null, last: null, error: null, otp: null, sending: false };
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const useSampler = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);

let token = null;
let loop = null;
let planTimer = null;
let watchId = null;
let gpsFix = null;

export async function refreshPlan() {
  if (!token) return;
  try {
    let plan = await api('/api/attendance/plan', { token });
    // First phone binds on its own; a different phone needs the one-time code.
    if (plan.consent && plan.subscribed && plan.deviceId !== deviceId()) {
      try {
        await api('/api/devices/bind', { token, body: { deviceId: deviceId(), platform: 'WEB' } });
        plan = await api('/api/attendance/plan', { token });
        set({ otp: null });
      } catch (err) {
        if (err.body?.code === 'OTP_REQUIRED') set({ otp: { devOtp: err.body.devOtp ?? null } });
      }
    }
    set({ plan, error: null });
    applyPlan();
  } catch (err) {
    set({ error: err.message });
  }
}

export async function submitOtp(otp) {
  await api('/api/devices/bind', { token, body: { deviceId: deviceId(), platform: 'WEB', otp } });
  set({ otp: null });
  await refreshPlan();
}

export function setSource(source, rideBusId = null) {
  set({ source, rideBusId });
  applyPlan();
}

function stopGps() {
  if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
  watchId = null;
  gpsFix = null;
}

function applyPlan() {
  const on = Boolean(state.plan?.shouldSample) && (state.source === 'gps' || state.rideBusId);
  if (on && state.source === 'gps' && watchId === null && 'geolocation' in navigator) {
    // Balanced accuracy, not continuous high-accuracy GPS (battery, doc 9.10).
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        gpsFix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
          speedKmh: p.coords.speed == null ? undefined : p.coords.speed * 3.6,
          heading: p.coords.heading == null || Number.isNaN(p.coords.heading) ? undefined : p.coords.heading,
          recordedAt: new Date(p.timestamp).toISOString(),
        };
      },
      (err) => set({ error: `Location: ${err.message}` }),
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 },
    );
  }
  if (!on || state.source !== 'gps') stopGps();
  clearInterval(loop);
  loop = null;
  if (on) {
    loop = setInterval(tick, (state.plan.intervalS ?? 20) * 1000);
    tick();
  }
}

async function tick() {
  if (state.sending) return;
  let fix = null;
  if (state.source === 'ride' && state.rideBusId) {
    try {
      const bus = await api(`/api/buses/${state.rideBusId}/location`, { token });
      // A seat a few metres from the tracker, same speed and direction.
      fix = {
        lat: bus.lat + (Math.random() - 0.5) * 0.00008,
        lng: bus.lng + (Math.random() - 0.5) * 0.00008,
        speedKmh: bus.speedKmh ?? undefined,
        heading: bus.heading ?? undefined,
        accuracyM: 12,
        recordedAt: new Date().toISOString(),
      };
    } catch (err) {
      set({ error: `Ride along: ${err.message}` });
      return;
    }
  } else if (gpsFix) {
    fix = { ...gpsFix, recordedAt: gpsFix.recordedAt };
  }
  if (!fix) return;
  set({ sending: true });
  try {
    const last = await api('/api/attendance/device-location', { token, body: { deviceId: deviceId(), ...fix } });
    set({ last: { ...last, at: new Date().toISOString() }, error: null });
    if (last.alighted || last.status) window.dispatchEvent(new CustomEvent('ubts:attendance-changed'));
  } catch (err) {
    set({ error: err.message });
    if (err.status === 409 || err.status === 402) refreshPlan();
  } finally {
    set({ sending: false });
  }
}

/** Start or stop the sampler for the signed-in student. */
export function startSampler(newToken) {
  stopSampler();
  token = newToken;
  if (!token) return;
  refreshPlan();
  planTimer = setInterval(refreshPlan, 5 * 60000);
}

export function stopSampler() {
  clearInterval(loop);
  clearInterval(planTimer);
  loop = null;
  planTimer = null;
  stopGps();
  token = null;
  set({ plan: null, last: null, error: null, otp: null });
}
