// Measures the Module 1 pipeline end to end on a running server:
// time from the driver POSTing a fix until a subscribed client receives it
// over Socket.IO (validate + 2 SQL writes + broadcast included).
//
//   npm run measure -- --count 100
import { io } from 'socket.io-client';
import { PathWalker } from '../shared/geo.js';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const SERVER = arg('server', `http://localhost:${process.env.PORT ?? 4000}`);
const COUNT = Number(arg('count', 100));
const ROUTE = arg('route', '125');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';

async function api(path, { token, body, method } = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const { token } = await api('/api/auth/login', { body: { username: `drv${ROUTE.toLowerCase()}`, password: PASSWORD } });
const route = await api(`/api/routes/${ROUTE}`);
const walker = new PathWalker(route.stops);
let { trip, resumed } = await api('/api/driver/trips', { token, method: 'POST' });
if (resumed) {
  await api(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
  ({ trip } = await api('/api/driver/trips', { token, method: 'POST' }));
}

// Live positions are for signed-in staff and subscribers: watch as the administrator.
const admin = await api('/api/auth/login', { body: { username: 'admin', password: PASSWORD } });
const socket = io(SERVER, { transports: ['websocket'], auth: { token: admin.token } });
await new Promise((resolve) => socket.on('connect', resolve));
socket.emit('subscribe', { route: ROUTE });
await new Promise((resolve) => socket.once('snapshot', resolve));

const endToEnd = [];
const httpOnly = [];
for (let i = 0; i < COUNT; i++) {
  const p = walker.at(i * 8); // ~8 m per step, sent 0.3 s apart
  const recordedAt = new Date().toISOString();
  const received = new Promise((resolve) => {
    const handler = (b) => {
      if (b.recordedAt === recordedAt) {
        socket.off('bus:location', handler);
        resolve(performance.now());
      }
    };
    socket.on('bus:location', handler);
  });
  const t0 = performance.now();
  await api('/api/driver/locations', { token, body: { lat: p.lat, lng: p.lng, speedKmh: 30, recordedAt } });
  httpOnly.push(performance.now() - t0);
  endToEnd.push((await received) - t0);
  await new Promise((resolve) => setTimeout(resolve, 300));
}
await api(`/api/driver/trips/${trip.id}/end`, { token, method: 'POST' });
socket.close();

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `median ${q(0.5).toFixed(1)} ms · p95 ${q(0.95).toFixed(1)} ms · max ${s.at(-1).toFixed(1)} ms`;
};
console.log(`Fixes measured      : ${COUNT} on route ${ROUTE}`);
console.log(`HTTP POST response  : ${stats(httpOnly)}`);
console.log(`POST -> map client  : ${stats(endToEnd)}`);
process.exit(0);
