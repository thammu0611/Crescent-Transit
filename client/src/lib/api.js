import { io } from 'socket.io-client';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { token, body, method, headers = {} } = {}) {
  const res = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // 422 = every fix in the batch was rejected; the body explains why.
  if (!res.ok && res.status !== 422) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  return data;
}

/** Download a file from an authenticated endpoint (CSV exports, PDF receipts). */
export async function download(path, token, fallbackName) {
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One Socket.IO connection per signed-in user. The token identifies the user
 * to the server, which decides what live data the socket may receive.
 */
let socket;
let socketToken;
export function getSocket(token = null) {
  if (!socket || socketToken !== token) {
    socket?.close();
    socketToken = token;
    socket = io({ transports: ['websocket', 'polling'], auth: token ? { token } : {} });
  }
  return socket;
}
