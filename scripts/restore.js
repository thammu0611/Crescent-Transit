// `npm run restore`: replace the whole database with a backup.
// Stop the server first. This removes everything now in the database.
//   npm run restore -- D:\safe\crescent.ndjson.gz          checks the file only
//   npm run restore -- D:\safe\crescent.ndjson.gz --yes    replaces the database
import fs from 'node:fs';
import path from 'node:path';
import { restoreBackup, verifyBackup } from '../server/backup.js';
import { loadConfig, ROOT_DIR } from '../server/config.js';
import { openDatabase } from '../server/db.js';

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile?.(envFile);

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const confirmed = process.argv.includes('--yes');
if (!file || !fs.existsSync(file)) {
  console.error('Give the backup file: npm run restore -- <file> [--yes]');
  process.exit(1);
}
const config = loadConfig();
const checked = await verifyBackup(file, { key: config.backup.key });
console.log(`The file is good: ${checked.rows} rows in ${checked.tables} tables, made ${checked.createdAt}.`);
if (!confirmed) {
  console.log('Nothing was changed. Add --yes to replace the database with it.');
  process.exit(0);
}
const db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
try {
  await restoreBackup(db, file, { key: config.backup.key });
  console.log('Restored. Start the server.');
} finally {
  await db.close();
}
