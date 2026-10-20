// Freshness state machine, used by the server and the live map.
//   LIVE     fix is at most 30 s old   -> marker animates
//   DELAYED  fix is at most 2 min old  -> marker dimmed, "updated x s ago"
//   OFFLINE  older than 2 min          -> last seen time and place

export const DEFAULT_FRESHNESS = { liveSeconds: 30, delayedSeconds: 120 };

export function freshnessOf(recordedAt, now = Date.now(), limits = DEFAULT_FRESHNESS) {
  if (!recordedAt) return 'offline';
  const ageS = (now - new Date(recordedAt).getTime()) / 1000;
  if (ageS <= limits.liveSeconds) return 'live';
  if (ageS <= limits.delayedSeconds) return 'delayed';
  return 'offline';
}

export function ageLabel(recordedAt, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
