import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import Icon from './Icon.jsx';

const moved = (min) => `${Math.abs(min)} min ${min > 0 ? 'later' : 'earlier'}`;

/** What today's timetable change says in words. */
export function dayText(d) {
  if (d.no_service) return 'No buses today';
  const parts = [];
  if (d.morning_shift) parts.push(`Morning buses run ${moved(d.morning_shift)}`);
  if (d.evening_shift) parts.push(`Evening buses run ${moved(d.evening_shift)}`);
  return parts.join('. ') || 'Buses run as usual';
}

/** A holiday or special day, today or coming up within a week. */
export default function DayBanner() {
  const cal = useAsync(() => api('/api/calendar'), []);
  const today = cal.data?.today;
  const soon = cal.data?.upcoming?.find((d) => !d.weekly && d.day !== today?.day && Date.parse(d.day) - Date.now() < 7 * 86400000);
  const d = today ?? soon;
  if (!d) return null;
  return (
    <div className={`day-banner${today?.no_service ? ' off' : ''}`} role="status">
      <Icon name="clock" size={18} />
      <span>
        <b>{today ? d.title : `${d.title} on ${date(d.day)}`}</b>
        <small>{dayText(d)}{d.note ? ` · ${d.note}` : ''}</small>
      </span>
    </div>
  );
}
