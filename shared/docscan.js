// Reading a bus document from its text (a PDF's text layer, or a photo after
// OCR): which document it is, its number, when it expires, and - for a service
// bill - the odometer reading and service date. Pure functions, no I/O, so the
// web app and the tests share them.
//
// Indian vehicle papers are not one format: insurers, RTOs and PUC centres all
// print their own. So this looks for the labels they have in common
// ("Policy No", "Valid upto", "Period of insurance ... to", "Odometer") and
// falls back to sensible guesses (the latest date is usually the expiry).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** What kind of paper it is, from the words on it. Order matters: a PUC page often says "insurance" in small print. */
const KINDS = [
  ['PUC', /pollution\s+under\s+control|\bP\.?\s?U\.?\s?C\b|emission\s+test|puc\s+certificate/i],
  ['FITNESS', /certificate\s+of\s+fitness|fitness\s+certificate|\bfitness\s+valid|form\s*38\b/i],
  ['PERMIT', /\bpermit\b(?!\s+holder\s+insurance)|contract\s+carriage|stage\s+carriage|educational\s+institution\s+bus/i],
  ['INSURANCE', /insurance|policy\s*(?:no|number|#)|insurer|premium|own\s+damage|third\s+party/i],
  ['SERVICE', /service\s+(?:invoice|bill|record|report)|job\s*card|repair\s+order|\bodometer\b|km\s+reading|kms?\s+run/i],
];

/** Labels before each kind's number. */
const NUMBER_LABELS = {
  INSURANCE: [/policy\s*(?:no|number|#)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{5,39})/i, /certificate\s*(?:no|number)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{5,39})/i],
  FITNESS: [/(?:certificate|fitness|fc)\s*(?:no|number)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{4,39})/i, /application\s*(?:no|number)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{4,39})/i],
  PERMIT: [/permit\s*(?:no|number)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{3,39})/i],
  PUC: [/(?:certificate|puc|puucc)\s*(?:sl\.?\s*)?(?:no|number)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{4,39})/i, /\bsl\.?\s*no\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-]{4,39})/i],
};

/** Labels that come before the expiry date. */
const EXPIRY_LABEL = /(valid\s*(?:up\s*)?(?:to|till|until|upto)|validity|expir(?:y|es|ation)(?:\s*date)?|date\s+of\s+expiry|due\s+date|valid\s+date|to\s+midnight\s+of|(?:period|cover)\s+of\s+insurance[^\n]{0,60}?\bto\b|\bto\b\s*[:\-]?)/i;

/** Every date in the text, with where it was found. Accepts 12/05/2027, 12-05-27, 12.05.2027, 12 May 2027, 12-May-2027, May 12, 2027, 2027-05-12. */
export function findDates(text) {
  const out = [];
  const add = (index, y, m, d) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return;
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return; // 31 February and the like
    out.push({ index, iso });
  };
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m.index, +m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) add(m.index, +m[3], +m[2], +m[1]);
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})\b/g)) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) add(m.index, +m[3], mo, +m[1]);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) add(m.index, +m[3], mo, +m[2]);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The expiry: the first date after an expiry label (within ~80 characters), else the latest date. */
export function findExpiry(text) {
  const dates = findDates(text);
  if (!dates.length) return null;
  const labelled = [];
  const re = new RegExp(EXPIRY_LABEL.source, 'gi');
  for (const m of text.matchAll(re)) {
    const end = m.index + m[0].length;
    const after = dates.find((d) => d.index >= end && d.index - end <= 80);
    if (after) labelled.push(after.iso);
  }
  // "Period of insurance 01/06/2026 to 31/05/2027": the later of the labelled dates.
  const pool = labelled.length ? labelled : dates.map((d) => d.iso);
  return pool.sort().at(-1);
}

/** Indian registration number, e.g. TN 22 AB 1234 -> TN22AB1234. */
export function findRegistration(text) {
  const m = text.match(/\b([A-Z]{2})[\s\-]?(\d{1,2})[\s\-]?([A-Z]{1,3})[\s\-]?(\d{3,4})\b/);
  return m ? `${m[1]}${m[2].padStart(2, '0')}${m[3]}${m[4]}` : null;
}

/** An odometer reading in km (service bills, job cards). */
export function findOdometer(text) {
  const m = text.match(/(?:odometer|odo|km\s*reading|kms?\s*(?:run|reading|done)?|mileage)\s*(?:reading)?\s*(?:in\s*km)?\s*[:.\-]?\s*(\d{1,3}(?:,\d{2,3})+|\d{3,7})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return n > 0 && n < 10_000_000 ? n : null;
}

/** The document's kind, number, dates and readings. `hint` forces the kind when the person chose it. */
export function readDocument(rawText, hint = null) {
  const text = String(rawText ?? '').replace(/[|]/g, ' ').replace(/[ \t]+/g, ' ');
  const kind = hint ?? KINDS.find(([, re]) => re.test(text))?.[0] ?? null;
  let number = null;
  for (const re of NUMBER_LABELS[kind] ?? []) {
    const m = text.match(re);
    if (m && /\d/.test(m[1])) { number = m[1].replace(/[.,;:]+$/, '').toUpperCase(); break; }
  }
  const result = { kind, number, registration: findRegistration(text) };
  if (kind === 'SERVICE') {
    const dates = findDates(text);
    result.odometerKm = findOdometer(text);
    result.serviceOn = dates.length ? dates.map((d) => d.iso).sort().at(-1) : null;
  } else {
    result.expiresOn = findExpiry(text);
    const odo = findOdometer(text);
    if (odo) result.odometerKm = odo;
  }
  const found = [result.number, result.expiresOn, result.odometerKm, result.serviceOn].filter(Boolean).length;
  result.confidence = !kind ? 'none' : found >= 2 ? 'high' : found === 1 ? 'partial' : 'low';
  return result;
}
