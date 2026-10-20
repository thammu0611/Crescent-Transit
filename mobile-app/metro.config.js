// The mobile app imports the project's shared business rules (ETA, freshness,
// geometry) from ../shared - the same files the server and the web app use -
// so arrival estimates and Live/Delayed/Offline states agree everywhere.
// Nothing else outside this folder is read.
const http = require('http');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')];

// Forward /api and /socket.io to the backend on port 4000, as the web app's
// Vite proxy does. Used by the browser preview and by `expo start --tunnel`,
// where the phone reaches only this dev server. On the same Wi-Fi, phones
// call the backend directly and this is not involved.
const API_PORT = Number(process.env.API_PORT ?? 4000);
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/socket.io/')) return middleware(req, res, next);
    const upstream = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    upstream.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Backend not running on port 4000' })); });
    req.pipe(upstream);
  },
};

module.exports = config;
