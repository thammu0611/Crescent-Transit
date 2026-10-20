// Push notifications (server/push.js): who receives which message, and how
// the server keeps its token list clean. Expo's push service is replaced by a
// fake that records each request and answers with tickets.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

const sent = [];
let answer = (messages) => ({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) });
async function fakeExpo(url, init) {
  const messages = JSON.parse(init.body);
  sent.push({ url, messages });
  return { ok: true, status: 200, json: async () => answer(messages) };
}

/** Messages to one token, once the (unawaited) push has gone out. */
async function messagesTo(token, { wait = true } = {}) {
  for (let i = 0; i < 50 && wait; i += 1) {
    if (sent.some((r) => r.messages.some((m) => m.to === token))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return sent.flatMap((r) => r.messages).filter((m) => m.to === token);
}

const tokenFor = (name) => `ExponentPushToken[${name}]`;
let t;
let admin;

before(async () => {
  t = await startTestServer({ push: { enabled: true, fetch: fakeExpo } });
  admin = await t.login('admin');
});
after(() => t.stop());

test('only Expo push tokens are accepted', async () => {
  const s = await t.newStudent('118');
  assert.equal((await t.call('/api/push/register', { token: s.token, body: { token: 'not-a-token' } })).status, 400);
  assert.equal((await t.call('/api/push/register', { token: s.token, body: { token: tokenFor('ok1'), platform: 'android' } })).status, 200);
  assert.equal((await t.call('/api/push/register', { body: { token: tokenFor('anon') } })).status, 401);
});

test('route alerts reach subscribed students on that route, not others', async () => {
  const onRoute = await t.newStudent('118');
  await t.subscribe(onRoute.token);
  const unpaid = await t.newStudent('118');
  const otherRoute = await t.newStudent('121');
  await t.subscribe(otherRoute.token);
  for (const [s, name] of [[onRoute, 'onRoute'], [unpaid, 'unpaid'], [otherRoute, 'otherRoute']]) {
    await t.call('/api/push/register', { token: s.token, body: { token: tokenFor(name), platform: 'android' } });
  }

  const r = await t.call('/api/notifications', { token: admin, body: { title: 'Route 118 delayed', message: 'Traffic at Velachery', kind: 'DELAY', routeCode: '118' } });
  assert.equal(r.status, 201);

  const [m] = await messagesTo(tokenFor('onRoute'));
  assert.ok(m, 'the subscribed student on the route gets the alert');
  assert.equal(m.title, 'Route 118 delayed');
  assert.equal(m.body, 'Traffic at Velachery');
  assert.equal(m.channelId, 'alerts', 'Android channel the app creates');
  assert.equal(m.data.type, 'notification');
  assert.deepEqual(await messagesTo(tokenFor('unpaid'), { wait: false }), [], 'alerts are a paid feature');
  assert.deepEqual(await messagesTo(tokenFor('otherRoute'), { wait: false }), [], 'another route is not told');
});

test('an SOS reaches the transport office', async () => {
  await t.call('/api/push/register', { token: admin, body: { token: tokenFor('admin'), platform: 'ios' } });
  const s = await t.newStudent('118');
  assert.equal((await t.call('/api/problems', { token: s.token, body: { kind: 'SOS', message: 'Help near Guindy' } })).status, 201);
  const [m] = await messagesTo(tokenFor('admin'));
  assert.ok(m);
  assert.equal(m.title, 'SOS reported');
  assert.equal(m.body, 'Help near Guindy');
});

test('a phone that signs out stops receiving the account\'s alerts', async () => {
  const s = await t.newStudent('118');
  await t.subscribe(s.token);
  await t.call('/api/push/register', { token: s.token, body: { token: tokenFor('signedOut') } });
  await t.call('/api/push/unregister', { token: s.token, body: { token: tokenFor('signedOut') } });
  await t.call('/api/notifications', { token: admin, body: { title: 'Holiday', message: 'No buses on Monday' } });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(await messagesTo(tokenFor('signedOut'), { wait: false }), []);
});

test('tokens Expo no longer knows are removed', async () => {
  const s = await t.newStudent('118');
  await t.subscribe(s.token);
  await t.call('/api/push/register', { token: s.token, body: { token: tokenFor('gone') } });
  answer = (messages) => ({
    data: messages.map((m) => (m.to === tokenFor('gone')
      ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok', id: 'ticket' })),
  });
  await t.call('/api/notifications', { token: admin, body: { title: 'Route 118 note', message: 'Test', routeCode: '118' } });
  await messagesTo(tokenFor('gone'));
  let rows = [];
  for (let i = 0; i < 50; i += 1) {
    rows = (await t.db.query('SELECT token FROM push_tokens WHERE token = $1', [tokenFor('gone')])).rows;
    if (!rows.length) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(rows.length, 0);
});
