// Display helpers, same output as the web app's lib/format.js. Campus time is
// IST (UTC+5:30, no daylight saving); it is computed directly rather than
// through Intl time zones, which differ between Android and iOS engines.
const IST_MS = 330 * 60000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

/** Wall-clock parts of a moment in campus time. */
export function ist(v = Date.now()) {
  const d = new Date(new Date(v).getTime() + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), wd: d.getUTCDay() };
}

const clock = (h, min) => `${pad(h % 12 || 12)}:${pad(min)} ${h < 12 ? 'am' : 'pm'}`;

/** Indian grouping: 1,23,456 */
function groupIN(n) {
  const [int, dec] = String(n).split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (rest ? `${rest},${last3}` : last3) + (dec ? `.${dec}` : '');
}

export const rupees = (paise) => {
  if (paise == null) return '—';
  const abs = Math.abs(paise);
  const value = abs % 100 ? (abs / 100).toFixed(2) : String(abs / 100);
  return `${paise < 0 ? '−' : ''}₹${groupIN(value)}`;
};

export const dateTime = (v) => {
  if (!v) return '—';
  const p = ist(v);
  return `${pad(p.d)} ${MONTHS[p.m]}, ${clock(p.h, p.min)}`;
};

export const date = (v) => {
  if (!v) return '—';
  const p = ist(v);
  return `${pad(p.d)} ${MONTHS[p.m]} ${p.y}`;
};

export const time = (v) => {
  if (!v) return '—';
  const p = ist(v);
  return clock(p.h, p.min);
};

export const isoDay = (v = Date.now()) => {
  const p = ist(v);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
};
export const thisMonth = () => isoDay().slice(0, 7);
export const today = () => isoDay();
export const daysAgo = (n) => isoDay(Date.now() - n * 86400000);

/** "2026-10" -> "October 2026" */
export const monthName = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${LONG_MONTHS[mo - 1]} ${y}`;
};
export const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export const longDate = () => {
  const p = ist();
  return `${DAYS[p.wd]}, ${pad(p.d)} ${LONG_MONTHS[p.m]} ${p.y}`;
};

export const STATUS_TEXT = {
  PROMPTED: 'Awaiting your answer',
  CONFIRMED: 'Confirmed',
  ON_BOARD: 'On board',
  COMPLETED: 'Completed',
  PROVISIONAL: 'Provisional',
  REJECTED: 'You said No',
  VOID: 'Voided',
  DISPUTED: 'Disputed',
  ADJUSTED: 'Adjusted',
};

/** How a record was taken. */
export const METHOD_TEXT = { GPS: 'Phone GPS', QR: 'Bus QR code', MANUAL: 'Marked by staff', BEACON: 'Beacon', STOP: 'Boarding check' };

export const OCCUPANCY = {
  SEATS_FREE: { label: 'Seats free', tone: 'live' },
  STANDING: { label: 'Standing', tone: 'delayed' },
  FULL: { label: 'Full', tone: 'danger' },
};

export function etaText(eta) {
  if (!eta) return 'No estimate';
  if (eta.passed) return 'Already passed';
  if (eta.high <= 1) return 'Arriving';
  return `${eta.low}–${eta.high} min`;
}
