// `npm run backup`: one backup now, into BACKUP_DIR (or a path given here).
// With the embedded database, stop the server first: it holds the files.
//   npm run backup
//   npm run backup -- D:\safe\crescent.ndjson.gz
import fs from 'node:fs';
import path from 'node:path';
import { verifyBackup, writeBackup } from '../server/backup.js';
import { loadConfig, ROOT_DIR } from '../server/config.js';
import { openDatabase } from '../server/db.js';

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile?.(envFile);

const config = loadConfig();
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
const file = process.argv[2] ?? path.join(config.backup.dir, `crescent-${stamp}.ndjson.${config.backup.key ? 'enc' : 'gz'}`);

const db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
try {
  const written = await writeBackup(db, file, { key: config.backup.key });
  const checked = await verifyBackup(file, { key: config.backup.key });
  console.log(`Backup written and checked: ${file}`);
  console.log(`  ${checked.rows} rows in ${checked.tables} tables, ${written.bytes} bytes${written.encrypted ? ', encrypted' : ''}`);
} finally {
  await db.close();
}
