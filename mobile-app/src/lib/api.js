import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import { apiBase, socketBase, viaDevServer } from '../config.js';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Same contract as the web app's api(): JSON in, JSON out, Bearer token. */
// A blocked or unreachable server can leave a phone's request hanging for
// minutes; give up after this long so screens show a message instead.
const TIMEOUT_MS = 20000;

export async function api(path, { token, body, method, headers = {} } = {}) {
  let res;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    // No HTTP answer at all: the caller may queue and retry (TypeError like the browser).
    const where = apiBase() || 'the dev server';
    const e = new TypeError(abort.signal.aborted
      ? `The server at ${where} did not answer. Check that the backend is running and the phone can reach it.`
      : `Cannot reach the server at ${where}. Check the connection.`);
    e.cause = err;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  // 422 = every fix in the batch was rejected; the body explains why.
  if (!res.ok && res.status !== 422) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  return data;
}

/** Plain-text GET from an authenticated endpoint (e.g. the test gateway's settlement CSV). */
export async function apiText(path, token) {
  const res = await fetch(`${apiBase()}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  }
  return res.text();
}

const MIME = { pdf: 'application/pdf', csv: 'text/csv' };

/**
 * Download a file from an authenticated endpoint (CSV exports, PDF receipts)
 * and open the system share sheet, the phone's equivalent of the browser's download.
 */
export async function download(path, token, name) {
  const file = new File(Paths.cache, name.replace(/[^\w.\-]/g, '_'));
  try {
    await File.downloadFileAsync(`${apiBase()}${path}`, file, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      idempotent: true,
    });
  } catch {
    // Ask again for the JSON error so the screen can show the server's reason.
    const res = await fetch(`${apiBase()}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    throw new ApiError(res?.status ?? 0, data.error ?? 'Download failed. Check the connection.', data);
  }
  const ext = name.split('.').pop().toLowerCase();
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: MIME[ext], dialogTitle: name, UTI: ext === 'pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text' });
  } else {
    throw new Error(`Saved to ${file.uri}`);
  }
}

/**
 * Let the user pick a PDF or a photo of a document and return it for the
 * server to read: { data (base64), mimeType, name }, or null if cancelled.
 */
export async function pickDocumentFile() {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const mimeType = asset.mimeType ?? (asset.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  let data;
  if (Platform.OS === 'web' && asset.file) {
    // The browser hands over a File: read it as base64 there.
    data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(new Error('That file could not be read'));
      reader.readAsDataURL(asset.file);
    });
  } else {
    data = await new File(asset.uri).base64();
  }
  if (data.length > 11_000_000) throw new Error('That file is larger than 8 MB. Use a smaller photo or PDF.');
  return { data, mimeType, name: asset.name ?? 'document' };
}

/** Let the user pick a CSV file and return its text, or null if cancelled. */
export async function pickTextFile() {
  const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  return new File(result.assets[0].uri).text();
}

/**
 * One Socket.IO connection per signed-in user, as on the web. The token
 * identifies the user to the server, which decides what live data it may receive.
 */
let socket;
let socketKey;
export function getSocket(token = null) {
  const key = `${socketBase()}|${token ?? ''}`;
  if (!socket || socketKey !== key) {
    socket?.close();
    socketKey = key;
    // Through the tunnel the dev server forwards plain HTTP only, so use long-polling there.
    const transports = viaDevServer() && Platform.OS !== 'web' ? ['polling'] : ['websocket'];
    socket = io(socketBase(), { transports, auth: token ? { token } : {} });
  }
  return socket;
}

export function closeSocket() {
  socket?.close();
  socket = null;
  socketKey = null;
}
