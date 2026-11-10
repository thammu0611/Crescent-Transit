// `npm run test:e2e`: real browser tests of the built website against a real
// server with a throw-away database. Run `npm run build` first. On a developer's
// Windows computer they use the installed Edge, so nothing extra is downloaded;
// CI installs Chromium.
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const dataDir = path.join(os.tmpdir(), `ct-e2e-${process.pid}`);

export default defineConfig({
  testDir: 'e2e',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.CI ? undefined : 'msedge',
    viewport: { width: 1366, height: 800 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: `"${process.execPath}" server/index.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: String(PORT), PGLITE_DIR: dataDir, DEMO_MODE: '1', NODE_ENV: 'development', BACKUP_ENABLED: '0' },
  },
});
