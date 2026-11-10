// The transport office's yearly work: upload the student list, load next year's
// route circular, and remove those who have left. Every upload is previewed
// first; nothing changes until the administrator confirms.
import { HttpError } from './auth.js';
import { clockMinutes } from './alternatives.js';
import { anonymiseUser, unusablePassword } from './privacy.js';
import { audit, parseCsv } from './util.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pick = (row, ...names) => {
  for (const n of names) if (row[n]) return row[n];
  return '';
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const usernameFor = (registerNo) => registerNo.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);

export class RosterService {
  constructor(db, config, { tracking }) {
    this.db = db;
    this.config = config;
    this.tracking = tracking;
  }

  async stopsByRoute() {
    const { rows } = await this.db.query(
      `SELECT r.id AS route_id, r.code, s.seq, s.name FROM routes r LEFT JOIN stops s ON s.route_id = r.id WHERE r.active`,
    );
    const map = new Map();
    for (const r of rows) {
      const key = norm(r.code);
      if (!map.has(key)) map.set(key, { id: r.route_id, code: r.code, stops: new Map() });
      if (r.name) map.get(key).stops.set(norm(r.name), r.seq);
    }
    return map;
  }

  /**
   * Students from a CSV: register_no, full_name, email, and optionally
   * department, phone, route, stop, graduation_year. A student already known by
   * register number or email is updated; a password is never set or changed.
   * New students choose their own with "Forgot password" on their university email.
   */
  async importStudents({ csv, commit = false }, actorId) {
    const rows = parseCsv(String(csv ?? ''));
    if (!rows.length) throw new HttpError(400, 'The file has no student rows');
    const routes = await this.stopsByRoute();
    const { rows: known } = await this.db.query(
      `SELECT id, lower(register_no) AS register_no, lower(email) AS email, lower(username) AS username, role
         FROM users WHERE status <> 'deleted'`,
    );
    const byRegister = new Map(known.filter((u) => u.register_no).map((u) => [u.register_no, u]));
    const byEmail = new Map(known.filter((u) => u.email).map((u) => [u.email, u]));
    const usernames = new Set(known.map((u) => u.username));
    const seen = new Set();
    const plan = rows.map((row, i) => {
      const line = i + 2;
      const registerNo = pick(row, 'register_no', 'register number', 'register no', 'regno', 'roll_no');
      const fullName = pick(row, 'full_name', 'name', 'student name');
      const email = pick(row, 'email', 'university email').toLowerCase();
      const routeCode = pick(row, 'route', 'route_code', 'route no');
      const stopName = pick(row, 'stop', 'stop_name', 'boarding point');
      const yearText = pick(row, 'graduation_year', 'graduation year', 'pass out year', 'batch');
      const problems = [];
      const warnings = [];
      if (!registerNo) problems.push('Register number is missing');
      if (fullName.length < 2) problems.push('Name is missing');
      if (!EMAIL_RE.test(email)) problems.push('Email is not valid');
      const id = norm(registerNo);
      if (id && seen.has(id)) problems.push('This register number appears twice in the file');
      seen.add(id);
      const graduationYear = yearText ? Number(yearText) : null;
      if (yearText && !(Number.isInteger(graduationYear) && graduationYear >= 2000 && graduationYear <= 2100)) problems.push('Graduation year is not a year');
      const route = routeCode ? routes.get(norm(routeCode)) : null;
      if (routeCode && !route) problems.push(`Route ${routeCode} does not exist`);
      const stopSeq = route && stopName ? route.stops.get(norm(stopName)) ?? null : null;
      if (route && stopName && stopSeq === null) warnings.push(`Stop "${stopName}" is not on route ${route.code}; the student can choose it later`);
      const existing = byRegister.get(id) ?? byEmail.get(email) ?? null;
      if (existing && existing.role !== 'student') problems.push('This email belongs to a staff or parent account');
      const otherOwner = byEmail.get(email);
      if (existing && otherOwner && otherOwner.id !== existing.id) problems.push('This email already belongs to another student');
      const username = usernameFor(registerNo);
      if (!existing && username.length < 3) problems.push('Register number is too short to be a username');
      if (!existing && usernames.has(username)) problems.push('A different account already uses this register number as username');
      return {
        line, registerNo, fullName, email, department: pick(row, 'department', 'dept').slice(0, 40) || null,
        phone: pick(row, 'phone', 'mobile').slice(0, 20) || null, routeId: route?.id ?? null, stopSeq, graduationYear, username,
        existingId: existing?.id ?? null, action: problems.length ? 'skip' : existing ? 'update' : 'create', problems, warnings,
      };
    });
    const summary = {
      total: plan.length,
      create: plan.filter((p) => p.action === 'create').length,
      update: plan.filter((p) => p.action === 'update').length,
      skip: plan.filter((p) => p.action === 'skip').length,
      warnings: plan.filter((p) => p.warnings.length).length,
    };
    const issues = plan.filter((p) => p.problems.length || p.warnings.length).slice(0, 100)
      .map((p) => ({ line: p.line, name: p.fullName || p.registerNo, problems: p.problems, warnings: p.warnings }));
    if (!commit) return { committed: false, summary, issues };

    const hash = await unusablePassword();
    await this.db.transaction(async (tx) => {
      for (const p of plan) {
        if (p.action === 'create') {
          await tx.query(
            `INSERT INTO users (username, password_hash, full_name, role, email, email_verified_at, department, register_no, phone, home_route_id, home_stop_seq, graduation_year)
             VALUES ($1, $2, $3, 'student', $4, now(), $5, $6, $7, $8, $9, $10)`,
            [p.username, hash, p.fullName, p.email, p.department, p.registerNo, p.phone, p.routeId, p.stopSeq, p.graduationYear],
          );
        } else if (p.action === 'update') {
          await tx.query(
            `UPDATE users SET full_name = $2, email = $3, register_no = $4,
                    department = COALESCE($5, department), phone = COALESCE($6, phone),
                    home_route_id = COALESCE($7, home_route_id), home_stop_seq = CASE WHEN $7::int IS NULL THEN home_stop_seq ELSE $8 END,
                    graduation_year = COALESCE($9, graduation_year)
              WHERE id = $1`,
            [p.existingId, p.fullName, p.email, p.registerNo, p.department, p.phone, p.routeId, p.stopSeq, p.graduationYear],
          );
        }
      }
    });
    await audit(this.db, { actorId, action: 'STUDENTS_IMPORTED', entity: 'users', detail: summary });
    return { committed: true, summary, issues };
  }

  /**
   * Next year's route circular from a CSV with one row per stop: route,
   * route_name, stop_name, time (6.15 AM), lat, lng; in travel order. A stop
   * keeping its name keeps its record, and students follow their stop by name.
   */
  async importRoutes({ csv, commit = false, retireMissing = false }, actorId) {
    const rows = parseCsv(String(csv ?? ''));
    if (!rows.length) throw new HttpError(400, 'The file has no stop rows');
    const groups = new Map();
    const problems = [];
    rows.forEach((row, i) => {
      const line = i + 2;
      const code = pick(row, 'route', 'route_code', 'route no');
      const name = pick(row, 'stop_name', 'stop', 'boarding point');
      const time = pick(row, 'time', 'arrival_time', 'scheduled_time');
      const lat = Number(pick(row, 'lat', 'latitude'));
      const lng = Number(pick(row, 'lng', 'longitude', 'long'));
      if (!code) return problems.push({ line, problem: 'Route is missing' });
      if (!name) return problems.push({ line, problem: 'Stop name is missing' });
      if (clockMinutes(time) === null) return problems.push({ line, problem: `Time "${time}" is not like 6.15 AM` });
      if (!groups.has(code)) groups.set(code, { code, name: pick(row, 'route_name', 'name') || null, stops: [] });
      groups.get(code).stops.push({ line, name, time, lat: Number.isFinite(lat) && lat !== 0 ? lat : null, lng: Number.isFinite(lng) && lng !== 0 ? lng : null });
      return undefined;
    });
    const { rows: current } = await this.db.query(
      `SELECT r.id, r.code, r.active, s.id AS stop_id, s.name, s.seq, s.lat, s.lng
         FROM routes r LEFT JOIN stops s ON s.route_id = r.id ORDER BY r.id, s.seq`,
    );
    const routes = new Map();
    for (const r of current) {
      if (!routes.has(r.code)) routes.set(r.code, { id: r.id, active: r.active, stops: [] });
      if (r.stop_id) routes.get(r.code).stops.push({ id: r.stop_id, name: r.name, seq: r.seq, lat: r.lat, lng: r.lng });
    }
    const { rows: students } = await this.db.query(
      `SELECT u.id, u.home_route_id, s.name AS stop_name
         FROM users u LEFT JOIN stops s ON s.route_id = u.home_route_id AND s.seq = u.home_stop_seq
        WHERE u.role = 'student' AND u.status = 'active' AND u.home_route_id IS NOT NULL`,
    );
    const changes = [];
    for (const group of groups.values()) {
      const old = routes.get(group.code);
      const oldByName = new Map((old?.stops ?? []).map((s) => [norm(s.name), s]));
      for (const s of group.stops) {
        const match = oldByName.get(norm(s.name));
        s.existing = match ?? null;
        s.lat ??= match?.lat ?? null;
        s.lng ??= match?.lng ?? null;
        if (s.lat === null || s.lng === null) problems.push({ line: s.line, problem: `New stop "${s.name}" needs lat and lng` });
      }
      const newNames = new Set(group.stops.map((s) => norm(s.name)));
      const onRoute = students.filter((u) => u.home_route_id === old?.id);
      const lost = onRoute.filter((u) => u.stop_name && !newNames.has(norm(u.stop_name))).length;
      changes.push({
        code: group.code, action: old ? 'update' : 'new', stops: group.stops.length,
        added: group.stops.filter((s) => !s.existing).length,
        removed: (old?.stops ?? []).filter((s) => !newNames.has(norm(s.name))).length,
        students: onRoute.length, studentsToReassign: lost,
      });
    }
    const missing = [...routes.entries()].filter(([code, r]) => r.active && !groups.has(code)).map(([code, r]) => ({
      code, students: students.filter((u) => u.home_route_id === r.id).length,
    }));
    const summary = { routes: groups.size, new: changes.filter((c) => c.action === 'new').length, notInFile: missing.length, problems: problems.length };
    if (!commit || problems.length) {
      if (commit) throw new HttpError(400, 'Fix the problems in the file first', { problems: problems.slice(0, 100), summary });
      return { committed: false, summary, changes, missing, problems: problems.slice(0, 100) };
    }
    const running = await this.db.query(`SELECT count(*)::int AS n FROM trips WHERE status = 'active'`);
    if (running.rows[0].n) throw new HttpError(409, 'Buses are running. Load the new circular when all trips have ended.');

    await this.db.transaction(async (tx) => {
      for (const group of groups.values()) {
        const first = group.stops[0];
        const last = group.stops.at(-1);
        const start = clockMinutes(first.time);
        const duration = Math.max(0, clockMinutes(last.time) - start);
        const old = routes.get(group.code);
        let routeId = old?.id;
        if (routeId) {
          await tx.query(
            `UPDATE routes SET name = COALESCE($2, name), start_point = $3, departure_time = $4, duration_minutes = $5, active = TRUE WHERE id = $1`,
            [routeId, group.name, first.name, first.time, duration],
          );
        } else {
          routeId = (await tx.query(
            `INSERT INTO routes (code, name, start_point, end_point, departure_time, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [group.code, group.name ?? first.name, first.name, this.config.institution.shortName, first.time, duration],
          )).rows[0].id;
        }
        // Stops are renumbered clear of the new order first: (route, seq) is unique.
        await tx.query('UPDATE stops SET seq = seq + 100000 WHERE route_id = $1', [routeId]);
        const kept = new Set();
        for (const [i, s] of group.stops.entries()) {
          const offset = Math.max(0, clockMinutes(s.time) - start);
          if (s.existing) {
            kept.add(s.existing.id);
            await tx.query(
              'UPDATE stops SET seq = $2, name = $3, lat = $4, lng = $5, scheduled_time = $6, offset_minutes = $7 WHERE id = $1',
              [s.existing.id, i + 1, s.name, s.lat, s.lng, s.time, offset],
            );
          } else {
            await tx.query(
              `INSERT INTO stops (route_id, seq, name, lat, lng, scheduled_time, offset_minutes, geo_source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'circular')`,
              [routeId, i + 1, s.name, s.lat, s.lng, s.time, offset],
            );
          }
        }
        const gone = (old?.stops ?? []).filter((s) => !kept.has(s.id)).map((s) => s.id);
        if (gone.length) {
          // Past attendance keeps the trip and time; only its link to the retired stop goes.
          await tx.query('UPDATE attendance SET boarding_stop_id = NULL WHERE boarding_stop_id = ANY($1::int[])', [gone]);
          await tx.query('UPDATE attendance SET alighting_stop_id = NULL WHERE alighting_stop_id = ANY($1::int[])', [gone]);
          await tx.query('DELETE FROM stops WHERE id = ANY($1::int[])', [gone]);
        }
        // Students follow their stop by name; anyone whose stop has gone picks a new one.
        const names = new Map(group.stops.map((s, i) => [norm(s.name), i + 1]));
        for (const u of students.filter((x) => x.home_route_id === routeId)) {
          await tx.query('UPDATE users SET home_stop_seq = $2 WHERE id = $1', [u.id, u.stop_name ? names.get(norm(u.stop_name)) ?? null : null]);
        }
      }
      if (retireMissing) {
        for (const { code } of missing) {
          const { id } = routes.get(code);
          await tx.query('UPDATE routes SET active = FALSE WHERE id = $1', [id]);
          await tx.query('UPDATE users SET home_route_id = NULL, home_stop_seq = NULL WHERE home_route_id = $1', [id]);
          await tx.query('UPDATE buses SET route_id = NULL WHERE route_id = $1', [id]);
        }
      }
    });
    await this.tracking.reloadStops();
    await audit(this.db, { actorId, action: 'ROUTES_IMPORTED', entity: 'routes', detail: { ...summary, retireMissing } });
    return { committed: true, summary, changes, missing, problems: [] };
  }

  /** How many students finish in each year, for the end-of-year screen. */
  async summary() {
    const { rows } = await this.db.query(
      `SELECT graduation_year, status, count(*)::int AS n FROM users
        WHERE role = 'student' AND status IN ('active', 'graduated', 'suspended')
        GROUP BY 1, 2 ORDER BY 1 NULLS LAST`,
    );
    return rows;
  }

  /**
   * End of the year. Students finishing by `graduationYear` either stop being
   * able to sign in ('deactivate', their records stay) or are removed the same
   * way as a deleted account ('delete').
   */
  async rollover({ graduationYear, action = 'deactivate', commit = false }, actorId) {
    const year = Number(graduationYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Give the graduation year');
    if (!['deactivate', 'delete'].includes(action)) throw new HttpError(400, 'Choose deactivate or delete');
    const statuses = action === 'delete' ? ['active', 'suspended', 'graduated'] : ['active', 'suspended'];
    const { rows } = await this.db.query(
      `SELECT id FROM users WHERE role = 'student' AND graduation_year <= $1 AND status = ANY($2::text[])`,
      [year, statuses],
    );
    if (!commit) return { committed: false, students: rows.length, action, graduationYear: year };
    if (action === 'deactivate') {
      await this.db.query(`UPDATE users SET status = 'graduated' WHERE id = ANY($1::int[])`, [rows.map((r) => r.id)]);
      await this.db.query('DELETE FROM push_tokens WHERE user_id = ANY($1::int[])', [rows.map((r) => r.id)]);
    } else {
      const hash = await unusablePassword();
      await this.db.transaction(async (tx) => {
        for (const { id } of rows) await anonymiseUser(tx, id, hash);
      });
    }
    await audit(this.db, { actorId, action: 'YEAR_ROLLOVER', entity: 'users', detail: { graduationYear: year, action, students: rows.length } });
    return { committed: true, students: rows.length, action, graduationYear: year };
  }
}
