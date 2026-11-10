// Fixed lists shared by the server, the web app and the phone app.

/** What a student can say about a trip. */
export const FEEDBACK_TAGS = [
  ['LATE', 'Late'],
  ['CROWDED', 'Crowded'],
  ['RASH_DRIVING', 'Rash driving'],
  ['AC_NOT_WORKING', 'AC not working'],
  ['NOT_CLEAN', 'Not clean'],
  ['STAFF', 'Staff behaviour'],
  ['OTHER', 'Something else'],
];
export const FEEDBACK_TEXT = Object.fromEntries(FEEDBACK_TAGS);

/** The driver's check before a trip. */
export const CHECKLIST_ITEMS = [
  ['TYRES', 'Tyres'],
  ['FUEL', 'Fuel'],
  ['BRAKES', 'Brakes'],
  ['LIGHTS', 'Lights and indicators'],
  ['FIRST_AID', 'First-aid kit'],
  ['FIRE_EXTINGUISHER', 'Fire extinguisher'],
  ['CLEAN', 'Bus is clean'],
];
export const CHECKLIST_TEXT = Object.fromEntries(CHECKLIST_ITEMS);

export const REQUEST_TEXT = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', CANCELLED: 'Cancelled' };
export const LOST_STATUS_TEXT = { OPEN: 'Open', RETURNED: 'Returned', CLOSED: 'Closed' };
export const PASS_PREFIX = 'CTPASS:';
export const DAY_KIND_TEXT = { HOLIDAY: 'Holiday', EXAM: 'Exam day', SPECIAL: 'Special day' };

/** How a child's trip reads to a parent. */
export const CHILD_STATUS_TEXT = {
  NOT_YET: 'Not boarded yet',
  ON_BOARD: 'On the bus',
  REACHED: 'Reached',
  WAITING: 'Being confirmed',
};
