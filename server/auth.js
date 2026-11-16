import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { cacheFor } from './cache.js';
import { comparePassword, hashPassword as hashOnWorker, passwordQueueFull } from './passwords.js';
import { passwordProblem } from '../shared/password.js';

export class HttpError extends Error {
  /** `extra` is merged into the JSON error body, e.g. the plan for a 402. */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const ROLES = ['admin', 'driver', 'student', 'finance', 'parent'];

const PROFILE_SELECT = `
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.bus_id, u.status, u.email, u.email_verified_at, u.must_change_password,
         u.department, u.register_no, u.home_route_id, u.home_stop_seq, u.location_consent,
         u.travel_windows, u.language, u.boarding_reminders, u.arrival_alerts,
         b.fleet_code, r.code AS route_code, r.name AS route_name,
         hr.code AS home_route_code, hr.name AS home_route_name
    FROM users u
    LEFT JOIN buses b   ON b.id = u.bus_id
    LEFT JOIN routes r  ON r.id = b.route_id
    LEFT JOIN routes hr ON hr.id = u.home_route_id`;

export function toProfile(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.full_name,
    role: user.role,
    status: user.status,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_verified_at),
    mustChangePassword: Boolean(user.must_change_password),
    // Driver: the assigned bus.
    busId: user.bus_id,
    fleetCode: user.fleet_code,
    routeCode: user.route_code,
    routeName: user.route_name,
    // Student: saved route and stop, consent and travel window.
    department: user.department ?? null,
    registerNo: user.register_no ?? null,
    homeRouteCode: user.home_route_code ?? null,
    homeRouteName: user.home_route_name ?? null,
    homeStopSeq: user.home_stop_seq ?? null,
    locationConsent: Boolean(user.location_consent),
    travelWindows: user.travel_windows ?? null,
    language: user.language ?? 'en',
    boardingReminders: user.boarding_reminders !== false,
    arrivalAlerts: user.arrival_alerts !== false,
  };
}

export async function loadProfile(db, userId) {
  return cacheFor(db).get(`profile:${userId}`, ['users', 'buses', 'routes'], 30000, async () => {
    const { rows } = await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [userId]);
    return rows[0] ? toProfile(rows[0]) : null;
  });
}

/**
 * The student's university-email check, sent with every sign-in and profile:
 * whether the app must ask for the emailed code first, and which domain the
 * address must be on.
 */
export function emailCheck(config, profile) {
  const { domain, verify } = config.studentEmail;
  const student = profile?.role === 'student';
  const onDomain = !domain || String(profile?.email ?? '').toLowerCase().endsWith(`@${domain}`);
  return { required: Boolean(student && verify && (!profile.emailVerified || !onDomain)), domain };
}

const isOnDomain = (config, email) => !config.studentEmail.domain || email.endsWith(`@${config.studentEmail.domain}`);

function issueToken(config, user) {
  return jwt.sign({ sub: user.id, role: user.role, busId: user.bus_id }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Backpressure for a sign-in rush: a quick "try again" beats a request that
 * waits in the password queue until the phone gives up.
 */
function refuseWhenBusy() {
  if (passwordQueueFull()) {
    throw new HttpError(503, 'Many students are signing in right now. Try again in a few seconds.', { code: 'BUSY', retryAfterS: 5 });
  }
}

/** Check a username/password pair and issue a signed JWT carrying the role. */
export async function login(db, config, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'username and password are required');
  }
  refuseWhenBusy();
  const { rows } = await db.query(`${PROFILE_SELECT} WHERE u.username = $1 OR lower(u.email) = $1`, [
    username.trim().toLowerCase(),
  ]);
  const user = rows[0];
  // Same message for unknown user and wrong password: do not reveal which.
  if (!user || !(await comparePassword(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid username or password');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'This account is no longer active. Contact the transport office.', { code: 'ACCOUNT_SUSPENDED' });
  }
  const profile = toProfile(user);
  return { token: issueToken(config, user), user: profile, emailCheck: emailCheck(config, profile) };
}

/** The same rule as the website and the phone app (shared/password.js). */
export function refusePassword(password, who = {}) {
  const problem = passwordProblem(password, who);
  if (problem) throw new HttpError(400, problem, { code: 'WEAK_PASSWORD' });
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Student self-registration. Staff accounts are created by the administrator. */
export async function registerStudent(db, config, body) {
  const username = String(body?.username ?? '').trim().toLowerCase();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const fullName = String(body?.fullName ?? '').trim();
  const password = String(body?.password ?? '');
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username: 3-30 letters, digits, dot, dash or underscore');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
  if (!isOnDomain(config, email)) throw new HttpError(400, `Use your university email (@${config.studentEmail.domain}), the one on DigiiCampus`, { code: 'EMAIL_DOMAIN' });
  if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Full name is required');
  refusePassword(password, { username, email });
  refuseWhenBusy();

  let routeId = null;
  if (body.routeCode) {
    const r = await db.query('SELECT id FROM routes WHERE code = $1 AND active', [String(body.routeCode)]);
    if (!r.rows[0]) throw new HttpError(400, 'Unknown route');
    routeId = r.rows[0].id;
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, email, department, register_no, home_route_id, home_stop_seq)
       VALUES ($1, $2, $3, 'student', $4, $5, $6, $7, $8) RETURNING id`,
      [
        username,
        await hashPassword(password),
        fullName,
        email,
        body.department ? String(body.department).slice(0, 40) : null,
        body.registerNo ? String(body.registerNo).slice(0, 30) : null,
        routeId,
        routeId && Number.isInteger(body.stopSeq) ? body.stopSeq : null,
      ],
    );
    const user = (await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [rows[0].id])).rows[0];
    const profile = toProfile(user);
    return { token: issueToken(config, user), user: profile, emailCheck: emailCheck(config, profile) };
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That username or email is already registered');
    throw err;
  }
}

/**
 * A parent signs up with the one-time code from their child's app. `link`
 * checks the code before the account exists, and uses it up afterwards.
 */
export async function registerParent(db, config, body, guardians) {
  const username = String(body?.username ?? '').trim().toLowerCase();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const fullName = String(body?.fullName ?? '').trim();
  const password = String(body?.password ?? '');
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username: 3-30 letters, digits, dot, dash or underscore');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
  if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Full name is required');
  refusePassword(password, { username, email });
  await guardians.studentForCode(body?.code);
  refuseWhenBusy();
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, email, phone) VALUES ($1, $2, $3, 'parent', $4, $5) RETURNING id`,
      [username, await hashPassword(password), fullName, email, body.phone ? String(body.phone).slice(0, 20) : null],
    );
    await guardians.link(rows[0].id, body.code);
    const user = (await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [rows[0].id])).rows[0];
    const profile = toProfile(user);
    return { token: issueToken(config, user), user: profile, emailCheck: emailCheck(config, profile) };
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That username or email is already registered');
    throw err;
  }
}

/** Verify a bearer token; returns the auth context or null. */
export function verifyToken(config, token) {
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    // Sign-in tokens only: other signed codes (the bus pass QR) carry a `typ`
    // and no role, and must never stand in for a login.
    if (claims.typ || !ROLES.includes(claims.role)) return null;
    return { userId: claims.sub, role: claims.role, busId: claims.busId, issuedAt: claims.iat };
  } catch {
    return null;
  }
}

/**
 * Express middleware: require a valid Bearer token whose role is in `roles`.
 * Role-based access is enforced here, on the server (doc section 4).
 * With a db, a suspended account is refused even while its token is valid.
 */
export function requireRole(config, ...roles) {
  let db = null;
  if (roles[0] && typeof roles[0] === 'object') db = roles.shift();
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Missing bearer token'));
    const auth = verifyToken(config, token);
    if (!auth) return next(new HttpError(401, 'Invalid or expired token'));
    if (!roles.includes(auth.role)) return next(new HttpError(403, `Requires role: ${roles.join(' or ')}`));
    if (db) {
      // Every request asks this, so it comes from the cache; any write to
      // users (suspension, password change, bus reassignment) refreshes it.
      const account = await cacheFor(db).get(`account:${auth.userId}`, ['users'], 30000, async () => (
        (await db.query('SELECT status, bus_id, password_changed_at, email, email_verified_at, must_change_password FROM users WHERE id = $1', [auth.userId])).rows[0] ?? null
      ));
      if (!account) return next(new HttpError(401, 'Account no longer exists'));
      if (account.status !== 'active') return next(new HttpError(403, 'This account is no longer active', { code: 'ACCOUNT_SUSPENDED' }));
      // A password change signs the account out everywhere else.
      if (tokenPredates(auth, account.password_changed_at)) {
        return next(new HttpError(401, 'Your password was changed. Sign in again.', { code: 'PASSWORD_CHANGED' }));
      }
      // A driver moved to another bus by the admin acts for the new bus at once.
      auth.busId = account.bus_id;
      const open = ACCOUNT_STEP_OPEN.has(req.originalUrl.split('?')[0]);
      // A temporary password from the administrator is replaced before anything else.
      if (account.must_change_password && !open) {
        return next(new HttpError(403, 'Choose your own password first', { code: 'PASSWORD_CHANGE_REQUIRED' }));
      }
      // A student must confirm their university email before using the app;
      // only the profile, the email-code endpoints and sign-out stay open.
      if (auth.role === 'student' && config.studentEmail?.verify && !open) {
        const email = String(account.email ?? '').toLowerCase();
        if (!account.email_verified_at || !isOnDomain(config, email)) {
          return next(new HttpError(403, 'Confirm your university email first', { code: 'EMAIL_UNVERIFIED' }));
        }
      }
    }
    req.auth = auth;
    next();
  };
}

const ACCOUNT_STEP_OPEN = new Set(['/api/me', '/api/me/export', '/api/me/delete', '/api/auth/email/send', '/api/auth/email/verify', '/api/auth/logout', '/api/auth/change-password']);

const codeHash = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

/**
 * Email a 6-digit code to the student's university address (optionally a new
 * address on the university domain, which replaces the old one once confirmed).
 * Returns the masked address; without SMTP in development, the code as well.
 */
export async function sendEmailCode(db, config, mailer, userId, body = {}) {
  const { rows } = await db.query('SELECT id, email, full_name FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw new HttpError(401, 'Account no longer exists');
  const email = String(body.email ?? user.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
  if (!isOnDomain(config, email)) throw new HttpError(400, `Use your university email (@${config.studentEmail.domain}), the one on DigiiCampus`, { code: 'EMAIL_DOMAIN' });
  if (email !== String(user.email ?? '').toLowerCase()) {
    const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [email, userId]);
    if (taken.rows[0]) throw new HttpError(409, 'That email belongs to another account');
  }
  const last = (await db.query('SELECT sent_at FROM email_codes WHERE user_id = $1', [userId])).rows[0];
  const wait = last ? config.studentEmail.resendSeconds - Math.floor((Date.now() - new Date(last.sent_at).getTime()) / 1000) : 0;
  if (wait > 0) throw new HttpError(429, `Wait ${wait} s before asking for another code`, { code: 'RESEND_WAIT', retryAfterS: wait });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + config.studentEmail.codeTtlMinutes * 60000);
  await db.query(
    `INSERT INTO email_codes (user_id, email, code_hash, expires_at, attempts, sent_at) VALUES ($1, $2, $3, $4, 0, now())
     ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()`,
    [userId, email, codeHash(userId, code), expires],
  );
  const sent = await mailer.send({
    to: email,
    subject: `${code} is your Crescent Transit code`,
    text: `Hello ${user.full_name},\n\nYour Crescent Transit verification code is ${code}. It expires in ${config.studentEmail.codeTtlMinutes} minutes.\n\nIf you did not ask for it, ignore this email.`,
  });
  const masked = email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 6))}${c}`);
  const out = { sentTo: masked, expiresInMinutes: config.studentEmail.codeTtlMinutes, delivered: sent };
  if (!sent) {
    // No mail server: in development hand the code back so the flow can be tried.
    if (!config.otp?.showInResponse) throw new HttpError(503, 'Email is not set up on the server yet. Contact the transport office.', { code: 'MAIL_UNAVAILABLE' });
    out.devCode = code;
  }
  return out;
}

/** Check the emailed code; on success the (new) address is the student's confirmed email. */
export async function verifyEmailCode(db, config, userId, body = {}) {
  const code = String(body.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code');
  const row = (await db.query('SELECT email, code_hash, expires_at, attempts FROM email_codes WHERE user_id = $1', [userId])).rows[0];
  if (!row) throw new HttpError(400, 'Ask for a code first', { code: 'NO_CODE' });
  if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, 'That code has expired; ask for a new one', { code: 'CODE_EXPIRED' });
  if (row.attempts >= config.studentEmail.maxAttempts) throw new HttpError(429, 'Too many wrong codes; ask for a new one', { code: 'TOO_MANY_ATTEMPTS' });
  const given = Buffer.from(codeHash(userId, code));
  const want = Buffer.from(row.code_hash);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    await db.query('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
    throw new HttpError(400, 'That code is not right', { code: 'WRONG_CODE' });
  }
  try {
    await db.query('UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1', [userId, row.email]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That email belongs to another account');
    throw err;
  }
  await db.query('DELETE FROM email_codes WHERE user_id = $1', [userId]);
  const profile = toProfile((await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [userId])).rows[0]);
  return { user: profile, emailCheck: emailCheck(config, profile) };
}

/** bcrypt, cost 10, on a worker thread (server/passwords.js). */
export const hashPassword = (password) => hashOnWorker(password, 10);

/** Was this token issued before the password last changed? (JWT iat is whole seconds.) */
function tokenPredates(auth, changedAt) {
  if (!changedAt || !Number.isFinite(auth.issuedAt)) return false;
  return auth.issuedAt < Math.floor(new Date(changedAt).getTime() / 1000);
}

// bcrypt reads at most 72 bytes; a longer password would be silently cut.
const MAX_PASSWORD_BYTES = 72;

/**
 * Any signed-in user changes their own password. The current password is
 * required, every older token stops working, and a fresh token is returned
 * so this device stays signed in.
 */
export async function changePassword(db, config, userId, body) {
  const current = body?.currentPassword;
  const next = body?.newPassword;
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    throw new HttpError(400, 'currentPassword and newPassword are required');
  }
  if (Buffer.byteLength(next, 'utf8') > MAX_PASSWORD_BYTES) throw new HttpError(400, `New password must be at most ${MAX_PASSWORD_BYTES} characters`);
  if (next === current) throw new HttpError(400, 'New password must be different from the current one');

  const { rows } = await db.query('SELECT password_hash, username, email FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
  refusePassword(next, rows[0]);
  if (!(await comparePassword(current, rows[0].password_hash))) {
    throw new HttpError(400, 'Current password is incorrect', { code: 'WRONG_PASSWORD' });
  }
  // This server's clock, whole seconds: the fresh token below (iat = now) is never older
  // than the change, even when a hosted database's clock differs from ours.
  const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db.query('UPDATE users SET password_hash = $2, password_changed_at = $3, must_change_password = FALSE WHERE id = $1', [userId, await hashPassword(next), changedAt]);
  const user = (await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [userId])).rows[0];
  const profile = toProfile(user);
  return { token: issueToken(config, user), user: profile, emailCheck: emailCheck(config, profile) };
}

const maskEmail = (email) => email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 6))}${c}`);
const resetHash = (userId, code) => codeHash(`reset:${userId}`, code);
const findAccount = async (db, login) => (await db.query(
  'SELECT id, full_name, email, status FROM users WHERE username = $1 OR lower(email) = $1', [String(login ?? '').trim().toLowerCase()],
)).rows[0] ?? null;

/**
 * Forgot password, step 1: email a 6-digit code to the account's address.
 * The answer is the same whether or not the account exists, so it cannot be
 * used to find out who has an account.
 */
export async function requestPasswordReset(db, config, mailer, body = {}) {
  const login = String(body.login ?? '').trim();
  if (!login) throw new HttpError(400, 'Enter your username or email');
  if (!mailer.configured && !config.otp?.showInResponse) {
    throw new HttpError(503, 'Password reset by email is not set up yet. Ask the transport office to reset it.', { code: 'MAIL_UNAVAILABLE' });
  }
  const { codeTtlMinutes, resendSeconds } = config.passwordReset;
  const out = { ok: true, expiresInMinutes: codeTtlMinutes };
  const user = await findAccount(db, login);
  if (!user?.email || user.status === 'suspended') return out;
  const last = (await db.query('SELECT sent_at FROM password_resets WHERE user_id = $1', [user.id])).rows[0];
  if (last && Date.now() - new Date(last.sent_at).getTime() < resendSeconds * 1000) return out;

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.query(
    `INSERT INTO password_resets (user_id, code_hash, expires_at, attempts, sent_at) VALUES ($1, $2, $3, 0, now())
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()`,
    [user.id, resetHash(user.id, code), new Date(Date.now() + codeTtlMinutes * 60000)],
  );
  const sent = await mailer.send({
    to: user.email,
    subject: `${code} is your Crescent Transit password reset code`,
    text: `Hello ${user.full_name},\n\nYour Crescent Transit password reset code is ${code}. It expires in ${codeTtlMinutes} minutes.\n\nIf you did not ask to reset your password, ignore this email; your password stays the same.`,
  });
  if (!sent && config.otp?.showInResponse) {
    out.devCode = code;
    out.sentTo = maskEmail(user.email);
  }
  return out;
}

/** Forgot password, step 2: the emailed code sets a new password and signs in. */
export async function resetPassword(db, config, body = {}) {
  const code = String(body.code ?? '').replace(/\D/g, '');
  const next = body.newPassword;
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code');
  if (typeof next !== 'string') throw new HttpError(400, 'A new password is required');
  if (Buffer.byteLength(next, 'utf8') > MAX_PASSWORD_BYTES) throw new HttpError(400, `New password must be at most ${MAX_PASSWORD_BYTES} characters`);
  const user = await findAccount(db, body.login);
  refusePassword(next, user ?? {});
  const row = user && (await db.query('SELECT code_hash, expires_at, attempts FROM password_resets WHERE user_id = $1', [user.id])).rows[0];
  if (!row) throw new HttpError(400, 'That code is not right', { code: 'WRONG_CODE' });
  if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, 'That code has expired; ask for a new one', { code: 'CODE_EXPIRED' });
  if (row.attempts >= config.passwordReset.maxAttempts) throw new HttpError(429, 'Too many wrong codes; ask for a new one', { code: 'TOO_MANY_ATTEMPTS' });
  const given = Buffer.from(resetHash(user.id, code));
  const want = Buffer.from(row.code_hash);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    await db.query('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = $1', [user.id]);
    throw new HttpError(400, 'That code is not right', { code: 'WRONG_CODE' });
  }
  if (user.status === 'suspended') throw new HttpError(403, 'This account is suspended. Contact the transport office.', { code: 'ACCOUNT_SUSPENDED' });
  const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  // The code reached the inbox, so the address is confirmed as well.
  await db.query(
    `UPDATE users SET password_hash = $2, password_changed_at = $3, must_change_password = FALSE,
            email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
    [user.id, await hashPassword(next), changedAt],
  );
  await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
  const full = (await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [user.id])).rows[0];
  const profile = toProfile(full);
  return { token: issueToken(config, full), user: profile, emailCheck: emailCheck(config, profile) };
}
