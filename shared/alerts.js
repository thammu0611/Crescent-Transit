// A student's notifications, the same on the web and the phone: route alerts and
// notices, plus their own attendance marks from the last three days. What is read
// comes from the server (GET /api/me/alerts-read), so the count matches everywhere.

const DAY = 86400000;

/** Notices and the student's recent attendance marks, newest first. */
export function studentAlerts(list, records, methodText = {}, now = Date.now()) {
  const att = (records ?? [])
    .filter((r) => r.present && new Date(r.boarded_at).getTime() > now - 3 * DAY)
    .map((r) => ({
      id: `a${r.attendance_id}`,
      kind: 'ATTENDANCE',
      created_at: r.boarded_at,
      route_code: r.route_code,
      title: `Marked present · ${r.direction === 'DOWN' ? 'from' : 'to'} college`,
      message: `${methodText[r.method] ?? 'Checked in'} on ${String(r.fleet_code ?? '').replace('BSACIST-', 'Bus ')}.`,
    }));
  return [...(list ?? []), ...att].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** True when the notification is newer than "Mark all read" and was not opened since. */
export function isUnread(n, read) {
  if (!read) return false; // read state not loaded yet: show nothing as unread rather than guess
  const readAt = read.readAt ? new Date(read.readAt).getTime() : 0;
  return new Date(n.created_at).getTime() > readAt && !(read.readIds ?? []).includes(String(n.id));
}

export const unreadCount = (items, read) => (items ?? []).filter((n) => isUnread(n, read)).length;

/** The read state straight after marking, before the server answers. */
export function markedLocally(read, body) {
  if (body.all) return { readAt: new Date().toISOString(), readIds: [] };
  const ids = (read?.readIds ?? []).filter((x) => !body.ids.includes(x));
  return { readAt: read?.readAt ?? null, readIds: [...ids, ...body.ids] };
}
