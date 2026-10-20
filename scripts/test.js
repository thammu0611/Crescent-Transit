// `npm test`: every test/*.test.js through node:test. The files are listed
// here because Node 20 does not expand a glob given to --test, and neither
// does the Windows shell. Extra arguments go to node, e.g.
//   npm test -- --test-name-pattern=boarding
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
