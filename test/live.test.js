// Live (non-demo) mode: real accounts instead of the shared demo password,
// temporary driver passwords, forgot password by email, and no test payments.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { seedIfEmpty } from '../server/seed.js';
import { PASSWORD, startTestServer } from './helpers.js';

const ADMIN = 'admin-secret-2026';
let t;
before(async () => {
  t = await startTestServer({ demoMode: false, adminPassword: ADMIN, seedDemoStudents: false, subscription: { studentRequired: false } });
});
after(async () => { await t.stop(); });

const signIn = (username, password) => t.call('/api/auth/login', { body: { username, password } });

test('an empty database is not seeded without ADMIN_PASSWORD outside demo mode', async () => {
  const db = await openDatabase({ databaseUrl: null, dataDir: null });
  const config = loadConfig({ demoMode: false, adminPassword: null });
  await assert.rejects(seedIfEmpty(db, config), /ADMIN_PASSWORD/);
  await db.close?.();
});

test('the demo password opens nothing; the administrator uses ADMIN_PASSWORD', async () => {
  for (const username of ['admin', 'drv118', 'finance']) assert.equal((await signIn(username, PASSWORD)).status, 401, username);
  assert.equal((await signIn('admin', ADMIN)).status, 200);
  const health = await t.call('/api/health');
  assert.equal(health.body.demoMode, false);
});

test('a temporary driver password must be replaced before anything else', async () => {
  const admin = (await signIn('admin', ADMIN)).body.token;
  const driver = (await t.call('/api/admin/drivers', { token: admin })).body.find((d) => d.username === 'drv118');
  assert.equal((await t.call(`/api/admin/drivers/${driver.id}`, { token: admin, method: 'PATCH', body: { password: 'temporary-118' } })).status, 200);

  const first = await signIn('drv118', 'temporary-118');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.mustChangePassword, true);
  const blocked = await t.call('/api/driver/trip', { token: first.body.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await t.call('/api/auth/change-password', { token: first.body.token, body: { currentPassword: 'temporary-118', newPassword: 'my-own-pass-118' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.mustChangePassword, false);
  assert.notEqual((await t.call('/api/driver/trip', { token: changed.body.token })).body.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('forgot password: the emailed code sets a new password and signs in', async () => {
  const s = await t.newStudent();
  const asked = await t.call('/api/auth/password/forgot', { body: { login: s.username } });
  assert.equal(asked.status, 200);
  assert.match(asked.body.devCode, /^\d{6}$/);

  const wrong = asked.body.devCode === '000000' ? '111111' : '000000';
  assert.equal((await t.call('/api/auth/password/reset', { body: { login: s.username, code: wrong, newPassword: 'reset-pass-1' } })).body.code, 'WRONG_CODE');

  const reset = await t.call('/api/auth/password/reset', { body: { login: s.user.email, code: asked.body.devCode, newPassword: 'reset-pass-1' } });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.token);
  assert.equal((await signIn(s.username, 'Route-pass-123')).status, 401);
  assert.equal((await signIn(s.username, 'reset-pass-1')).status, 200);
  // The old session is signed out; the code is single-use.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await t.call('/api/auth/password/reset', { body: { login: s.username, code: asked.body.devCode, newPassword: 'reset-pass-2' } })).status, 400);
});

test('forgot password answers the same for an unknown account', async () => {
  const r = await t.call('/api/auth/password/forgot', { body: { login: 'nobody-here' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.devCode, undefined);
});

test('no test payments outside demo mode', async () => {
  const s = await t.newStudent();
  const order = await t.call('/api/subscriptions/order', { token: s.token, body: { planCode: 'MONTHLY_60' }, headers: { 'idempotency-key': 'k-live-1' } });
  assert.equal(order.status, 404);
  assert.equal((await t.call('/api/mock-gateway/orders/x/pay', { body: {} })).status, 404);
});
