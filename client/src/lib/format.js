const TZ = 'Asia/Kolkata';

export const rupees = (paise) =>
  paise == null
    ? '—'
    : `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const dateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const time = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—');

export const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

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
