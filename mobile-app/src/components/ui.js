// Mobile counterparts of the web app's components/ui.jsx: the same building
// blocks (Page, Panel, Stat, Badge, Table, Modal, Field, Segmented ...) drawn
// with React Native views, sized for thumbs.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useIsFocused } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { createContext, forwardRef, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Easing, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text as RNText, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, G as SvgG, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { monthName, shiftMonth, thisMonth } from '../lib/format.js';
import { tickPress, tickSelect } from '../lib/haptics.js';
import { ACCENT, C, F, G, HAIRLINE, R, TONE, glass, glow, interFor, shadow, shadowLg } from '../theme.js';
import Icon from './Icon.js';

const InsideText = createContext(false);

/**
 * Text in the app's interface font. Every screen uses this instead of React
 * Native's Text, so text without a font of its own is Inter (not the system
 * font), and a plain fontWeight picks the matching Inter weight - Android
 * cannot bold a custom font by itself. Nested text inherits its parent's font.
 */
export const Text = forwardRef(function Text({ style, children, ...rest }, ref) {
  const nested = useContext(InsideText);
  const flat = StyleSheet.flatten(style) ?? {};
  const font = !flat.fontFamily && (!nested || flat.fontWeight) ? { fontFamily: interFor(flat.fontWeight), fontWeight: 'normal' } : null;
  return (
    <RNText ref={ref} style={font ? [style, font] : style} {...rest}>
      <InsideText.Provider value>{children}</InsideText.Provider>
    </RNText>
  );
});

export const Txt = ({ style, muted, small, bold, children, ...rest }) => (
  <Text style={[s.txt, muted && s.muted, small && s.small, bold && s.bold, style]} {...rest}>{children}</Text>
);

/**
 * Height of the on-screen keyboard on Android. Apps there draw edge to edge,
 * so the keyboard covers the screen instead of shrinking it; screens add this
 * as bottom space so every field and button can still be scrolled into view.
 */
function useAndroidKeyboard() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

/**
 * The liquid glass backdrop: a cool base with soft navy, gold and sky glows.
 * Rendered once behind the whole app (App.js) and behind full-screen modals,
 * so every translucent surface has colour to refract.
 */
export function GlassBackdrop({ offset = 0 }) {
  const { height } = useWindowDimensions();
  // Shifted up behind the header, so it is that much taller to still reach the bottom edge.
  const tall = Math.max(height, 640) + offset;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: -offset, height: tall }}>
      <LinearGradient colors={['#f4f4f4', '#eceeef', '#f1f1f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="gNavy" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#1c315e" stopOpacity="0.30" /><Stop offset="1" stopColor="#1c315e" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gGold" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#f7bc31" stopOpacity="0.26" /><Stop offset="1" stopColor="#f7bc31" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gSky" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#6ec1e4" stopOpacity="0.26" /><Stop offset="1" stopColor="#6ec1e4" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gRose" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#a02022" stopOpacity="0.14" /><Stop offset="1" stopColor="#a02022" stopOpacity="0" /></RadialGradient>
        </Defs>
        <Ellipse cx="40" cy="90" rx="260" ry="230" fill="url(#gNavy)" />
        <Ellipse cx="380" cy="300" rx="230" ry="210" fill="url(#gGold)" />
        <Ellipse cx="60" cy="560" rx="250" ry="230" fill="url(#gSky)" />
        <Ellipse cx="360" cy="760" rx="240" ry="200" fill="url(#gRose)" />
        {/* A faint map of bus routes and stops, as on the web app. */}
        {BACK_ROUTES.map(([d, stroke], i) => (
          <SvgG key={i}>
            <Path d={d} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={7} strokeLinecap="round" />
            <Path d={d} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
          </SvgG>
        ))}
        {BACK_STOPS.map(([x, y]) => (
          <SvgG key={`${x},${y}`}>
            <Circle cx={x} cy={y} r={7} fill="rgba(247,188,49,0.14)" />
            <Circle cx={x} cy={y} r={3.4} fill="#fff" stroke="rgba(28,49,94,0.28)" strokeWidth={1.5} />
          </SvgG>
        ))}
      </Svg>
      <RouteBus height={tall} />
    </View>
  );
}

const BACK_ROUTES = [
  ['M-40 150 C 60 110, 120 230, 220 190 S 360 110, 440 170', 'rgba(28,49,94,0.13)'],
  ['M90 -20 C 120 120, 40 260, 120 380 S 210 600, 150 820', 'rgba(110,193,228,0.38)'],
  ['M330 -20 C 300 140, 380 280, 320 420 S 250 640, 310 820', 'rgba(28,49,94,0.11)'],
];
const BACK_STOPS = [[30, 128], [220, 190], [380, 140], [96, 300], [120, 380], [344, 300], [318, 440]];

// The road the little bus drives: a gentle wave across the screen, as
// fractions of the backdrop's width and height. The bus follows it point to
// point on the native driver, so it costs nothing on the JavaScript thread.
const ROAD = Array.from({ length: 15 }, (_, i) => {
  const x = -0.12 + i * 0.09;
  return [x, 0.64 + 0.03 * Math.sin(x * Math.PI * 2.4)];
});

/** The gold dashed road and a small bus gliding along it, every 40 seconds. */
function RouteBus({ height }) {
  const { width } = useWindowDimensions();
  const [t] = useState(() => new Animated.Value(0));
  const [still, setStill] = useState(false);
  useEffect(() => {
    let loop;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      setStill(reduce);
      if (reduce) return;
      loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 40000, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
    }).catch(() => {});
    return () => loop?.stop();
  }, [t]);

  const pts = ROAD.map(([fx, fy]) => [fx * width, fy * height]);
  const input = pts.map((_, i) => i / (pts.length - 1));
  const angle = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return `${(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI}deg`;
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Path d={d} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        <Path d={d} fill="none" stroke="rgba(247,188,49,0.6)" strokeWidth={2.4} strokeDasharray="2 10" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      {still ? null : (
        <Animated.View
          style={{
            position: 'absolute', left: -15, top: -8, width: 30, height: 16, opacity: 0.85,
            transform: [
              { translateX: t.interpolate({ inputRange: input, outputRange: pts.map((p) => p[0]) }) },
              { translateY: t.interpolate({ inputRange: input, outputRange: pts.map((p) => p[1]) }) },
              { rotate: t.interpolate({ inputRange: input, outputRange: angle }) },
            ],
          }}
        >
          <Svg width={30} height={16} viewBox="-15 -8 30 16">
            <Rect x={-15} y={-8} width={30} height={16} rx={5} fill={C.gold} />
            <Rect x={6} y={-6} width={6} height={12} rx={2} fill={C.navy} />
            <Rect x={-11} y={-5} width={14} height={10} rx={2} fill="rgba(28,49,94,0.55)" />
          </Svg>
        </Animated.View>
      )}
    </>
  );
}

/** Real frosted glass behind a surface (header, tab bar, sheets). */
export function Frost({ tint = 'light', intensity = 50, style }) {
  return (
    <BlurView
      pointerEvents="none"
      tint={tint}
      intensity={intensity}
      experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

/** The bright top edge and faint gloss that make a surface read as glass. */
export function Sheen({ radius = R.lg, dark }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <LinearGradient
        colors={dark ? ['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0)']}
        locations={[0, 0.35, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.4, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, backgroundColor: dark ? 'rgba(255,255,255,0.35)' : '#fff' }} />
    </View>
  );
}

/** A scrolling screen with pull-to-refresh. `header` renders edge to edge above the padded content. */
export function Screen({ children, refreshing = false, onRefresh, safeTop = false, scroll = true, contentStyle, header, transparent }) {
  const keyboard = useAndroidKeyboard();
  const tabSpace = useTabBarSpace();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[header ? { paddingBottom: 40 } : [s.screen, contentStyle], tabSpace ? { paddingBottom: 40 + tabSpace } : null, keyboard ? { paddingBottom: 40 + keyboard } : null]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={header ? '#fff' : C.navy} colors={[C.navy]} progressViewOffset={header ? 30 : 0} /> : undefined}
    >
      {header ? <>{header}<View style={[s.screen, { paddingTop: 0, marginTop: -34 }, contentStyle]}>{children}</View></> : children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={[s.fill, transparent && { backgroundColor: 'transparent' }]} edges={safeTop && !header ? ['top', 'left', 'right'] : ['left', 'right']}>
      {transparent ? null : <GlassBackdrop offset={headerHeight} />}
      {Platform.OS === 'ios' ? <KeyboardAvoidingView style={s.fill} behavior="padding">{body}</KeyboardAvoidingView> : body}
    </SafeAreaView>
  );
}

/** Soft decorative circles for gradient surfaces. */
const Orbs = ({ size = 180 }) => (
  <>
    <View pointerEvents="none" style={[s.orb, { width: size, height: size, borderRadius: size / 2, top: -size * 0.45, right: -size * 0.3 }]} />
    <View pointerEvents="none" style={[s.orbRing, { width: size * 1.35, height: size * 1.35, borderRadius: size, top: -size * 0.62, right: -size * 0.48 }]} />
    <View pointerEvents="none" style={[s.orbGold, { width: size * 0.55, height: size * 0.55, borderRadius: size, bottom: -size * 0.25, left: -size * 0.15 }]} />
  </>
);

/**
 * The app's background motif: a faint dotted bus route with stops, drawn
 * across gradient surfaces. It stretches to fill whatever it sits in.
 */
export const RoutePattern = ({ opacity = 0.16, color = '#f9d27a', slice }) => (
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 400 200" preserveAspectRatio={slice ? 'xMidYMid slice' : 'none'}>
    <Path d="M-10 170 C 60 150, 90 70, 170 90 S 280 160, 330 70 S 400 20, 420 30" stroke={color} strokeOpacity={opacity} strokeWidth={1.6} strokeDasharray="2 9" strokeLinecap="round" fill="none" />
    {[[170, 90], [330, 70], [62, 146]].map(([x, y]) => (
      <Circle key={x} cx={x} cy={y} r={4} stroke={color} strokeOpacity={opacity * 1.8} strokeWidth={1.5} fill="none" />
    ))}
  </Svg>
);

const native = Platform.OS !== 'web';

/** Fades and slides its content in when it first appears. */
export function FadeIn({ children, delay = 0, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** A status dot with an expanding ring, for things that are live right now. */
export function LivePulse({ color = '#61ce70', size = 10 }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const ring = size * 2.4;
  return (
    <View style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: ring, height: ring, borderRadius: ring / 2, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** A gradient surface with the route motif and decorative orbs (hero cards, banners). */
export function GradientCard({ colors = G.navy, style, children, orbs = true, radius = R.xl, animate = true }) {
  const card = (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius, padding: 20, overflow: 'hidden', gap: 10, borderWidth: 1, borderColor: HAIRLINE.light }, shadowLg, style]}>
      {orbs ? <><RoutePattern opacity={0.14} /><Orbs /></> : null}
      <Sheen radius={radius} dark />
      {children}
    </LinearGradient>
  );
  return animate ? <FadeIn>{card}</FadeIn> : card;
}

/**
 * Extra bottom space a screen needs so its last item clears the floating tab
 * bar (0 outside the tab navigators). The bar floats 10 above the safe area.
 */
export function useTabBarSpace() {
  const barHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return barHeight ? barHeight + insets.bottom + 10 : 0;
}

/**
 * The app's mark, drawn as the launcher icon: a gold bus on a navy rounded
 * square with a fine gold edge. The web navbar draws the same shapes
 * (client/src/components/BrandMark.jsx).
 */
export function BrandMark({ size = 42 }) {
  // Gradient ids of their own: a copy in a hidden screen must not be the one referenced.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  // Inside a View: on the web a bare svg would paint under the pill's frosted layer.
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          <SvgLinearGradient id={`brandBg${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2a4787" />
            <Stop offset="1" stopColor="#162a52" />
          </SvgLinearGradient>
          <SvgLinearGradient id={`brandBus${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fbcd5a" />
            <Stop offset="1" stopColor="#f2b12a" />
          </SvgLinearGradient>
        </Defs>
        <Rect x={0.75} y={0.75} width={46.5} height={46.5} rx={13} fill={`url(#brandBg${id})`} stroke="rgba(247,188,49,0.65)" strokeWidth={1.5} />
        <SvgG x={12} y={10}>
          <Rect x={-1.6} y={6} width={2.4} height={4.4} rx={1} fill="#c4860b" />
          <Rect x={23.2} y={6} width={2.4} height={4.4} rx={1} fill="#c4860b" />
          <Rect x={2} y={23} width={4.4} height={3.6} rx={1.2} fill="#c4860b" />
          <Rect x={17.6} y={23} width={4.4} height={3.6} rx={1.2} fill="#c4860b" />
          <Rect x={0.6} y={0} width={22.8} height={24.4} rx={5.4} fill={`url(#brandBus${id})`} />
          <Rect x={5.6} y={2.2} width={12.8} height={2.6} rx={1.3} fill="#1e3360" />
          <Rect x={3} y={6.8} width={18} height={8.4} rx={2.4} fill="#1e3360" />
          <Circle cx={6.4} cy={19.2} r={1.9} fill="#13213f" />
          <Circle cx={17.6} cy={19.2} r={1.9} fill="#13213f" />
          <Rect x={9.6} y={18.3} width={4.8} height={1.8} rx={0.9} fill="#13213f" />
        </SvgG>
      </Svg>
    </View>
  );
}

/** The app name: "Crescent" in Montserrat, "TRANSIT" in small spaced gold capitals beneath. */
export const Wordmark = ({ style, dark }) => (
  <View style={[{ justifyContent: 'center' }, style]} accessibilityRole="header" accessibilityLabel="Crescent Transit">
    <Text style={[s.wordmark, dark && { color: C.navy }]} numberOfLines={1}>Crescent</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
      <View style={{ width: 12, height: 1, backgroundColor: C.gold, opacity: 0.8 }} />
      <Text style={s.wordmarkSub} numberOfLines={1}>TRANSIT</Text>
    </View>
  </View>
);

/** A round button for the pill (back, sign out, menu). */
export function PillIconButton({ icon, onPress, label }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.pillBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}>
      <Icon name={icon} size={18} color="#fff" />
    </Pressable>
  );
}

/** The gold call to action that sits at the right end of a pill ("Sign in"). */
export function PillButton({ title, icon = 'arrow', onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.pillCta, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}>
      <Text style={s.pillCtaText}>{title}</Text>
      {icon ? <Icon name={icon} size={15} color={C.navy900} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

/**
 * The navigation bar: a floating rounded pill, as in the web app. A back
 * button (or the brand mark), the title (or the wordmark), and actions on the
 * right. Solid navy on light screens; `glass` for navy screens.
 */
export function NavPill({ title, onBack, right, glass, style }) {
  return (
    <View style={[s.pill, glass ? s.pillGlass : s.pillSolid, style]}>
      {!glass ? <Frost tint="dark" intensity={55} style={{ borderRadius: R.pill }} /> : null}
      {!glass ? <Sheen radius={R.pill} dark /> : null}
      {!glass ? <View pointerEvents="none" style={s.pillGold} /> : null}
      {onBack ? <PillIconButton icon="back" label="Back" onPress={onBack} /> : <BrandMark size={42} />}
      {title ? (
        // The screen's name under a small gold app name, as the web bar's wordmark.
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={s.pillEyebrow} numberOfLines={1}>CRESCENT TRANSIT</Text>
          <Text style={s.pillTitle} numberOfLines={1}>{title}</Text>
        </View>
      ) : <Wordmark style={{ flex: 1 }} />}
      {right ? <View style={s.pillRight}>{right}</View> : null}
    </View>
  );
}

/**
 * Header for the stack and tab navigators: the pill, floating on the
 * screen's background below the status bar. An empty headerTitle shows the
 * wordmark (those screens carry their own page banner).
 */
export function PillHeader({ navigation, route, options, back }) {
  const insets = useSafeAreaInsets();
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : options.title ?? route.name;
  const right = options.headerRight?.({ tintColor: '#fff', canGoBack: Boolean(back) });
  return (
    <View style={{ backgroundColor: C.bg, overflow: 'hidden', paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 8 }}>
      <GlassBackdrop />
      <NavPill title={title} onBack={back ? navigation.goBack : undefined} right={right} />
    </View>
  );
}

/**
 * Full-width gradient header for a screen's top (home screens). Content
 * below overlaps its rounded bottom edge (see Screen `header`).
 */
export function HeroHeader({ colors = G.navy, children, compact }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + (compact ? 16 : 22), paddingHorizontal: 20, paddingBottom: compact ? 54 : 56, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, overflow: 'hidden' }}>
      {focused ? <StatusBar style="light" /> : null}
      <RoutePattern opacity={0.18} />
      <Orbs size={240} />
      <View pointerEvents="none" style={s.heroSheen} />
      {children}
    </LinearGradient>
  );
}

/** Rounded square with an icon, tinted by accent name. */
export function IconBubble({ name, accent = 'indigo', size = 40, iconSize, solid, colors }) {
  const [bg, fg] = ACCENT[accent] ?? ACCENT.indigo;
  const inner = <Icon name={name} size={iconSize ?? Math.round(size * 0.5)} color={solid || colors ? '#fff' : fg} />;
  if (colors) {
    return <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>{inner}</LinearGradient>;
  }
  return <View style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: 'center', justifyContent: 'center', backgroundColor: solid ? fg : bg }}>{inner}</View>;
}

/** Initials in a circle. */
export function Avatar({ name = '', size = 44, light }) {
  const initials = name.replace(/^(Mr|Mrs|Ms|Dr)\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: light ? 'rgba(255,255,255,0.10)' : C.navy50, borderWidth: 1.5, borderColor: light ? C.gold : C.navy100, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: light ? '#fff' : C.navy, ...F[600], fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

/** Round glassy icon button for gradient headers (bell, sign out). */
export function HeaderIconButton({ icon, onPress, badge, label, dark }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [s.headerBtn, dark && { backgroundColor: '#fff', borderColor: C.line2, ...shadow }, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Icon name={icon} size={20} color={dark ? C.navy : '#fff'} />
      {badge ? <View style={s.headerBadge}><Text style={s.headerBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
    </Pressable>
  );
}

/** A section label with an optional action link. */
export function SectionTitle({ title, action, onAction }) {
  return (
    <View style={[s.row, { marginTop: 6, marginBottom: -4 }]}>
      <View style={s.sectionRule} />
      <Text style={s.section}>{title}</Text>
      {action ? <Pressable onPress={onAction} hitSlop={8}><Text style={s.link}>{action}</Text></Pressable> : null}
    </View>
  );
}

/** The page banner used at the top of inner screens. */
export function PageHead({ eyebrow, title, subtitle, actions, icon = 'sparkle', colors = G.navy }) {
  return (
    <GradientCard colors={colors} style={{ padding: 18 }}>
      <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
        <View style={s.bannerIcon}><Icon name={icon} size={21} color={C.gold} strokeWidth={1.8} /></View>
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={s.eyebrowLight}>{eyebrow.toUpperCase()}</Text> : null}
          {title ? <Text style={s.bannerTitle}>{title}</Text> : null}
        </View>
      </View>
      {subtitle ? <Text style={s.bannerSub}>{subtitle}</Text> : null}
      {actions ? <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{actions}</View> : null}
    </GradientCard>
  );
}

const PANEL_GRADIENT = { navy: G.navy, emerald: G.emerald, indigo: G.indigo, red: G.red, danger: G.danger, violet: G.violet };

export function Panel({ title, icon, actions, children, style, accent = 'navy' }) {
  return (
    <FadeIn style={[s.panel, style]}>
      <Sheen />
      {title || actions ? (
        <View style={s.panelHead}>
          {title ? (
            <View style={[s.row, { flex: 1, gap: 10 }]}>
              {icon ? <IconBubble name={icon} colors={PANEL_GRADIENT[accent] ?? G.navy} size={36} iconSize={18} /> : null}
              <Text style={s.h3}>{title}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}
          {actions ? <View style={[s.row, { gap: 6 }]}>{actions}</View> : null}
        </View>
      ) : null}
      {children}
    </FadeIn>
  );
}

const STAT_ACCENT = { live: 'emerald', delayed: 'amber', danger: 'danger', offline: 'navy' };

export function Stat({ label, value, tone, icon }) {
  const t = TONE[tone];
  return (
    <View style={[s.stat, icon && s.statRow]}>
      <Sheen />
      {icon ? <IconBubble name={icon} accent={STAT_ACCENT[tone] ?? 'indigo'} size={38} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.statValue, t && { color: t.fg }]} numberOfLines={1} adjustsFontSizeToFit>{value ?? '—'}</Text>
        <Text style={s.statLabel} numberOfLines={2}>{label}</Text>
      </View>
      {t && !icon ? <View style={[s.statBar, { backgroundColor: t.fg }]} /> : null}
    </View>
  );
}

export const StatGrid = ({ children }) => <View style={s.statGrid}>{children}</View>;

export function Badge({ tone = 'offline', children, dot = true }) {
  const t = TONE[tone] ?? TONE.offline;
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      {dot ? <View style={[s.badgeDot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[s.badgeText, { color: t.fg }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

export const YesNo = ({ value, yes = 'Yes', no = 'No', noTone = 'offline' }) => <Badge tone={value ? 'live' : noTone}>{value ? yes : no}</Badge>;

export const ErrorText = ({ children }) => (children ? (
  <View style={[s.alert, { backgroundColor: C.danger50, borderColor: '#ecc9cc' }]} accessibilityRole="alert">
    <Icon name="alert" size={16} color={C.danger} />
    <Text style={[s.alertText, { color: C.red600 }]}>{children}</Text>
  </View>
) : null);
export const Notice = ({ children }) => (children ? (
  <View style={[s.alert, { backgroundColor: C.emerald50, borderColor: '#c5e9cb' }]}>
    <Icon name="check" size={16} color={C.emerald700} />
    <Text style={[s.alertText, { color: C.emerald700 }]}>{children}</Text>
  </View>
) : null);

export function Empty({ children, icon = 'sparkle' }) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 18 }}>
      <IconBubble name={icon} accent="indigo" size={44} />
      <Text style={s.empty}>{children}</Text>
    </View>
  );
}

/** Pulsing placeholder while data loads (doc B.9: skeletons, not spinners). */
export function Skeleton({ height = 64 }) {
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[s.skeleton, { height, opacity: v }]} />;
}

const BTN = {
  primary: { colors: G.navy, fg: '#fff', glow: C.navy900 },
  dark: { colors: G.dark, fg: '#fff', glow: C.ink },
  indigo: { colors: G.indigo, fg: '#fff', glow: C.indigo },
  danger: { colors: G.danger, fg: '#fff', glow: C.danger },
  red: { colors: G.red, fg: '#fff', glow: C.red600 },
  emerald: { colors: G.emerald, fg: '#fff', glow: C.emerald },
  ghost: { bg: C.glassStrong, fg: C.navy, border: C.glassEdge },
  soft: { bg: C.red50, fg: C.red600, border: '#f3d3d3' },
  light: { bg: C.glassStrong, fg: C.ink, border: C.glassEdge },
};

export function Button({ title, onPress, variant = 'primary', icon, disabled, busy, small, style, textStyle }) {
  const v = BTN[variant] ?? BTN.primary;
  const off = disabled || busy;
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <Icon name={icon} size={small ? 14 : 18} color={v.fg} /> : null}
      {title ? <Text style={[s.btnText, small && { fontSize: 13 }, { color: v.fg }, textStyle]}>{title}</Text> : null}
    </>
  );
  const box = [s.btn, small && s.btnSmall];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      onPressIn={tickPress}
      style={({ pressed }) => [
        { borderRadius: small ? R.sm : R.md },
        v.colors && !off && !small ? glow(v.glow) : null,
        off && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.92 },
        style,
      ]}
    >
      {v.colors ? (
        <LinearGradient colors={v.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[box, { flexGrow: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }]}>{content}</LinearGradient>
      ) : (
        <View style={[box, { flexGrow: 1, backgroundColor: v.bg, borderWidth: 1, borderColor: v.border }]}>{content}</View>
      )}
    </Pressable>
  );
}

/** A text link styled action, for row actions. */
export function LinkButton({ title, onPress, danger, icon }) {
  const color = danger ? C.danger : C.indigo;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [s.linkBtn, { backgroundColor: danger ? C.danger50 : C.indigo50 }, pressed && { opacity: 0.6 }]}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Text style={[s.link, { color, fontSize: 13 }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, children, style }) {
  return (
    <View style={[s.field, style]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input({ icon, style, multiline, onFocus, onBlur, ref: outerRef, ...props }) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const retried = useRef(false);
  // One ref for this component and one passed in (React 19 passes `ref` as a prop).
  const setRef = (node) => {
    inputRef.current = node;
    if (typeof outerRef === 'function') outerRef(node);
    else if (outerRef) outerRef.current = node;
  };
  // Android: if a pop-up (password manager, keyboard toolbar) takes window focus as the
  // field is tapped, the system can skip opening the keyboard. Ask once more shortly after.
  const ensureKeyboard = () => {
    if (Platform.OS !== 'android' || retried.current) return;
    retried.current = true;
    setTimeout(() => {
      const node = inputRef.current;
      if (!node || !node.isFocused?.() || Keyboard.isVisible?.()) { retried.current = false; return; }
      node.blur();
      setTimeout(() => node.focus?.(), 60);
      // Ready to help again on the next tap.
      setTimeout(() => { retried.current = false; }, 1500);
    }, 400);
  };
  return (
    // The wrapper keeps the same native view on focus: only its border colour changes.
    <View collapsable={false} style={[s.inputWrap, focused && s.inputFocused, multiline && { alignItems: 'flex-start' }, props.editable === false && { backgroundColor: C.line2 }]}>
      {icon ? <View style={{ paddingTop: multiline ? 12 : 0 }}><Icon name={icon} size={17} color={focused ? C.navy : C.faint} /></View> : null}
      <TextInput
        ref={setRef}
        placeholderTextColor={C.faint}
        // Android's autofill services (Google Autofill, Samsung Pass) can take over a
        // focused field with their own pop-up and keep the keyboard from opening.
        importantForAutofill="no"
        showSoftInputOnFocus
        style={[s.input, multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }, Platform.OS === 'web' && { outlineStyle: 'none' }, style]}
        multiline={multiline}
        onFocus={(e) => { setFocused(true); ensureKeyboard(); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        {...props}
        // Android: no autofill hints either, or the pop-up comes back (iOS keeps them).
        autoComplete={Platform.OS === 'android' ? 'off' : props.autoComplete}
      />
    </View>
  );
}
export const TextField = ({ label, hint, style, ...props }) => (
  <Field label={label} hint={hint} style={style}><Input {...props} /></Field>
);

/** A dropdown: a field that opens a searchable list (the web's <select>). */
export function Select({ label, value, onChange, options, placeholder = 'Choose…', disabled, hint, searchable, style, compact }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => String(o.value) === String(value));
  const list = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  const search = searchable ?? options.length > 12;
  const control = (
    <Pressable
      disabled={disabled}
      onPress={() => { setQ(''); setOpen(true); }}
      style={({ pressed }) => [compact ? s.selectCompact : s.inputWrap, disabled && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={label ?? placeholder}
    >
      <Text style={[compact ? s.selectCompactText : s.input, { paddingVertical: compact ? 0 : 13 }, !current && !compact && { color: C.faint }]} numberOfLines={1}>
        {current?.label ?? placeholder}
      </Text>
      <Icon name="down" size={16} color={compact ? '#fff' : C.muted} />
    </Pressable>
  );
  return (
    <>
      {compact ? control : <Field label={label} hint={hint} style={style}>{control}</Field>}
      <Sheet visible={open} title={label ?? placeholder} onClose={() => setOpen(false)} scroll={false}>
        {search && <SearchBox value={q} onChange={setQ} placeholder="Search" />}
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {list.map((o) => {
            const on = String(o.value) === String(value);
            return (
              <Pressable key={String(o.value)} onPress={() => { setOpen(false); onChange(o.value); }} style={({ pressed }) => [s.option, on && s.optionOn, pressed && { backgroundColor: C.surface }]}>
                <Text style={[s.txt, { flex: 1 }, on && { color: C.navy, ...F[700] }]}>{o.label}</Text>
                {on ? <View style={s.optionCheck}><Icon name="check" size={13} color="#fff" strokeWidth={3} /></View> : null}
              </Pressable>
            );
          })}
          {list.length === 0 && <Empty icon="search">No match.</Empty>}
        </ScrollView>
      </Sheet>
    </>
  );
}

export function Segmented({ value, onChange, options }) {
  // Up to three options share the full width; more scroll sideways.
  const fill = options.length <= 3;
  const items = options.map((o) => {
    const on = value === o.value;
    return (
      <Pressable key={String(o.value)} onPress={() => { if (!on) tickSelect(); onChange(o.value); }} style={[s.seg, fill && { flex: 1, alignItems: 'center' }, on && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
        <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>{o.label}</Text>
      </Pressable>
    );
  });
  if (fill) return <View style={[s.segmented, { flexDirection: 'row' }]}>{items}</View>;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segmented}>{items}</ScrollView>;
}

export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <View style={[s.inputWrap, { marginBottom: 10, backgroundColor: C.surface, borderColor: C.line2 }]}>
      <Icon name="search" size={16} color={C.faint} />
      <TextInput importantForAutofill="no" value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.faint} style={[s.input, Platform.OS === 'web' && { outlineStyle: 'none' }]} autoCapitalize="none" autoCorrect={false} accessibilityLabel={placeholder} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="x" size={16} color={C.faint} /></Pressable> : null}
    </View>
  );
}

/** A bottom sheet (the web's Modal). */
export function Sheet({ visible = true, title, onClose, children, scroll = true }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose?.()} statusBarTranslucent>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose?.()} />
        <View style={[s.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <Frost intensity={70} style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32 }} />
          <View style={s.grabber} />
          {title || onClose ? (
            <View style={[s.row, { marginBottom: 6 }]}>
              <Text style={[s.h2, { flex: 1 }]}>{title ?? ''}</Text>
              {onClose ? (
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={s.closeBtn}><Icon name="x" size={18} color={C.muted} /></Pressable>
              ) : null}
            </View>
          ) : null}
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>{children}</ScrollView> : children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Yes/No confirmation (window.confirm). */
export const confirm = (title, message, okLabel = 'OK', destructive = false) => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}${message ? `\n\n${message}` : ''}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
};

// window.prompt(): a text dialog that works on Android and iOS.
const PromptContext = createContext(null);
export function PromptProvider({ children }) {
  const [req, setReq] = useState(null);
  const [text, setText] = useState('');
  const resolver = useRef(null);
  const prompt = useMemo(() => (title, defaultValue = '') => new Promise((resolve) => {
    resolver.current = resolve;
    setText(defaultValue);
    setReq({ title });
  }), []);
  const done = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setReq(null);
  };
  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Sheet visible={Boolean(req)} title={req?.title} onClose={() => done(null)}>
        <Input value={text} onChangeText={setText} autoFocus onSubmitEditing={() => done(text.trim() || null)} />
        <View style={[s.row, { gap: 10, marginTop: 14 }]}>
          <Button title="Cancel" variant="ghost" onPress={() => done(null)} style={{ flex: 1 }} />
          <Button title="OK" onPress={() => done(text.trim() || null)} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </PromptContext.Provider>
  );
}
export const usePrompt = () => useContext(PromptContext);

/**
 * A list of cards in place of the web's data tables.
 * `rows` null/undefined = still loading (skeleton); [] = empty.
 */
export function DataList({ rows, render, empty = 'Nothing to show.', keyOf = (r, i) => r.id ?? i }) {
  if (rows == null) return <View style={{ gap: 10 }}><Skeleton /><Skeleton /><Skeleton /></View>;
  if (!rows.length) return <Empty icon="list">{empty}</Empty>;
  return <View style={{ gap: 10 }}>{rows.map((r, i) => <View key={keyOf(r, i)}>{render(r, i)}</View>)}</View>;
}

const ACCENT_BAR = { live: C.live, delayed: C.delayed, danger: C.danger, offline: C.offline, info: C.indigo };

/** One record card: title, subtitle, right-hand badge, and extra lines. */
export function ItemCard({ title, subtitle, right, children, onPress, highlight, tone }) {
  const Wrap = onPress ? Pressable : View;
  const bar = ACCENT_BAR[tone];
  return (
    <Wrap
      onPress={onPress}
      style={onPress
        ? ({ pressed }) => [s.item, highlight && s.itemOn, pressed && { opacity: 0.85 }]
        : [s.item, highlight && s.itemOn]}
    >
      <Sheen radius={R.lg - 4} />
      {bar ? <View style={[s.itemBar, { backgroundColor: bar }]} /> : null}
      <View style={[s.row, { alignItems: 'flex-start', gap: 8 }]}>
        <View style={{ flex: 1 }}>
          {typeof title === 'string' ? <Text style={s.itemTitle}>{title}</Text> : title}
          {subtitle ? (typeof subtitle === 'string' ? <Txt muted small style={{ marginTop: 2 }}>{subtitle}</Txt> : subtitle) : null}
        </View>
        {right}
      </View>
      {children ? <View style={s.itemBody}>{children}</View> : null}
    </Wrap>
  );
}

/** Label / value line inside a card. */
export const KV = ({ k, v }) => (
  <View style={[s.row, { gap: 8, alignItems: 'flex-start' }]}>
    <Txt muted small style={{ width: 96 }}>{k}</Txt>
    {typeof v === 'string' || typeof v === 'number' || v == null ? <Txt small bold style={{ flex: 1, ...F[600] }}>{v ?? '—'}</Txt> : <View style={{ flex: 1, alignItems: 'flex-start' }}>{v}</View>}
  </View>
);

export const RouteCode = ({ code, small }) => (
  <LinearGradient colors={G.navy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.routeCode, small && { minWidth: 34, paddingVertical: 2, borderRadius: 7 }]}>
    <Text style={[s.routeCodeText, small && { fontSize: 12 }]}>{code}</Text>
  </LinearGradient>
);

/** ‹ October 2026 › (the web's <input type="month">). */
export function MonthPicker({ value, onChange, light }) {
  const atNow = value >= thisMonth();
  const color = light ? '#fff' : C.navy;
  const btn = [s.monthBtn, light && { backgroundColor: 'rgba(255,255,255,0.18)' }];
  return (
    <View style={[s.row, { gap: 8, alignSelf: 'flex-start' }]}>
      <Pressable hitSlop={8} onPress={() => onChange(shiftMonth(value, -1))} accessibilityLabel="Previous month" style={btn}><Icon name="back" size={16} color={color} /></Pressable>
      <Text style={[s.bold, { color, minWidth: 116, textAlign: 'center' }]}>{monthName(value)}</Text>
      <Pressable hitSlop={8} disabled={atNow} onPress={() => onChange(shiftMonth(value, 1))} style={[btn, { opacity: atNow ? 0.35 : 1 }]} accessibilityLabel="Next month"><Icon name="arrow" size={16} color={color} /></Pressable>
    </View>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocal = (d) => `${toDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Date or date-and-time field (the web's <input type="date"> / "datetime-local").
 * value: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" in phone-local time; "" for none.
 */
export function DateField({ label, value, onChange, mode = 'date', clearable }) {
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());
  const current = value ? new Date(mode === 'date' ? `${value}T00:00` : value) : new Date();
  const fmt = (d) => (mode === 'date' ? toDay(d) : toLocal(d));
  if (Platform.OS === 'web') {
    // Browser preview: plain text entry.
    return <TextField label={label} value={value} onChangeText={onChange} placeholder={mode === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm'} />;
  }
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        onValueChange: (_e, d) => {
          if (mode === 'date') return onChange(fmt(d));
          DateTimePickerAndroid.open({
            value: d,
            mode: 'time',
            is24Hour: false,
            onValueChange: (_e2, t) => {
              const x = new Date(d);
              x.setHours(t.getHours(), t.getMinutes(), 0, 0);
              onChange(fmt(x));
            },
          });
        },
      });
    } else {
      setDraft(current);
      setIosOpen(true);
    }
  };
  const shown = value ? (mode === 'date' ? value : value.replace('T', ' ')) : 'Any';
  return (
    <Field label={label}>
      <View style={[s.row, { gap: 8 }]}>
        <Pressable onPress={open} style={[s.inputWrap, { flex: 1 }]} accessibilityRole="button" accessibilityLabel={label}>
          <Icon name="clock" size={16} color={C.faint} />
          <Text style={[s.input, { paddingVertical: 13 }, !value && { color: C.faint }]}>{shown}</Text>
        </Pressable>
        {clearable && value ? <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear"><Icon name="x" size={18} color={C.muted} /></Pressable> : null}
      </View>
      {Platform.OS === 'ios' && (
        <Sheet visible={iosOpen} title={label} onClose={() => setIosOpen(false)}>
          <DateTimePicker value={draft} mode={mode === 'date' ? 'date' : 'datetime'} display="inline" onValueChange={(_e, d) => d && setDraft(d)} />
          <Button title="Done" onPress={() => { setIosOpen(false); onChange(fmt(draft)); }} />
        </Sheet>
      )}
    </Field>
  );
}

/** Expandable section (the web's <details>). */
/** Folding sections ease open and shut instead of jumping. */
const foldNext = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

/**
 * A card that folds away: icon, title and a one-line summary always show;
 * the body opens on tap. Keeps secondary sections compact.
 */
export function FoldCard({ icon, title, summary, badge, children, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[s.panel, { gap: open ? 14 : 0 }]}>
      <Sheen />
      <Pressable onPress={() => { foldNext(); setOpen((o) => !o); }} style={[s.row, { gap: 12 }]} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title}>
        {icon ? <IconBubble name={icon} colors={G.navy} size={36} iconSize={18} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.h3} numberOfLines={1}>{title}</Text>
          {summary ? <Txt muted small numberOfLines={1}>{summary}</Txt> : null}
        </View>
        {badge}
        <View style={[s.monthBtn, { width: 30, height: 30, borderRadius: 15 }]}><Icon name={open ? 'up' : 'down'} size={15} color={C.navy} /></View>
      </Pressable>
      {open ? <View style={{ gap: 12 }}>{children}</View> : null}
    </View>
  );
}

export function Collapsible({ title, children, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View>
      <Pressable onPress={() => { foldNext(); setOpen((o) => !o); }} style={[s.row, { gap: 8, paddingVertical: 4 }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={[s.monthBtn, { width: 24, height: 24 }]}><Icon name={open ? 'down' : 'arrow'} size={13} color={C.navy} /></View>
        <Text style={[s.bold, { color: C.navy, flex: 1 }]} numberOfLines={1}>{title}</Text>
      </Pressable>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

export const Row = ({ children, style, gap = 8, wrap }) => <View style={[s.row, { gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;

export const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  screen: { padding: 16, paddingBottom: 48, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  txt: { color: C.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: C.muted },
  small: { fontSize: 13, lineHeight: 18 },
  bold: { ...F[700], color: C.ink },
  section: { flex: 1, fontSize: 11.5, ...F[700], letterSpacing: 2, color: C.muted, textTransform: 'uppercase' },
  sectionRule: { width: 18, height: 1.5, borderRadius: 1, backgroundColor: C.gold, marginRight: 10 },
  eyebrowLight: { fontSize: 10.5, ...F[700], letterSpacing: 2.2, color: C.gold, marginBottom: 4 },
  bannerTitle: { fontSize: 26, ...F.display, color: '#fff', lineHeight: 32 },
  bannerSub: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 21 },
  bannerIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(247, 188, 49,0.10)', borderWidth: 1, borderColor: HAIRLINE.gold, alignItems: 'center', justifyContent: 'center' },
  orb: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
  orbRing: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(249, 210, 122,0.14)' },
  orbGold: { position: 'absolute', backgroundColor: 'rgba(247, 188, 49,0.10)' },
  heroSheen: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: HAIRLINE.gold },
  headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerBadge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: C.gold, borderWidth: 2, borderColor: C.navy900, alignItems: 'center', justifyContent: 'center' },
  headerBadgeText: { color: C.navy900, fontSize: 10, ...F[700] },
  h2: { fontSize: 22, ...F.display, color: C.ink },
  h3: { fontSize: 17, ...F[600], color: C.ink, flexShrink: 1, lineHeight: 23 },
  panel: { ...glass, borderRadius: R.lg, padding: 18, gap: 14, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { ...glass, flexGrow: 1, flexBasis: '46%', borderRadius: R.lg, padding: 14, minHeight: 76, justifyContent: 'center', overflow: 'hidden' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statValue: { fontSize: 24, ...F.display, color: C.ink, fontVariant: ['tabular-nums'], lineHeight: 30 },
  statLabel: { fontSize: 10.5, color: C.muted, marginTop: 1, ...F[600], letterSpacing: 0.6, textTransform: 'uppercase', lineHeight: 14 },
  statBar: { position: 'absolute', left: 0, top: 18, bottom: 18, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11.5, ...F[600], letterSpacing: 0.3 },
  alert: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: R.md, borderWidth: 1 },
  alertText: { flex: 1, fontSize: 14, lineHeight: 20, ...F[600] },
  empty: { color: C.muted, textAlign: 'center', fontSize: 14, maxWidth: 280 },
  skeleton: { backgroundColor: C.line, borderRadius: R.md },
  btn: { minHeight: 54, borderRadius: R.md, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  btnSmall: { minHeight: 38, borderRadius: R.sm, paddingHorizontal: 12 },
  btnText: { fontSize: 14.5, ...F[600], letterSpacing: 0.6 },
  link: { color: C.red600, ...F[700], fontSize: 13.5, letterSpacing: 0.3 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.pill, alignSelf: 'flex-start' },
  field: { gap: 7 },
  label: { fontSize: 11.5, ...F[700], color: C.muted, letterSpacing: 1.2, textTransform: 'uppercase' },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(28,49,94,0.16)', borderRadius: R.md, backgroundColor: 'rgba(255,255,255,0.78)', paddingHorizontal: 16, minHeight: 54 },
  // Focus changes the border only: no shadow or elevation that could rebuild the native view.
  inputFocused: { borderColor: C.navy },
  input: { flex: 1, fontSize: 15, color: C.ink, ...F[400], paddingVertical: Platform.OS === 'ios' ? 14 : 10 },
  selectCompact: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 9 },
  selectCompactText: { color: '#fff', ...F[700], fontSize: 14, flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: R.md, marginBottom: 2 },
  optionOn: { backgroundColor: C.red50 },
  optionCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  segmented: { backgroundColor: 'rgba(255,255,255,0.6)', borderWidth: 1, borderColor: 'rgba(28,49,94,0.12)', borderRadius: R.pill, padding: 4, gap: 4 },
  seg: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: R.pill },
  segOn: { backgroundColor: C.navy, ...shadow, shadowOpacity: 0.14 },
  segText: { fontSize: 13.5, ...F[600], color: C.muted, letterSpacing: 0.3 },
  segTextOn: { color: '#fff', ...F[700] },
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 37, 72,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'rgba(236,240,248,0.88)', borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', padding: 22, paddingTop: 12, maxHeight: '90%', gap: 14, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#d6d6d6', marginBottom: 8 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.glassEdge, alignItems: 'center', justifyContent: 'center' },
  item: { ...glass, borderRadius: R.lg - 4, padding: 16, overflow: 'hidden', shadowOpacity: 0.05 },
  itemOn: { borderColor: C.gold, backgroundColor: C.red50 },
  itemBar: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  itemTitle: { fontSize: 15, ...F[700], color: C.ink },
  itemBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line2, gap: 7 },
  routeCode: { borderRadius: R.sm, paddingHorizontal: 9, paddingVertical: 5, minWidth: 44, alignItems: 'center', borderWidth: 1, borderColor: HAIRLINE.gold },
  routeCodeText: { color: C.gold, ...F[700], fontSize: 14, letterSpacing: 0.5 },
  monthBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.navy50, alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: '#fff', ...F.brand, fontSize: 18, lineHeight: 22 },
  wordmarkSub: { color: C.gold, ...F.navBold, fontSize: 8.5, letterSpacing: 3.6, lineHeight: 11 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingLeft: 7, paddingRight: 8, borderRadius: R.pill, borderWidth: 1 },
  // A fine gold line along the pill's lower edge.
  pillGold: { position: 'absolute', left: 28, right: 28, bottom: 0, height: 1, backgroundColor: 'rgba(247,188,49,0.45)' },
  pillSolid: { backgroundColor: C.glassDark, borderColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', ...shadowLg, shadowOpacity: 0.22, elevation: 0 },
  pillGlass: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(255,255,255,0.14)' },
  pillTitle: { color: '#fff', fontSize: 16.5, lineHeight: 21, ...F.navBold },
  pillEyebrow: { color: C.gold, fontSize: 8.5, lineHeight: 11, letterSpacing: 2.4, ...F.navBold },
  pillRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  pillCta: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.gold, ...glow(C.gold), shadowOpacity: 0.3 },
  pillCtaText: { color: C.navy900, ...F[700], fontSize: 13.5, letterSpacing: 0.2 },
});
