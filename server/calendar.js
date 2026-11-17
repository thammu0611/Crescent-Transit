// Holidays and special days. On a day with no service the app stays quiet:
// no boarding questions, attendance prompts, bus alerts or "another bus" offers.
// A special day can move the morning or evening timetable by some minutes.
import { HttpError } from './auth.js';
import { localDate } from './clock.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['HOLIDAY', 'EXAM', 'SPECIAL'];
const SHIFT_LIMIT = 240;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export class CalendarService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.cached = new Map(); // date -> { at, day }
    this.closedWeekdays = config.calendar?.closedWeekdays ?? [0];
  }

  /** The built-in day off for a weekly closed day (every Sunday), or null. */
  weeklyOff(date) {
    const weekday = weekdayOf(date);
    if (!this.closedWeekdays.includes(weekday)) return null;
    return {
      day: date, kind: 'HOLIDAY', title: DAY_NAMES[weekday], note: `Buses do not run on ${DAY_NAMES[weekday]}s`,
      no_service: true, morning_shift: 0, evening_shift: 0, weekly: true,
    };
  }

  async on(date) {
    const hit = this.cached.get(date);
    if (hit && Date.now() - hit.at < 60000) return hit.day;
    const { rows } = await this.db.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, title, note, no_service, morning_shift, evening_shift FROM special_days WHERE day = $1`,
      [date],
    );
    // A calendar entry wins; otherwise a weekly day off (Sunday) is a day with no buses.
    const day = rows[0] ?? this.weeklyOff(date);
    this.cached.set(date, { at: Date.now(), day });
    return day;
  }

  /** Today's entry, or null on an ordinary day. */
  today(now = Date.now()) {
    return this.on(localDate(new Date(now), this.config.timeZone));
  }

  /** Is the service off today? */
  async isPaused(now = Date.now()) {
    return Boolean((await this.today(now))?.no_service);
  }

  /** Minutes today's morning or evening timetable is moved by. */
  async shift(direction, now = Date.now()) {
    const day = await this.today(now);
    return (direction === 'DOWN' ? day?.evening_shift : day?.morning_shift) ?? 0;
  }

  /**
   * Today and what is coming, oldest first. The weekly days off (Sundays) of the next two weeks
   * are included, marked weekly: true, so a week's timetable shows them; the admin calendar hides them.
   */
  async upcoming(limit = 60, now = Date.now()) {
    const today = localDate(new Date(now), this.config.timeZone);
    const { rows } = await this.db.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, title, note, no_service, morning_shift, evening_shift
         FROM special_days WHERE day >= $1 ORDER BY day LIMIT $2`,
      [today, limit],
    );
    const listed = new Set(rows.map((r) => r.day));
    const weekly = [];
    for (let i = 0; i < 14; i += 1) {
      const date = addDays(today, i);
      const off = listed.has(date) ? null : this.weeklyOff(date);
      if (off) weekly.push(off);
    }
    return [...rows, ...weekly].sort((a, b) => a.day.localeCompare(b.day)).slice(0, limit + weekly.length);
  }

  async save(body = {}, actorId = null) {
    const day = String(body.day ?? '');
    if (!DATE_RE.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, 'day must be YYYY-MM-DD');
    const kind = String(body.kind ?? 'HOLIDAY');
    if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
    const title = String(body.title ?? '').trim().slice(0, 80);
    if (title.length < 2) throw new HttpError(400, 'Give the day a name');
    const shift = (v, name) => {
      const n = Number(v ?? 0);
      if (!Number.isInteger(n) || Math.abs(n) > SHIFT_LIMIT) throw new HttpError(400, `${name} must be whole minutes, up to ${SHIFT_LIMIT}`);
      return n;
    };
    const noService = body.noService === undefined ? kind === 'HOLIDAY' : Boolean(body.noService);
    const morning = noService ? 0 : shift(body.morningShift, 'Morning shift');
    const evening = noService ? 0 : shift(body.eveningShift, 'Evening shift');
    const { rows } = await this.db.query(
      `INSERT INTO special_days (day, kind, title, note, no_service, morning_shift, evening_shift, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (day) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, note = EXCLUDED.note, no_service = EXCLUDED.no_service,
         morning_shift = EXCLUDED.morning_shift, evening_shift = EXCLUDED.evening_shift, created_by = EXCLUDED.created_by
       RETURNING to_char(day, 'YYYY-MM-DD') AS day, kind, title, note, no_service, morning_shift, evening_shift`,
      [day, kind, title, body.note ? String(body.note).slice(0, 300) : null, noService, morning, evening, actorId],
    );
    this.cached.delete(day);
    return rows[0];
  }

  async remove(day) {
    const { rowCount } = await this.db.query('DELETE FROM special_days WHERE day = $1', [day]);
    this.cached.delete(day);
    if (!rowCount) throw new HttpError(404, 'That day is not on the calendar');
    return { ok: true };
  }
}
