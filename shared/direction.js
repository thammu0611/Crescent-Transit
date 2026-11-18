// The two runs of a route, kept apart everywhere: attendance, stops, ETA, reports.
//
//   UP    boarding point -> college   (morning, stops in seq order)
//   DOWN  college -> boarding point   (evening, stops in reverse order)
export const UP = 'UP';
export const DOWN = 'DOWN';
export const DIRECTIONS = [UP, DOWN];

// What people read. UP and DOWN stay the stored values; the app always says these.
// Plain words for the two runs: "To college" and "From college" (not Inbound and Outbound).
export const DIRECTION_NAME = { UP: 'To college', DOWN: 'From college' };
export const DIRECTION_TEXT = DIRECTION_NAME;
export const DIRECTION_PATH = { UP: 'Boarding point to college', DOWN: 'College to boarding point' };

/** The route's stops in the order this run reaches them. */
export const travelOrder = (stops, direction) => (direction === DOWN ? [...stops].reverse() : stops);

const walkText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Two lines about another bus a student can take (server/alternatives.js). */
export function describeOption(o) {
  if (o.direction === DOWN) return [`At the college now, board there`, `Get off at ${o.getOffStop}, ${walkText(o.walkM)} from your stop`];
  return [`Board at ${o.boardStop}, ${walkText(o.walkM)} from your stop`, `Arrives in ${o.eta.low}-${o.eta.high} min`];
}
