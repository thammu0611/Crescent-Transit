// Building blocks shared by the transport office screens (dashboard, trips,
// attendance, reports): simple charts drawn with views and SVG, an aligned
// table, filter chips and a full-screen detail view. They sit on top of
// ui.js and the theme, so they look like the rest of the app.
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { C, F, R, shadow } from '../theme.js';
import Icon from './Icon.js';
import { Empty, Screen, Sheen, Skeleton, Text, Txt } from './ui.js';

/** Series colours: navy, gold, emerald, crimson, slate, sky - readable on white. */
export const SERIES = [C.navy, C.gold, C.emerald, C.red, C.slate, '#6b8fc7'];

const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Vertical bars with the value on top and the label underneath, evenly spaced. */
export function ColumnChart({ data, height = 140, color = C.navy, highlightLast = true, format = compact }) {
  if (data == null) return <Skeleton height={height + 36} />;
  if (!data.length) return <Empty icon="chart">No data in this period.</Empty>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 4 }} accessibilityRole="image" accessibilityLabel={data.map((d) => `${d.label} ${d.value}`).join(', ')}>
      {data.map((d, i) => {
        const on = highlightLast && i === data.length - 1;
        return (
          <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 11, ...F[700], color: on ? color : C.muted, fontVariant: ['tabular-nums'] }}>{format(d.value)}</Text>
            <View style={{ height, width: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
              <View style={{ width: '62%', maxWidth: 28, minHeight: 3, height: `${Math.max(2, (d.value / max) * 100)}%`, borderRadius: 6, backgroundColor: on ? color : `${color}55` }} />
            </View>
            <Text style={{ fontSize: 10.5, color: C.muted, ...F[600] }} numberOfLines={1}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** A ring split into segments, with a figure in the middle and the legend beside it. */
export function Donut({ segments, size = 128, thickness = 16, center, caption }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.line2} strokeWidth={thickness} fill="none" />
          {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * circ;
            const el = (
              <Circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={s.color}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24, ...F.display, color: C.ink }}>{center ?? total}</Text>
          {caption ? <Text style={{ fontSize: 10.5, color: C.muted, ...F[600], letterSpacing: 0.6, textTransform: 'uppercase' }}>{caption}</Text> : null}
        </View>
      </View>
      <Legend items={segments} total={total} />
    </View>
  );
}

export function Legend({ items, total }) {
  return (
    <View style={{ flex: 1, gap: 9 }}>
      {items.map((s) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
          <Txt small style={{ flex: 1 }} numberOfLines={1}>{s.label}</Txt>
          <Txt small bold style={{ fontVariant: ['tabular-nums'] }}>{s.value}</Txt>
          {total ? <Txt small muted style={{ width: 38, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{Math.round((s.value / total) * 100)}%</Txt> : null}
        </View>
      ))}
    </View>
  );
}

/** Horizontal bars: label and value on one line, the bar underneath. */
export function HBars({ rows, label, value, unit = '', color = C.navy, max }) {
  if (rows == null) return <Skeleton height={120} />;
  if (!rows.length) return <Empty icon="chart">No data in this period.</Empty>;
  const top = max ?? Math.max(1, ...rows.map(value));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt small style={{ flex: 1 }} numberOfLines={1}>{label(r)}</Txt>
            <Txt small bold style={{ fontVariant: ['tabular-nums'] }}>{value(r)}{unit}</Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line2, overflow: 'hidden' }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: i === 0 ? color : `${color}aa`, width: `${Math.max(2, (value(r) / top) * 100)}%` }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * An aligned table: a header row and fixed columns. `columns` are
 * { key, label, flex = 1, align = 'left', render(row) }. With `minWidth`
 * the table scrolls sideways on narrow phones instead of squashing.
 */
export function Table({ columns, rows, keyOf = (r, i) => r.id ?? i, onRowPress, empty = 'Nothing to show.', minWidth }) {
  if (rows == null) return <View style={{ gap: 8 }}><Skeleton height={36} /><Skeleton height={36} /><Skeleton height={36} /></View>;
  if (!rows.length) return <Empty icon="list">{empty}</Empty>;
  const cell = (col) => ({ flex: col.flex ?? 1, paddingHorizontal: 6, alignItems: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start' });
  const body = (
    <View style={[{ borderRadius: R.md, borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden' }, minWidth ? { minWidth } : { width: '100%' }]}>
      <View style={{ flexDirection: 'row', backgroundColor: C.navy50, paddingVertical: 10, paddingHorizontal: 6 }}>
        {columns.map((col) => (
          <View key={col.key} style={cell(col)}>
            <Text style={{ fontSize: 10.5, ...F[700], color: C.navy, letterSpacing: 0.8, textTransform: 'uppercase' }} numberOfLines={1}>{col.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, i) => {
        const rowStyle = { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6, backgroundColor: i % 2 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.55)', borderTopWidth: 1, borderTopColor: C.line2 };
        const Wrap = onRowPress ? Pressable : View;
        return (
          <Wrap
            key={keyOf(row, i)}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
            style={onRowPress ? ({ pressed }) => [rowStyle, pressed && { opacity: 0.7 }] : rowStyle}
          >
            {columns.map((col) => {
              const v = col.render ? col.render(row) : row[col.key];
              return (
                <View key={col.key} style={cell(col)}>
                  {typeof v === 'string' || typeof v === 'number' || v == null
                    ? <Text style={{ fontSize: 13, color: C.ink, textAlign: col.align ?? 'left', fontVariant: ['tabular-nums'], ...(col.bold ? F[600] : null) }} numberOfLines={2}>{v ?? '—'}</Text>
                    : v}
                </View>
              );
            })}
          </Wrap>
        );
      })}
    </View>
  );
  return minWidth ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{body}</ScrollView> : body;
}

/** Small pill filters that scroll sideways. */
export function Chips({ value, onChange, options }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: on ? C.navy : C.line, backgroundColor: on ? C.navy : '#fff' }}
          >
            <Text style={{ fontSize: 13, ...F[600], color: on ? '#fff' : C.ink }}>{o.label}</Text>
            {o.count != null ? (
              <View style={{ minWidth: 20, paddingHorizontal: 5, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.2)' : C.navy50 }}>
                <Text style={{ fontSize: 11, ...F[700], color: on ? '#fff' : C.navy }}>{o.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A full-screen page over the current one, with a back button and title. */
export function DetailModal({ title, subtitle, onClose, children, refreshing, onRefresh }) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: C.glassStrong, borderBottomWidth: 1, borderBottomColor: C.glassEdge }}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back" style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" size={18} color={C.navy} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, ...F[700], color: C.ink }} numberOfLines={1}>{title}</Text>
            {subtitle ? <Txt small muted numberOfLines={1}>{subtitle}</Txt> : null}
          </View>
        </View>
        <Screen refreshing={refreshing} onRefresh={onRefresh}>{children}</Screen>
      </SafeAreaView>
    </Modal>
  );
}

/** A white card with a small heading, for chart and list blocks. */
export function Block({ title, caption, right, children, style }) {
  return (
    <View style={[{ backgroundColor: C.glass, borderRadius: R.lg, padding: 18, gap: 14, borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden', ...shadow }, style]}>
      <Sheen />
      {title || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={{ fontSize: 16, ...F[600], color: C.ink }}>{title}</Text> : null}
            {caption ? <Txt small muted style={{ marginTop: 2 }}>{caption}</Txt> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A compact key figure inside a header or block: value over label. */
export function Figure({ value, label, light, align = 'flex-start' }) {
  return (
    <View style={{ alignItems: align, flex: 1 }}>
      <Text style={{ fontSize: 22, ...F.display, color: light ? '#fff' : C.ink, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{value ?? '—'}</Text>
      <Text style={{ fontSize: 10.5, ...F[600], letterSpacing: 0.7, textTransform: 'uppercase', color: light ? 'rgba(255,255,255,0.72)' : C.muted }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Minutes between two moments as "1h 05m" / "42m". */
export function duration(from, to) {
  if (!from || !to) return '—';
  const m = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "Mon 19" for a YYYY-MM-DD day. */
export function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}`;
}
