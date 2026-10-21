import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api.js';

// Notifications, two kinds:
//  - push: the server sends route alerts, the boarding question and SOS reports
//    through Expo's push service (server/push.js), so they arrive when the app
//    is closed or in the background. The phone registers its Expo push token
//    after sign-in and removes it on sign-out.
//  - local: events that arrive over the open app's socket (the web app uses
//    the browser Notification API for the same thing).
//
// Expo Go on Android no longer includes expo-notifications (SDK 53+): even
// loading the module there throws. So it is loaded on demand, and skipped in
// Expo Go on Android and in the browser preview; the in-app sheets and lists
// still work everywhere. A development or store build gets notifications.
export const notificationsAvailable = Platform.OS !== 'web' && !(Platform.OS === 'android' && isRunningInExpoGo());

let Notifications = null;
let channelReady = Promise.resolve();
function load() {
  if (!notificationsAvailable) return null;
  if (!Notifications) {
    Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async (n) => {
        // With the app open, the boarding questions already show as in-app
        // sheets: a push or reminder copy would only repeat them.
        const type = n.request.content.data?.type;
        const quiet = (n.request.trigger?.type === 'push' && type === 'attendance:prompt') || type === 'boarding:check';
        return { shouldShowBanner: !quiet, shouldShowList: true, shouldPlaySound: !quiet, shouldSetBadge: false };
      },
    });
    if (Platform.OS === 'android') {
      // The server sends to this channel (channelId 'alerts'); high importance pops a banner.
      // Android 13+ only shows the permission dialog once a channel exists.
      channelReady = Notifications.setNotificationChannelAsync('alerts', {
        name: 'Bus alerts and boarding',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 120, 60, 120],
      }).catch(() => {});
    }
  }
  return Notifications;
}

const UNAVAILABLE = Platform.OS === 'web'
  ? 'Notifications are not available in the browser preview.'
  : 'Expo Go on Android cannot receive notifications. Install a development or store build of the app.';

/** The EAS project the push token belongs to (written to app.json by `eas init`). */
const projectId = () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

// The token this phone registered, and the session that registered it.
let registered = null;

/**
 * Turn on push notifications for the signed-in account: ask permission (when
 * `ask`), get this phone's Expo push token, and send it to the server.
 * Returns { ok, reason } for the settings screen.
 */
export async function registerForPush(authToken, { ask = true } = {}) {
  const N = load();
  if (!N) return { ok: false, reason: UNAVAILABLE };
  try {
    await channelReady;
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted' && ask) ({ status } = await N.requestPermissionsAsync());
    if (status !== 'granted') return { ok: false, reason: 'Notifications are turned off for this app. Allow them in the phone\'s settings.' };
    const id = projectId();
    if (!id) return { ok: false, reason: 'Push needs the app\'s EAS project ID: run "eas init" in mobile-app, then rebuild.' };
    const { data: token } = await N.getExpoPushTokenAsync({ projectId: id });
    await api('/api/push/register', { token: authToken, body: { token, platform: Platform.OS } });
    registered = { token, authToken };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not set up push notifications: ${err.message}` };
  }
}

/** Does the server reach this phone by push (and so send the reminders itself)? */
export const pushRegistered = () => Boolean(registered);

/**
 * A reminder the phone repeats by itself every `minutes` until cancelled, for
 * when the server cannot push to this phone. Same identifier = replaced, not doubled.
 */
export async function scheduleRepeatingReminder(id, { title, body, minutes, data = {} }) {
  try {
    const N = load();
    if (!N) return;
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;
    await N.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(60, minutes * 60), repeats: true, ...(Platform.OS === 'android' ? { channelId: 'alerts' } : {}) },
    });
  } catch {
    // Notifications unavailable: the in-app sheet comes back when the app opens.
  }
}

/** Cancel this phone's own reminders whose id starts with `prefix`, except `keep`. */
export async function cancelReminders(prefix, keep = []) {
  try {
    const N = load();
    if (!N) return;
    for (const n of await N.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith(prefix) && !keep.includes(n.identifier)) await N.cancelScheduledNotificationAsync(n.identifier);
    }
  } catch {
    // Nothing scheduled.
  }
}

export async function cancelReminder(id) {
  try {
    await load()?.cancelScheduledNotificationAsync(id);
  } catch {
    // Nothing scheduled.
  }
}

/** Sign-out: stop this phone receiving the account's notifications. */
export async function unregisterFromPush() {
  const r = registered;
  registered = null;
  if (!r) return;
  try {
    await api('/api/push/unregister', { token: r.authToken, body: { token: r.token } });
  } catch {
    // Offline: the server drops the token when it moves to another account or the app is removed.
  }
}

let lastOpened = null;
/**
 * Call onOpen(data) when the user taps a notification, including the one that
 * started the app from closed. Each tap is reported once. Returns a cleanup.
 */
export function onNotificationOpened(onOpen) {
  const N = load();
  if (!N) return () => {};
  const handle = (response) => {
    const id = response?.notification?.request?.identifier;
    if (!id || id === lastOpened) return;
    lastOpened = id;
    onOpen(response.notification.request.content.data ?? {});
  };
  N.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = N.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

/** Older entry point (settings screen): permission only. */
export async function requestNotificationPermission() {
  const N = load();
  if (!N) return UNAVAILABLE;
  await channelReady;
  const { status } = await N.requestPermissionsAsync();
  return status;
}

export async function showNotification(title, body) {
  try {
    const N = load();
    if (!N) return;
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;
    await N.scheduleNotificationAsync({
      content: { title, body },
      trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
    });
  } catch {
    // Notifications unavailable: the in-app sheet is enough.
  }
}
