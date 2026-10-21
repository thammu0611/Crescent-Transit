// Deletes the embedded database; the timetable is reloaded on the next start.
import fs from 'node:fs';
import { loadConfig } from '../server/config.js';

const { pgliteDir, databaseUrl } = loadConfig();
if (databaseUrl) {
  console.log('DATABASE_URL is set - not touching a hosted database.');
} else {
  fs.rmSync(pgliteDir, { recursive: true, force: true });
  console.log(`Removed ${pgliteDir}. Start the server to reseed.`);
}
