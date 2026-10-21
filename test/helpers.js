// Shared set-up for the end-to-end suites: a real server on an in-memory
// PostgreSQL, seeded with the timetable, plans and the finance account.
import { createServer } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { seedIfEmpty, seedModules } from '../server/seed.js';

export const PASSWORD = 'test-password';

export async function startTestServer(overrides = {}) {
  const base = loadConfig({
    jwtSecret: 'test-secret',
    demoPassword: PASSWORD,
    clientDist: '/nonexistent',
    backgroundJobs: false,
    seedDemoStudents: false,
  });
  const config = {
    ...base,
    ...overrides,
    // The suites were written for the paid plan; a suite passes
    // subscription: { studentRequired: false } to test the free default.
    subscription: { ...base.subscription, studentRequired: true, ...overrides.subscription },
    attendance: { ...base.attendance, travelWindows: '00:00-24:00', ...overrides.attendance },
    otp: { ...base.otp, showInResponse: true },
    rateLimits: { login: 1000, register: 1000, orders: 1000, webhook: 1000, deviceFixes: 1000 },
  };
  const db = await openDatabase({ databaseUrl: null, dataDir: null });
  await seedIfEmpty(db, config);
  await seedModules(db, config);
  const server = await createServer(db, config);
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const url = `http://localhost:${server.httpServer.address().port}`;

  async function call(path, { token, body, method, headers = {}, raw } = {}) {
    const res = await fetch(`${url}${path}`, {
      method: method ?? (body !== undefined || raw !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    const out = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: out, headers: res.headers };
  }

  const login = async (username, password = PASSWORD) => {
    const r = await call('/api/auth/login', { body: { username, password } });
    if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token;
  };

  let studentCounter = 0;
  /** Register a student on a route; returns { token, user }. */
  async function newStudent(routeCode = '118', extra = {}) {
    studentCounter += 1;
    const username = `t${Date.now().toString(36)}${studentCounter}`;
    const r = await call('/api/auth/register', {
      body: { username, email: `${username}@test.edu`, fullName: `Test Student ${studentCounter}`, password: 'password123', routeCode, department: 'CA', ...extra },
    });
    if (r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.body)}`);
    return { token: r.body.token, user: r.body.user, username };
  }

  /** Buy a plan through the test gateway (order -> hosted checkout -> signed webhook). */
  async function subscribe(token, { planCode = 'MONTHLY_60', webhook = 'deliver', method = 'upi' } = {}) {
    const order = await call('/api/subscriptions/order', { token, body: { planCode }, headers: { 'idempotency-key': `k-${Math.random().toString(36).slice(2, 12)}` } });
    if (order.status !== 201) throw new Error(`order: ${order.status} ${JSON.stringify(order.body)}`);
    const paid = await call(`/api/mock-gateway/orders/${order.body.orderId}/pay`, { body: { method, webhook } });
    return { order: order.body, paid: paid.body };
  }

  /** A subscribed student with location consent and a bound device. */
  async function rider(routeCode = '118') {
    const s = await newStudent(routeCode);
    await subscribe(s.token);
    await call('/api/me', { token: s.token, method: 'PATCH', body: { locationConsent: true } });
    const deviceId = `device-${s.username}`;
    await call('/api/devices/bind', { token: s.token, body: { deviceId, platform: 'ANDROID' } });
    return { ...s, deviceId };
  }

  async function stop() {
    server.stop();
    server.io.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
    await db.close();
  }

  return { ...server, db, config, url, call, login, newStudent, subscribe, rider, stop };
}

export const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();
