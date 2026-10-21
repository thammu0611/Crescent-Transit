// Vercel entry point: the same Express app as `npm start` (server/index.js),
// run as a serverless function instead of a long-running server.
//
// What Vercel cannot do, and the Render / Docker setup can: hold Socket.IO
// connections (live bus positions on the map), keep live positions in memory
// between requests, run the scheduled jobs, or accept GPS trackers over TCP.
// Everything else - sign-in, routes, schedules, attendance, admin - works.
//
// Set DATABASE_URL (a PostgreSQL connection string, e.g. Neon from Vercel's
// Storage tab), JWT_SECRET and DEMO_PASSWORD in the Vercel project settings.
import { createServer } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { seedIfEmpty, seedModules } from '../server/seed.js';

// Without a database URL fall back to a throwaway embedded database in /tmp
// (the only writable folder): fine for a quick look, but it is wiped often.
if (!process.env.DATABASE_URL) process.env.PGLITE_DIR ??= '/tmp/pgdata';

let ready = null;

async function start() {
  // No scheduled jobs: a function only runs while it answers a request.
  const config = loadConfig({ backgroundJobs: false });
  if (process.env.NODE_ENV === 'production' && config.usingDevSecret) {
    throw new Error('JWT_SECRET is not set. Add it in the Vercel project settings and redeploy.');
  }
  if (!config.databaseUrl) console.warn('DATABASE_URL is not set - using a temporary database in /tmp that Vercel wipes.');
  const db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
  await seedIfEmpty(db, config);
  await seedModules(db, config);
  const { app } = await createServer(db, config);
  return app;
}

export default async function handler(req, res) {
  try {
    ready ??= start();
    const app = await ready;
    return app(req, res);
  } catch (err) {
    ready = null; // try again on the next request
    console.error(err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}
