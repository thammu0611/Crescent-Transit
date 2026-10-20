// Campus-local dates and times. Subscription validity, registers and travel
// windows are all defined in campus time, whatever zone the server runs in.

function parts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** 'YYYY-MM-DD' of `date` in the campus time zone. */
export function localDate(date, timeZone) {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes since local midnight, 0..1439. */
export function localMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** 'YYYY-MM' of `date` in the campus time zone. */
export const localMonth = (date, timeZone) => localDate(date, timeZone).slice(0, 7);

/** Add whole days to a 'YYYY-MM-DD' string. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b ('YYYY-MM-DD'). */
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

/** Normalise a DATE column value (Date or string) to 'YYYY-MM-DD'. */
export function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** First and last day of a 'YYYY-MM' month. */
export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) return null;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
