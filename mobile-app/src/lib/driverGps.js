// The driver's phone GPS, kept running while the phone is locked or another app
// is open. Android shows a "Trip running" notification and keeps a foreground
// service alive; each position is saved first and then sent, so a dead zone or a
// restart of the app loses nothing.
//
// This needs an installed build: Expo Go on Android cannot run a background
// location task, so there the driver screen falls back to foreground GPS.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';
import { apiBase } from '../config.js';

export const DRIVER_GPS_TASK = 'crescent-driver-gps';
const QUEUE_KEY = 'ubts.driverGps.queue';
const SECRET_KEY = 'ubts.driverGps.credentials';
const MAX_QUEUE = 720; // an hour at one position every 5 seconds
const MAX_BATCH = 60;
const TIMEOUT_MS = 15000;

const listeners = new Set();
let queue = null;
let credentials = null;
let sending = false;
let lastSentAt = 0;

const emit = (event) => listeners.forEach((fn) => fn(event));

/** The screen listens for positions, results, and the trip being over. */
export function subscribeDriverGps(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Expo Go and the browser preview cannot run the background task. */
export const backgroundAvailable = () => Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient';

const toFix = (p) => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  accuracyM: p.coords.accuracy == null ? undefined : Math.round(p.coords.accuracy),
  speedKmh: p.coords.speed == null || p.coords.speed < 0 ? undefined : Math.round(p.coords.speed * 3.6 * 10) / 10,
  heading: p.coords.heading == null || p.coords.heading < 0 || Number.isNaN(p.coords.heading) ? undefined : Math.round(p.coords.heading),
  recordedAt: new Date(p.timestamp).toISOString(),
});

async function loadQueue() {
  if (queue) return queue;
  try {
    queue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY)) ?? [];
  } catch {
    queue = [];
  }
  return queue;
}

const saveQueue = () => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});

async function loadCredentials() {
  if (credentials) return credentials;
  try {
    credentials = JSON.parse(await SecureStore.getItemAsync(SECRET_KEY));
  } catch {
    credentials = null;
  }
  return credentials;
}

/** Send what is waiting, no more often than the driver's chosen interval. */
async function flush({ force = false } = {}) {
  const who = await loadCredentials();
  await loadQueue();
  if (!who || sending || !queue.length) return;
  if (!force && Date.now() - lastSentAt < who.intervalMs - 500) return;
  sending = true;
  lastSentAt = Date.now();
  const batch = queue.slice(0, MAX_BATCH);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${who.base}/api/driver/locations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` },
      body: JSON.stringify({ fixes: batch }),
      signal: abort.signal,
    });
    const data = await res.json().catch(() => ({}));
    // The server answered, so these positions are dealt with, whatever it said.
    queue = queue.slice(batch.length);
    await saveQueue();
    if (res.status === 401 || res.status === 403 || res.status === 409) {
      emit({ type: 'ended', status: res.status, message: data.error });
      await stopDriverGps({ flushFirst: false });
      return;
    }
    emit({ type: 'result', fixes: batch, result: data, buffered: queue.length, failed: !res.ok && res.status !== 422 ? (data.error ?? `HTTP ${res.status}`) : null });
  } catch {
    // No connection: the positions stay queued for the next attempt.
    emit({ type: 'offline', buffered: queue.length });
  } finally {
    clearTimeout(timer);
    sending = false;
  }
}

/** Runs for each batch of positions from Android, with the app on screen or not. */
async function onLocations({ data, error }) {
  if (error || !data?.locations?.length) return;
  await loadQueue();
  const fixes = data.locations.map(toFix);
  queue = [...queue, ...fixes].slice(-MAX_QUEUE);
  await saveQueue();
  emit({ type: 'fix', fix: fixes.at(-1) });
  await flush();
}

// The task must be defined when this file loads, before anything renders:
// Android can restart the app in the background just to deliver positions.
if (Platform.OS !== 'web') {
  // eslint-disable-next-line global-require
  const TaskManager = require('expo-task-manager');
  if (!TaskManager.isTaskDefined(DRIVER_GPS_TASK)) TaskManager.defineTask(DRIVER_GPS_TASK, onLocations);
}

export async function driverGpsRunning() {
  if (!backgroundAvailable()) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(DRIVER_GPS_TASK);
  } catch {
    return false;
  }
}

/**
 * Start sharing. Returns { ok: true }, or { ok: false, reason } where reason is
 * 'denied' (no location at all) or 'background' ("Allow all the time" is missing).
 */
export async function startDriverGps({ token, intervalS }) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return { ok: false, reason: 'denied' };
  if (!backgroundAvailable()) return { ok: false, reason: 'unavailable' };
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') return { ok: false, reason: 'background' };

  const intervalMs = intervalS * 1000;
  credentials = { token, base: apiBase(), intervalMs };
  await SecureStore.setItemAsync(SECRET_KEY, JSON.stringify(credentials), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  await Location.startLocationUpdatesAsync(DRIVER_GPS_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: intervalMs,
    distanceInterval: 0,
    deferredUpdatesInterval: intervalMs,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Trip running',
      notificationBody: 'Sharing the bus location with students. Tap to open.',
      notificationColor: '#1c315e',
      killServiceOnDestroy: false,
    },
  });
  return { ok: true };
}

/** The trip is over: send what is left, then stop. */
export async function stopDriverGps({ flushFirst = true } = {}) {
  if (flushFirst) await flush({ force: true }).catch(() => {});
  try {
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_GPS_TASK)) await Location.stopLocationUpdatesAsync(DRIVER_GPS_TASK);
  } catch {
    // Already stopped.
  }
  queue = [];
  credentials = null;
  await AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => {});
}

export const openLocationSettings = () => Linking.openSettings();

/** Phone makers' battery savers are what most often kill a background app. */
export const openBatterySettings = () => (Platform.OS === 'android'
  ? Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings())
  : Linking.openSettings());
