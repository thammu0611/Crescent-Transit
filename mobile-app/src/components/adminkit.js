// Building blocks shared by the transport office screens (dashboard, trips,
// attendance, reports): simple charts drawn with views and SVG, an aligned
// table, filter chips and a full-screen detail view. They sit on top of
// ui.js and the theme, so they look like the rest of the app.
import { useT } from '../lib/offline.js';
import { Children, createContext, useContext, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { C, F, G, R, shadow } from '../theme.js';
import Icon from './Icon.js';
import { Empty, GlassBackdrop, IconBubble, PillIconButton, Screen, Sheen, Skeleton, Text, Txt } from './ui.js';

/** Series colours: navy, gold, emerald, crimson, slate, sky - readable on white. */
export const SERIES = [C.navy, C.gold, C.emerald, C.red, C.slate, '#6ec1e4'];

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
export function Donut({ segments, size = 116, thickness = 15, center, caption }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
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
          <Txt small style={{ flex: 1 }} numberOfLines={2}>{s.label}</Txt>
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
        const rowStyle = { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6, backgroundColor: C.dark ? (i % 2 ? 'rgba(255,255,255,0.035)' : 'transparent') : i % 2 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.55)', borderTopWidth: 1, borderTopColor: C.line2 };
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

/** Pill filters that wrap onto the next line, as on the website: every option stays in view. */
export function Chips({ value, onChange, options: list }) {
  const t = useT();
  const options = list.map((o) => ({ ...o, label: t(o.label) }));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: R.pill, borderWidth: 1, borderColor: on ? (C.dark ? 'rgba(198,211,242,0.55)' : C.navyFill) : C.line, backgroundColor: on ? C.navyFill : C.dark ? 'transparent' : C.paper, opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ fontSize: 14, ...F[700], color: on ? '#fff' : C.ink }}>{o.label}</Text>
            {o.count != null ? (
              <View style={{ minWidth: 20, paddingHorizontal: 5, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.2)' : C.navy50 }}>
                <Text style={{ fontSize: 11, ...F[700], color: on ? '#fff' : C.navy }}>{o.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A full-screen page over the current one, with a back button and title. */
export function DetailModal({ title, subtitle, onClose, children, refreshing, onRefresh }) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
        {/* One backdrop behind the title and the page, so they meet without a strip or line. */}
        <GlassBackdrop />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
          <PillIconButton icon="back" label="Back" onPress={onClose} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 24, lineHeight: 30, ...F.navTitle, color: C.dark ? C.ink : C.navy }} numberOfLines={1} accessibilityRole="header">{title}</Text>
            {subtitle ? <Txt small muted numberOfLines={1}>{subtitle}</Txt> : null}
          </View>
        </View>
        <Screen transparent refreshing={refreshing} onRefresh={onRefresh}>{children}</Screen>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * A compact card for one section of a screen: icon and title (`summary` is no longer shown).
 * Its contents open in their own full view. `children` may be a function of `close`,
 * for buttons that leave the screen.
 */
export function ViewCard({ title: name, icon, summary, badge, children }) {
  const title = useT()(name);
  const inList = useContext(InList);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [inList ? listRow : { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: R.lg, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden', ...shadow }, pressed && { opacity: 0.85, backgroundColor: inList ? C.navy50 : undefined }]}>
        {inList ? null : <Sheen />}
        {icon ? (inList ? <IconBubble name={icon} accent={rowAccent(inList)} size={36} iconSize={18} /> : <IconBubble name={icon} colors={G.navy} size={36} iconSize={18} />) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {/* The badge sits beside the title. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt bold numberOfLines={2} style={{ flexShrink: 1 }}>{title}</Txt>
            {badge}
          </View>

        </View>
        <Icon name="arrow" size={16} color={C.faint} />
      </Pressable>
      {open ? (
        <DetailModal title={title} onClose={close}>
          <View style={{ gap: 12 }}>{typeof children === 'function' ? children(close) : children}</View>
        </DetailModal>
      ) : null}
    </>
  );
}

// Inside a ViewList, ViewCards and ListRows are rows of one card, split by hairlines.
const InList = createContext(false);
// Each row of a list in its own colour, in turn, so a list reads at a look.
const ROW_ACCENTS = ['navy', 'teal', 'gold', 'sky', 'emerald', 'violet'];
const rowAccent = (inList) => ROW_ACCENTS[(inList?.i ?? 0) % ROW_ACCENTS.length];
const listRow = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line2 };

/**
 * A group of rows shown as one card (Settings, Services, the driver's tools):
 * one rounded glass card, a row per item, divided by hairlines. An optional
 * small label sits above it.
 */
export function ViewList({ label, children, style }) {
  const t = useT();
  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <Text style={{ fontSize: 13, ...F[600], color: C.muted, paddingHorizontal: 4 }}>{t(label)}</Text> : null}
      <View style={{ borderRadius: R.lg, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, overflow: 'hidden', ...shadow }}>
        {/* The first row's top hairline is pulled up under the card's edge. */}
        <View style={{ marginTop: -1 }}>
          {Children.toArray(children).filter(Boolean).map((child, i) => (
            <InList.Provider key={child.key ?? i} value={{ i }}>{child}</InList.Provider>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * One row of a ViewList: icon, title, a short line, and on the right a control
 * (switch, badge) or, when it opens something, a chevron. `below` puts a wider
 * control (a segmented switch) under the text.
 */
export function ListRow({ icon, accent: given, title: name, summary, right, below, onPress, danger }) {
  const inList = useContext(InList);
  const accent = given ?? (inList ? rowAccent(inList) : 'navy');
  const t = useT();
  const title = t(name);
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap
      {...(onPress ? { onPress, accessibilityRole: 'button', accessibilityLabel: title } : {})}
      style={onPress ? ({ pressed }) => [listRow, below && { flexWrap: 'wrap' }, pressed && { backgroundColor: C.navy50 }] : [listRow, below && { flexWrap: 'wrap' }]}
    >
      {icon ? <IconBubble name={icon} accent={danger ? 'danger' : accent} size={36} iconSize={18} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt bold style={danger ? { color: C.danger } : null}>{title}</Txt>
        {summary ? <Txt muted small>{typeof summary === 'string' ? t(summary) : summary}</Txt> : null}
      </View>
      {right ?? (onPress ? <Icon name="arrow" size={16} color={C.faint} /> : null)}
      {below ? <View style={{ flexBasis: '100%', paddingLeft: icon ? 48 : 0, paddingTop: 4 }}>{below}</View> : null}
    </Wrap>
  );
}

/** A white card with a small heading, for chart and list blocks. */
export function Block({ title: name, caption, right, children, style }) {
  const title = useT()(name);
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
export function Figure({ value, label: name, light, align = 'flex-start' }) {
  const label = useT()(name);
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
