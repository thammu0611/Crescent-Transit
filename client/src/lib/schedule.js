// Timetable helpers. The BSACIST circular prints times as "6.15 AM".

const TZ = 'Asia/Kolkata';

/** "6.15 AM" / "06:15 PM" -> minutes after midnight, or null. */
export function parseTime(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2})[.:](\d{2})\s*([AP])\.?M\.?$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return h * 60 + Number(m[2]);
}

/** minutes -> "07:25 AM" */
export function formatMinutes(min) {
  if (min == null) return '—';
  const h24 = Math.floor(min / 60) % 24;
  const h = h24 % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function prettyTime(text) {
  const m = parseTime(text);
  return m == null ? text ?? '—' : formatMinutes(m);
}

/** Minutes after midnight now, campus time. */
export function nowMinutes() {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
  return h * 60 + m;
}

/**
 * The two daily runs for a student: morning from their stop to campus, and
 * the evening run from campus. `next` marks whichever is still ahead today.
 */
export function dailyRuns(route, stopSeq) {
  if (!route) return [];
  const stop = route.stops.find((s) => s.seq === stopSeq) ?? route.stops[0];
  const morning = parseTime(stop?.scheduled_time);
  const evening = parseTime(route.evening_departure);
  const now = nowMinutes();
  const runs = [
    { key: 'am', label: `${stop?.name ?? route.start_point} → Campus`, minutes: morning },
    { key: 'pm', label: `Campus → ${stop?.name ?? route.start_point}`, minutes: evening },
  ];
  const next = runs.find((r) => r.minutes != null && r.minutes >= now);
  return runs.map((r) => ({ ...r, next: r === next, done: r.minutes != null && r.minutes < now }));
}

export const greeting = () => {
  const h = Math.floor(nowMinutes() / 60);
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const longDate = () =>
  new Date().toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
