import jwt from 'jsonwebtoken';
import { cacheFor } from './cache.js';
import { comparePassword, hashPassword as hashOnWorker, passwordQueueFull } from './passwords.js';

export class HttpError extends Error {
  /** `extra` is merged into the JSON error body, e.g. the plan for a 402. */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const ROLES = ['admin', 'driver', 'student', 'finance'];

const PROFILE_SELECT = `
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.bus_id, u.status, u.email,
         u.department, u.register_no, u.home_route_id, u.home_stop_seq, u.location_consent,
         u.travel_windows, u.language, u.boarding_reminders,
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
  };
}

export async function loadProfile(db, userId) {
  return cacheFor(db).get(`profile:${userId}`, ['users', 'buses', 'routes'], 30000, async () => {
    const { rows } = await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [userId]);
    return rows[0] ? toProfile(rows[0]) : null;
  });
}

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
  if (user.status === 'suspended') {
    throw new HttpError(403, 'This account is suspended. Contact the transport office.', { code: 'ACCOUNT_SUSPENDED' });
  }
  return { token: issueToken(config, user), user: toProfile(user) };
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
  if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Full name is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
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
    return { token: issueToken(config, user), user: toProfile(user) };
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That username or email is already registered');
    throw err;
  }
}

/** Verify a bearer token; returns the auth context or null. */
export function verifyToken(config, token) {
  try {
    const claims = jwt.verify(token, config.jwtSecret);
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
        (await db.query('SELECT status, bus_id, password_changed_at FROM users WHERE id = $1', [auth.userId])).rows[0] ?? null
      ));
      if (!account) return next(new HttpError(401, 'Account no longer exists'));
      if (account.status === 'suspended') return next(new HttpError(403, 'This account is suspended', { code: 'ACCOUNT_SUSPENDED' }));
      // A password change signs the account out everywhere else.
      if (tokenPredates(auth, account.password_changed_at)) {
        return next(new HttpError(401, 'Your password was changed. Sign in again.', { code: 'PASSWORD_CHANGED' }));
      }
      // A driver moved to another bus by the admin acts for the new bus at once.
      auth.busId = account.bus_id;
    }
    req.auth = auth;
    next();
  };
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
  if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  if (Buffer.byteLength(next, 'utf8') > MAX_PASSWORD_BYTES) throw new HttpError(400, `New password must be at most ${MAX_PASSWORD_BYTES} characters`);
  if (next === current) throw new HttpError(400, 'New password must be different from the current one');

  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
  if (!(await comparePassword(current, rows[0].password_hash))) {
    throw new HttpError(400, 'Current password is incorrect', { code: 'WRONG_PASSWORD' });
  }
  // This server's clock, whole seconds: the fresh token below (iat = now) is never older
  // than the change, even when a hosted database's clock differs from ours.
  const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db.query('UPDATE users SET password_hash = $2, password_changed_at = $3 WHERE id = $1', [userId, await hashPassword(next), changedAt]);
  const user = (await db.query(`${PROFILE_SELECT} WHERE u.id = $1`, [userId])).rows[0];
  return { token: issueToken(config, user), user: toProfile(user) };
}
