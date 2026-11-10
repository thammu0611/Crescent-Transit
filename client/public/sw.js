// Keeps the app usable where the signal drops: the app itself, route and stop
// data, and the map tiles a student has already seen. Nothing from a signed-in
// request is stored, so a shared phone keeps no one's records, and live bus
// positions always come from the network.
const APP = 'ct-app-v1';
const TILES = 'ct-tiles-v1';
const MAX_TILES = 400;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (![APP, TILES].includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

const isPublicRouteData = (url) => url.pathname === '/api/routes' || /^\/api\/routes\/[^/]+$/.test(url.pathname);

async function networkFirst(request) {
  const cache = await caches.open(APP);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const saved = await cache.match(request);
    if (saved) return saved;
    throw err;
  }
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    if (name === TILES) {
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(old);
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(request, TILES));
  } else if (url.origin !== self.location.origin) {
    // Fonts and anything else elsewhere: leave to the browser.
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, APP));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (isPublicRouteData(url) && !request.headers.has('authorization')) {
    event.respondWith(networkFirst(request));
  }
});
