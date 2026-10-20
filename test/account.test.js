// Account security: changing a password, signing other devices out, and the
// hardening headers every response carries.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, startTestServer } from './helpers.js';

let t;
before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); });

const change = (token, currentPassword, newPassword) =>
  t.call('/api/auth/change-password', { token, body: { currentPassword, newPassword } });

test('a student changes their password: the new one signs in, the old one does not', async () => {
  const s = await t.newStudent();
  const r = await change(s.token, 'password123', 'brand-new-pass');
  assert.equal(r.status, 200);
  assert.ok(r.body.token, 'a fresh token keeps this device signed in');
  assert.equal(r.body.user.username, s.username);

  assert.equal((await t.call('/api/auth/login', { body: { username: s.username, password: 'password123' } })).status, 401);
  assert.equal((await t.call('/api/auth/login', { body: { username: s.username, password: 'brand-new-pass' } })).status, 200);
  assert.equal((await t.call('/api/me', { token: r.body.token })).status, 200);
});

test('a password change signs out tokens issued before it', async () => {
  const s = await t.newStudent();
  // JWT iat has one-second resolution: let a second pass so the old token is strictly older.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const r = await change(s.token, 'password123', 'another-pass-1');
  assert.equal(r.status, 200);
  const old = await t.call('/api/me', { token: s.token });
  assert.equal(old.status, 401);
  assert.equal(old.body.code, 'PASSWORD_CHANGED');
  assert.equal((await t.call('/api/me', { token: r.body.token })).status, 200);
});

test('every role can change its own password', async () => {
  for (const username of ['admin', 'finance', 'drv118']) {
    const token = await t.login(username);
    const r = await change(token, PASSWORD, `${username}-new-secret`);
    assert.equal(r.status, 200, username);
    assert.equal(r.body.user.username, username);
    // Put it back so other suites' assumptions hold.
    assert.equal((await change(r.body.token, `${username}-new-secret`, PASSWORD)).status, 200);
  }
});

test('a wrong current password is refused without signing the user out', async () => {
  const s = await t.newStudent();
  const r = await change(s.token, 'not-my-password', 'brand-new-pass');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'WRONG_PASSWORD');
  assert.equal((await t.call('/api/me', { token: s.token })).status, 200);
});

test('weak, unchanged, missing or over-long new passwords are refused', async () => {
  const s = await t.newStudent();
  assert.equal((await change(s.token, 'password123', 'short')).status, 400);
  assert.equal((await change(s.token, 'password123', 'password123')).status, 400);
  assert.equal((await change(s.token, 'password123', 'x'.repeat(73))).status, 400);
  assert.equal((await t.call('/api/auth/change-password', { token: s.token, body: {} })).status, 400);
  assert.equal((await change(null, 'password123', 'brand-new-pass')).status, 401);
});

test('the password change is written to the audit log', async () => {
  const s = await t.newStudent();
  await change(s.token, 'password123', 'audited-pass-1');
  const { rows } = await t.db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'PASSWORD_CHANGED' AND actor_id = $1`, [s.user.id]);
  assert.equal(rows[0].n, 1);
});

test('responses carry browser hardening headers and API data is not cached', async () => {
  const r = await t.call('/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-powered-by'), null);
});
