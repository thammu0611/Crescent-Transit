import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createServer } from './app.js';
import { LEGACY_PGLITE_DIR, loadConfig, ROOT_DIR } from './config.js';
import { DatabaseInUseError, migrateDataDir, openDatabase } from './db.js';
import { seedIfEmpty, seedModules } from './seed.js';

// Settings from a project-root .env file (copy .env.example). Variables already
// set in the shell or the hosting dashboard win over the file.
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  else console.warn('Found .env but this Node.js cannot read it (needs 20.12+); set the variables in the shell.');
}

const config = loadConfig();

// A public deployment must never sign tokens or trust webhooks with the
// well-known development secrets: refuse to start instead of only warning.
if (process.env.NODE_ENV === 'production') {
  const missing = [
    config.usingDevSecret && 'JWT_SECRET',
    config.payment.mode === 'razorpay' && config.usingDevWebhookSecret && 'RAZORPAY_WEBHOOK_SECRET',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`NODE_ENV=production but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. Set ${missing.length > 1 ? 'them' : 'it'} and start again.`);
    process.exit(1);
  }
}

// A failed background promise is logged, not fatal: crashing would drop every
// live bus and could leave the embedded database mid-write.
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

if (!config.databaseUrl && !process.env.PGLITE_DIR && migrateDataDir(LEGACY_PGLITE_DIR, config.pgliteDir)) {
  console.log(`Copied the local database from ${LEGACY_PGLITE_DIR} to ${config.pgliteDir}.`);
}
// Is the port free? If a server is already running there, say so before the
// database is touched (it is that server's database).
const portTaken = await new Promise((resolve) => {
  const probe = net.createServer().once('error', (err) => resolve(err.code === 'EADDRINUSE')).once('listening', () => probe.close(() => resolve(false)));
  probe.listen(config.port);
});
if (portTaken) {
  // node:http, not fetch: exiting right after a fetch can trip a libuv assertion on Windows.
  const running = await new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port: config.port, path: '/api/health', agent: false, timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
  console.error(running
    ? `A CresTrack server is already running at http://localhost:${config.port} - there is nothing more to start.\n`
      + '  Use that one, or stop it (Ctrl+C in its window, or close the window) and run "npm start" again.'
    : `Port ${config.port} is used by another program. Close it, or start on another port, e.g. "set PORT=4100 && npm start".`);
  process.exit(1);
}

let db;
try {
  db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
} catch (err) {
  if (!(err instanceof DatabaseInUseError)) throw err;
  console.error(err.message);
  process.exit(1);
}
if (await seedIfEmpty(db, config)) console.log('Loaded the BSACIST 2026-27 bus timetable (28 routes).');
if (await seedModules(db, config)) console.log('Created demo student accounts stu001-stu024 (password: DEMO_PASSWORD).');

const { httpServer, stop, gateway, trackerListeners } = await createServer(db, config);

// A longer accept queue than Node's default (511): when hundreds of phones
// connect in the same second, the extra connections wait instead of being reset.
httpServer.listen({ port: config.port, backlog: 2048 }, () => {
  const base = `http://localhost:${config.port}`;
  console.log('University Bus Tracking System');
  console.log(`  Database : ${db.kind}${config.databaseUrl ? '' : ` in ${config.pgliteDir}`}`);
  console.log(`  Payments : ${gateway.mode === 'mock' ? 'built-in test gateway (set RAZORPAY_* for Razorpay)' : 'Razorpay'}`);
  console.log(`  App      : ${base}/`);
  console.log(`  API      : ${base}/api/health`);
  for (const l of trackerListeners) console.log(`  Trackers : ${l.protocol.toUpperCase()} on TCP port ${l.port}`);
  if (config.gps.webhookSecret) console.log(`  Trackers : webhook at ${base}/api/gps/webhook`);
  if (config.usingDevSecret) console.warn('  Warning  : JWT_SECRET not set - using the development secret.');
  if (config.usingDevWebhookSecret) console.warn('  Warning  : RAZORPAY_WEBHOOK_SECRET not set - using the development secret.');
});

// Close the database cleanly however the server is stopped: an abrupt exit
// mid-write can leave the embedded database unreadable. SIGHUP is a closed
// terminal window; SIGBREAK is Ctrl+Break on Windows.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stop();
  httpServer.close();
  await db.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown);
