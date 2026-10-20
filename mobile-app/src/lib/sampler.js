// The student phone's side of automatic attendance (doc 9.2, 9.10), as in the
// web app's lib/sampler.js.
//
// Samples location only when the server's plan says so: consent given,
// subscribed, device bound, and inside the student's travel window. One fix
// every 20 s, sent to the server, never stored on the phone or the server.
//
// Two sources: this phone's GPS, or - for demonstrations without a real bus -
// "ride along", which follows a live bus's reported position.
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { api } from './api.js';
import { ATTENDANCE_CHANGED, emit } from './events.js';
import { getJSON, setJSON } from './storage.js';

const DEVICE_KEY = 'ubts.deviceId';
const PLATFORM = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
let cachedId = null;

export async function deviceId() {
  if (cachedId) return cachedId;
  let id = await getJSON(DEVICE_KEY);
  if (!id) {
    id = `${Platform.OS}-${Crypto.randomUUID()}`;
    await setJSON(DEVICE_KEY, id);
  }
  cachedId = id;
  return id;
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
let watch = null;
let watchStarting = false;
let gpsFix = null;

export async function refreshPlan() {
  if (!token) return;
  try {
    let plan = await api('/api/attendance/plan', { token });
    const id = await deviceId();
    // First phone binds on its own; a different phone needs the one-time code.
    if (plan.consent && plan.subscribed && plan.deviceId !== id) {
      try {
        await api('/api/devices/bind', { token, body: { deviceId: id, platform: PLATFORM } });
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
  await api('/api/devices/bind', { token, body: { deviceId: await deviceId(), platform: PLATFORM, otp } });
  set({ otp: null });
  await refreshPlan();
}

export function setSource(source, rideBusId = null) {
  set({ source, rideBusId });
  applyPlan();
}

function stopGps() {
  watch?.remove();
  watch = null;
  gpsFix = null;
}

async function startGps() {
  if (watch || watchStarting) return;
  watchStarting = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      set({ error: 'Location: permission denied. Allow location for this app, or use the bus QR code.' });
      return;
    }
    // Balanced accuracy, not continuous high-accuracy GPS (battery, doc 9.10).
    watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 0 },
      (p) => {
        gpsFix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: p.coords.accuracy == null ? undefined : Math.round(p.coords.accuracy),
          speedKmh: p.coords.speed == null || p.coords.speed < 0 ? undefined : p.coords.speed * 3.6,
          heading: p.coords.heading == null || p.coords.heading < 0 || Number.isNaN(p.coords.heading) ? undefined : p.coords.heading,
          recordedAt: new Date(p.timestamp).toISOString(),
          // Android reports test-provider ("fake GPS") fixes; the server flags them (doc 9.8).
          mockLocation: p.mocked === true,
        };
      },
      (reason) => set({ error: `Location: ${reason}` }),
    );
    if (!shouldRun() || state.source !== 'gps') stopGps();
  } catch (err) {
    set({ error: `Location: ${err.message}` });
  } finally {
    watchStarting = false;
  }
}

const shouldRun = () => Boolean(state.plan?.shouldSample) && (state.source === 'gps' || state.rideBusId);

function applyPlan() {
  const on = shouldRun();
  if (on && state.source === 'gps') startGps();
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
    fix = { ...gpsFix };
    if (!fix.mockLocation) delete fix.mockLocation;
  }
  if (!fix) return;
  set({ sending: true });
  try {
    const last = await api('/api/attendance/device-location', { token, body: { deviceId: await deviceId(), ...fix } });
    set({ last: { ...last, at: new Date().toISOString() }, error: null });
    if (last.alighted || last.status) emit(ATTENDANCE_CHANGED);
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
