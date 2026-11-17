import { View } from 'react-native';
import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';
import { C, F } from '../theme.js';
import Icon from './Icon.js';
import { Text, Txt } from './ui.js';

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
  const off = today?.no_service;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: off ? C.danger50 : C.delayed50 }}>
      <Icon name="clock" size={18} color={off ? C.danger : C.delayed} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, ...F[600], fontSize: 14 }}>{today ? d.title : `${d.title} on ${date(d.day)}`}</Text>
        <Txt small muted>{dayText(d)}{d.note ? ` · ${d.note}` : ''}</Txt>
      </View>
    </View>
  );
}
