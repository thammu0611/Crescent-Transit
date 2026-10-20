import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Where the existing Node.js backend runs. The mobile app uses the very same
// REST API and Socket.IO server as the web app - nothing is duplicated.
//
// Order: a server address saved on the sign-in screen, then EXPO_PUBLIC_API_URL,
// then the computer running `expo start`:
//   - same Wi-Fi (`expo start`): straight to the backend on its own port;
//   - tunnel (`expo start --tunnel`): through the Expo dev server, which
//     forwards /api and /socket.io to the backend (metro.config.js), so the
//     phone needs no direct route to the computer.
const PORT = 4000;
const KEY = 'ubts.serverUrl';
let saved = null;

const clean = (url) => String(url ?? '').trim().replace(/\/+$/, '');

function guess() {
  const env = clean(process.env.EXPO_PUBLIC_API_URL);
  if (env) return env;
  // Browser preview: same origin, forwarded to the backend by metro.config.js.
  if (Platform.OS === 'web') return '';
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? '';
  const host = hostUri.split(':')[0];
  if (!host) return `http://localhost:${PORT}`;
  return isTunnelHost(host) ? `http://${hostUri.split('/')[0]}` : `http://${host}:${PORT}`;
}

/** A dev-server host that is a public name (Expo tunnel), not this network's IP or localhost. */
function isTunnelHost(host) {
  return host !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.endsWith('.local');
}

/** True when the app itself was loaded through an Expo tunnel. */
function loadedViaTunnel() {
  if (Platform.OS === 'web') return false;
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? '';
  const host = hostUri.split(':')[0];
  return Boolean(host) && isTunnelHost(host);
}

/** True when API calls go through the dev server's forwarder (tunnel or browser preview). */
export const viaDevServer = () => {
  if (clean(process.env.EXPO_PUBLIC_API_URL)) return false;
  if (Platform.OS === 'web') return !saved;
  // Through a tunnel the phone can reach only the dev server, so a saved
  // address (usually an old Wi-Fi IP) is ignored there.
  return loadedViaTunnel();
};

/** An installed APK/IPA (not Expo Go or a dev build): no dev server to find the backend through. */
export const isInstalledBuild = () =>
  Platform.OS !== 'web' && !clean(process.env.EXPO_PUBLIC_API_URL) && !(Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost);

export const apiBase = () => (viaDevServer() ? guess() : saved ?? guess());
/** Socket.IO allows any origin, so the browser preview connects to the backend directly. */
export const socketBase = () => apiBase() || `http://localhost:${PORT}`;
export const defaultApiBase = guess;
export const hasSavedServer = () => saved != null;

export async function loadServerUrl() {
  try {
    saved = clean(await AsyncStorage.getItem(KEY)) || null;
  } catch {
    saved = null;
  }
}

/** Save a server address ("" goes back to the automatic one). */
export async function setServerUrl(url) {
  const next = clean(url);
  if (next && !/^https?:\/\/[^\s/]+/.test(next)) throw new Error('Server address looks like http://192.168.1.20:4000');
  saved = next || null;
  try {
    if (saved) await AsyncStorage.setItem(KEY, saved);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // Kept for this session only.
  }
}
