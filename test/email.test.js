// University email check: with STUDENT_EMAIL_VERIFY on, a student confirms the
// email DigiiCampus holds with an emailed code before using the app.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

let t;
before(async () => {
  t = await startTestServer({ subscription: { studentRequired: false }, studentEmail: { domain: 'test.edu', verify: true, codeTtlMinutes: 10, maxAttempts: 3, resendSeconds: 60 } });
});
after(async () => { await t.stop(); });

const send = (token, body = {}) => t.call('/api/auth/email/send', { token, body });
const verify = (token, code) => t.call('/api/auth/email/verify', { token, body: { code } });

test('registration only accepts an address on the university domain', async () => {
  const r = await t.call('/api/auth/register', {
    body: { username: 'offdomain1', email: 'someone@gmail.com', fullName: 'Off Domain', password: 'Route-pass-123', routeCode: '118', department: 'CA' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'EMAIL_DOMAIN');
});

test('an unverified student is told to verify and kept out of student endpoints', async () => {
  const s = await t.newStudent();
  const login = await t.call('/api/auth/login', { body: { username: s.username, password: 'Route-pass-123' } });
  assert.deepEqual(login.body.emailCheck, { required: true, domain: 'test.edu' });

  const me = await t.call('/api/me', { token: s.token });
  assert.equal(me.status, 200, 'the profile stays open');
  assert.equal(me.body.emailCheck.required, true);
  assert.equal(me.body.user.emailVerified, false);

  const blocked = await t.call('/api/attendance/me', { token: s.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'EMAIL_UNVERIFIED');
});

test('the emailed code confirms the address and opens the app', async () => {
  const s = await t.newStudent();
  const sent = await send(s.token);
  assert.equal(sent.status, 200);
  assert.match(sent.body.sentTo, /^t•+@test\.edu$/);
  assert.match(sent.body.devCode, /^\d{6}$/, 'without SMTP in development the code comes back');

  const wrong = sent.body.devCode === '000000' ? '111111' : '000000';
  const bad = await verify(s.token, wrong);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'WRONG_CODE');

  const ok = await verify(s.token, sent.body.devCode);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.emailCheck.required, false);
  assert.equal(ok.body.user.emailVerified, true);
  assert.equal((await t.call('/api/attendance/me', { token: s.token })).status, 200);

  // The code is single-use.
  assert.equal((await verify(s.token, sent.body.devCode)).body.code, 'NO_CODE');
});

test('a new address must be on the domain and free; it replaces the old one once confirmed', async () => {
  const a = await t.newStudent();
  const b = await t.newStudent();
  assert.equal((await send(a.token, { email: 'me@gmail.com' })).body.code, 'EMAIL_DOMAIN');
  assert.equal((await send(a.token, { email: b.user.email })).status, 409);

  const sent = await send(a.token, { email: `new.${a.username}@test.edu` });
  assert.equal(sent.status, 200);
  const ok = await verify(a.token, sent.body.devCode);
  assert.equal(ok.body.user.email, `new.${a.username}@test.edu`);
});

test('codes cannot be re-sent at once, and too many wrong codes lock the code', async () => {
  const s = await t.newStudent();
  const sent = await send(s.token);
  const again = await send(s.token);
  assert.equal(again.status, 429);
  assert.equal(again.body.code, 'RESEND_WAIT');

  const wrong = sent.body.devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 3; i += 1) assert.equal((await verify(s.token, wrong)).status, 400);
  const locked = await verify(s.token, sent.body.devCode);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'TOO_MANY_ATTEMPTS');
});

test('other roles are never asked to verify', async () => {
  for (const username of ['admin', 'drv118']) {
    const r = await t.call('/api/auth/login', { body: { username, password: 'test-password' } });
    assert.equal(r.body.emailCheck.required, false, username);
  }
});
