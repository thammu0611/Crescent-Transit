// The tab bar (2026 redesign): docked to the bottom edge on the surface colour
// with a hairline on top. The current tab's icon sits on a soft accent pill and
// its label turns bold accent; the icon springs up a little as it becomes active.
// Badges (options.tabBarBadge) are a red count, or a dot for `true`.
import { BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import { useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tickSelect } from '../lib/haptics.js';
import { C, F } from '../theme.js';
import Icon from './Icon.js';
import { Frost, translated, useLanguage } from './ui.js';

const PAD = 8;
const ICON_ON = C.navy;
const ICON_OFF = C.muted;
// Tamil words run wider than the same length in English.
// Shorter tab names where the full Tamil would not fit five tabs across.
const SHORT = { ta: { 'Dashboard': 'முகப்பு', 'Fleet map': 'வரைபடம்', 'Live map': 'வரைபடம்' } };
const tabLabel = (language, english) => SHORT[language]?.[english] ?? translated(language, english);

const LONG_SCRIPT = /[஀-௿]/;

// The label's size from the room each tab really has, so no label is cut or spills
// over its neighbour: any number of tabs, any phone width, English or Tamil.
// Average glyph width as a share of the font size, measured on the app's fonts.
const GLYPH = 0.64; // the bold face of the current tab, the widest
const GLYPH_TAMIL = 0.86;
export function labelSize(label, tabWidth, tabCount) {
  const base = tabCount > 4 ? 11 : 12;
  if (!tabWidth || !label) return base;
  const room = tabWidth - 3;
  const per = LONG_SCRIPT.test(label) ? GLYPH_TAMIL : GLYPH;
  const fit = room / (String(label).length * per);
  return Math.max(8, Math.min(base, Math.floor(fit * 2) / 2));
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = v; }).catch(() => {});

function Badge({ value }) {
  if (value == null || value === false) return null;
  if (value === true) return <View style={s.dot} />;
  return <View style={s.count}><Text style={s.countText}>{value}</Text></View>;
}

/** One tab: an accent pill behind the icon when current; the icon springs up a little. */
function Tab({ focused, label: english, icon, badge, size, onPress, onLongPress, a11yLabel: a11yEnglish }) {
  const language = useLanguage();
  const label = tabLabel(language, english);
  const a11yLabel = translated(language, a11yEnglish);
  const [pop] = useState(() => new Animated.Value(focused ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) { pop.setValue(focused ? 1 : 0); return; }
    Animated.spring(pop, { toValue: focused ? 1 : 0, useNativeDriver: true, damping: 12, stiffness: 220, mass: 0.7 }).start();
  }, [focused, pop]);
  const CustomIcon = typeof icon === 'function' ? icon : null;
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [s.tab, pressed && { opacity: 0.75 }]}
    >
      <View style={[s.pill, focused && s.pillOn]}>
        <Animated.View style={{ transform: [{ scale }] }}>
          {CustomIcon
            ? <CustomIcon focused={focused} />
            : <Icon name={icon} size={22} color={focused ? ICON_ON : ICON_OFF} strokeWidth={focused ? 2.2 : 1.9} />}
        </Animated.View>
        <View style={s.badgeAt}><Badge value={badge} /></View>
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        // The phone's large-text setting would push labels into each other; the
        // icons and the accessibility label carry the meaning at any size.
        maxFontSizeMultiplier={1.15}
        ellipsizeMode="clip"
        style={[s.label, { fontSize: size, lineHeight: Math.round(size * 1.3) }, focused ? s.labelOn : s.labelOff]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * tabBar for a bottom-tab navigator. `icons` maps route name to an Icon name, or
 * to a component taking { focused } for a custom icon (the profile avatar).
 */
export default function GlassTabBar({ state, descriptors, navigation, icons }) {
  const insets = useSafeAreaInsets();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const screen = useWindowDimensions().width;
  const tabW = (screen - PAD * 2) / state.routes.length;
  const language = useLanguage();
  const labelOf = (route) => { const o = descriptors[route.key].options; return tabLabel(language, o.tabBarLabel ?? o.title ?? route.name); };
  // One size for the whole bar, set by the label that needs the most room.
  const size = Math.min(...state.routes.map((r) => labelSize(labelOf(r), tabW, state.routes.length)));

  return (
    <View
      style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}
      onLayout={(e) => reportHeight?.(e.nativeEvent.layout.height)}
    >
      <Frost intensity={60} />
      {state.routes.map((route, i) => {
        const { options } = descriptors[route.key];
        const focused = state.index === i;
        const label = labelOf(route);
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            tickSelect();
            navigation.navigate(route.name, route.params);
          }
        };
        return (
          <Tab
            key={route.key}
            focused={focused}
            label={label}
            icon={icons[route.name]}
            badge={options.tabBarBadge}
            size={size}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            a11yLabel={options.tabBarAccessibilityLabel ?? label}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 8, paddingHorizontal: PAD,
    flexDirection: 'row',
    backgroundColor: C.dark ? 'rgba(18,28,48,0.72)' : 'rgba(255,255,255,0.70)',
    borderTopWidth: 1, borderTopColor: C.glassEdge, overflow: 'hidden',
  },
  tab: { flex: 1, minWidth: 0, minHeight: 52, paddingHorizontal: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: C.navy50 },
  label: { maxWidth: '100%', textAlign: 'center', letterSpacing: 0, ...F.nav },
  labelOn: { color: ICON_ON, ...F.navBold },
  labelOff: { color: ICON_OFF },
  badgeAt: { position: 'absolute', top: -4, right: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#B5282A', borderWidth: 1.5, borderColor: C.dark ? '#121C30' : '#fff' },
  count: { minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B5282A', borderWidth: 1.5, borderColor: C.dark ? '#121C30' : '#fff' },
  countText: { color: '#fff', fontSize: 10.5, ...F[700] },
});
