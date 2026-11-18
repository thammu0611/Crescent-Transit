import { useMemo } from 'react';
import { studentAlerts, unreadCount } from '../../../shared/alerts.js';
import { useAlertsRead } from '../lib/alertsRead.js';
import { api } from '../lib/api.js';
import { thisMonth } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { useAsync } from '../lib/useAsync.js';
import { usePolling } from '../lib/usePolling.js';
import Icon from './Icon.jsx';

const METHOD = { GPS: 'Phone GPS', QR: 'Bus QR code', MANUAL: 'Marked by staff', BEACON: 'Beacon', STOP: 'Boarding check' };

/**
 * The student's bell, with how many notifications are unread: the same list and the
 * same read marks as the Notifications page, so marking them read clears it at once.
 */
export default function AlertsBell() {
  const { token, entitlement } = useSession();
  const entitled = Boolean(entitlement?.active);
  const list = useAsync(() => (entitled ? api('/api/notifications', { token }) : api('/api/notices')), [token, entitled]);
  const marks = useAsync(() => (entitled ? api(`/api/attendance/me?month=${thisMonth()}`, { token }) : Promise.resolve(null)), [token, entitled]);
  usePolling(() => { list.reload(); marks.reload(); }, 60000);
  const read = useAlertsRead(token);
  const all = useMemo(() => studentAlerts(list.data, marks.data?.records, METHOD), [list.data, marks.data]);
  const n = unreadCount(all, read);
  return (
    <a className="bell" href="#/alerts" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}>
      <Icon name="bell" size={20} />
      {n > 0 && <span className="dot-count">{n > 99 ? '99+' : n}</span>}
    </a>
  );
}
