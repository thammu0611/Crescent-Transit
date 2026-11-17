// Incidents in plain words, for the website and the phone app alike: the kind as a
// short name, the message as a sentence, and who raised it.

const KIND = {
  TRACKER_OFFLINE: 'Tracker offline',
  CAPACITY_BREACH: 'Over capacity',
  OVERCROWDING: 'Overcrowded',
  SPEEDING: 'Speeding',
  MOCK_LOCATION: 'Fake location',
  ATTENDANCE_CONFLICT: 'Attendance conflict',
  SOS: 'SOS',
  EMERGENCY: 'Emergency',
  BREAKDOWN: 'Breakdown',
  DELAY: 'Delay',
  LATE: 'Running late',
  FUEL: 'Fuel',
  REPLACEMENT: 'Replacement bus',
  TIMETABLE: 'Timetable',
};

/** "TRACKER_OFFLINE" -> "Tracker offline"; unknown codes in sentence case. */
export function incidentKind(kind) {
  if (!kind) return 'Incident';
  if (KIND[kind]) return KIND[kind];
  const words = String(kind).replace(/_/g, ' ').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

// What an automatic flag on a trip means, as a sentence.
const FLAG = {
  TRACKER_OFFLINE: (trip) => `The GPS tracker stopped sending during trip ${trip}.`,
  CAPACITY_BREACH: (trip) => `More students boarded than the bus has seats on trip ${trip}.`,
};

/** The incident's message as a sentence (older automatic flags read "Trip 688 flagged: TRACKER_OFFLINE"). */
export function incidentMessage(incident) {
  const text = incident?.message;
  if (!text) return 'No details given';
  const flagged = /^Trip (\d+) flagged: ([A-Z_]+)$/.exec(text);
  if (!flagged) return text;
  const [, trip, reason] = flagged;
  return FLAG[reason] ? FLAG[reason](trip) : `${incidentKind(reason)} on trip ${trip}.`;
}

/** Who raised it: "Automatic", or "Driver · drv118". */
export function incidentSource(incident) {
  if (!incident?.source || incident.source === 'system') return 'Automatic';
  const who = incident.source[0].toUpperCase() + incident.source.slice(1);
  return incident.username ? `${who} · ${incident.username}` : who;
}

/** The message the server stores when it flags a trip. */
export function flagMessage(tripId, reason) {
  return FLAG[reason] ? FLAG[reason](tripId) : `${incidentKind(reason)} on trip ${tripId}.`;
}
