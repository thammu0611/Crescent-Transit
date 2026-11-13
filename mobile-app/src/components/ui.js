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
import { createContext, forwardRef, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Easing, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text as RNText, TextInput, useWindowDimensions, View, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, G as SvgG, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { monthName, shiftMonth, thisMonth } from '../lib/format.js';
import { tickPress, tickSelect } from '../lib/haptics.js';
import { useT } from '../lib/offline.js';
import { DIRECTION_TEXT } from '../lib/rules.js';
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

// The backdrop's colours: the same quiet transit map as the web app (redesign.css --bgx-*).
const BG = C.dark
  ? { glowA: '#3C5AA0', glowAo: 0.22, glowB: '#F7BC31', glowBo: 0.07, casing: 'rgba(13,21,36,0.7)', line: 'rgba(150,175,235,0.20)', soft: 'rgba(150,175,235,0.11)', stopFill: '#0D1524', stop: 'rgba(150,175,235,0.45)', halo: 'rgba(150,175,235,0.08)', mine: '#F7BC31', campus: '#6FD487', bus: '#F7BC31' }
  : { glowA: '#1C315E', glowAo: 0.10, glowB: '#F7BC31', glowBo: 0.10, casing: 'rgba(255,255,255,0.75)', line: 'rgba(28,49,94,0.16)', soft: 'rgba(28,49,94,0.09)', stopFill: '#FFFFFF', stop: 'rgba(28,49,94,0.35)', halo: 'rgba(28,49,94,0.06)', mine: '#F7BC31', campus: '#237A36', bus: '#1C315E' };
const BG_ROUTES = [
  { d: 'M-30 150 C 60 110, 130 220, 220 190 S 330 110, 420 170', tone: 'main' },
  { d: 'M-30 560 C 70 510, 150 630, 240 580 S 350 480, 420 540', tone: 'dashed' },
  { d: 'M300 -30 C 330 160, 250 300, 310 460 S 370 700, 320 880', tone: 'soft' },
];
// [x, y, kind]: plain stops, the amber "your stop" and the green campus.
const BG_STOPS = [[62, 131], [220, 190, 'mine'], [352, 136, 'campus'], [96, 548], [240, 580], [348, 512], [286, 300], [311, 468]];
// [x, y, degrees]: two small buses parked on their routes.
const BG_BUSES = [[132, 187, 18], [168, 600, -8]];

/**
 * The page ground behind every screen: the app's colour with a quiet transit
 * map - two soft glows, a few bus routes with their stops (one
 * amber "your stop", one green campus) and two small buses. Cards are solid,
 * so it only shows in the gaps. It is still: nothing here animates.
 */
export const GlassBackdrop = memo(function GlassBackdrop({ offset = 0, top = -offset }) {
  const { height } = useWindowDimensions();
  const tall = Math.max(height, 640) + offset;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height: tall, backgroundColor: C.bg, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="ctBgA" cx="0%" cy="0%" r="75%">
            <Stop offset="0" stopColor={BG.glowA} stopOpacity={BG.glowAo} />
            <Stop offset="1" stopColor={BG.glowA} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ctBgB" cx="100%" cy="100%" r="70%">
            <Stop offset="0" stopColor={BG.glowB} stopOpacity={BG.glowBo} />
            <Stop offset="1" stopColor={BG.glowB} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={390} height={844} fill="url(#ctBgA)" />
        <Rect x={0} y={0} width={390} height={844} fill="url(#ctBgB)" />
        {BG_ROUTES.map((r) => (
          <SvgG key={r.d}>
            <Path d={r.d} stroke={BG.casing} strokeWidth={8} fill="none" strokeLinecap="round" />
            <Path d={r.d} stroke={r.tone === 'soft' ? BG.soft : BG.line} strokeWidth={r.tone === 'dashed' ? 3 : 2.5} strokeDasharray={r.tone === 'dashed' ? '2 10' : undefined} fill="none" strokeLinecap="round" />
          </SvgG>
        ))}
        {BG_STOPS.map(([x, y, kind]) => (
          <SvgG key={`${x},${y}`}>
            <Circle cx={x} cy={y} r={kind ? 11 : 8} fill={kind === 'mine' ? BG.mine : kind === 'campus' ? BG.campus : BG.halo} opacity={kind ? 0.16 : 1} />
            <Circle cx={x} cy={y} r={kind ? 5 : 4} fill={kind === 'mine' ? BG.mine : kind === 'campus' ? BG.campus : BG.stopFill} stroke={kind ? BG.stopFill : BG.stop} strokeWidth={2} />
          </SvgG>
        ))}
        {BG_BUSES.map(([x, y, deg]) => (
          <SvgG key={`${x},${y}`} transform={`translate(${x} ${y}) rotate(${deg})`} opacity={0.5}>
            <Rect x={-13} y={-7} width={26} height={14} rx={4.5} fill={BG.bus} />
            <Rect x={5} y={-5} width={5} height={10} rx={2} fill="rgba(255,255,255,0.9)" />
            <Rect x={-10} y={-4.5} width={12} height={9} rx={2} fill="rgba(255,255,255,0.32)" />
          </SvgG>
        ))}
      </Svg>
    </View>
  );
});

/** Real frosted glass behind a surface (header, tab bar, sheets). */
export function Frost({ tint = C.dark ? 'dark' : 'light', intensity = 50, style }) {
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

/** Kept for older call sites: the redesign's cards have no gloss. */
// eslint-disable-next-line no-unused-vars
export function Sheen(props) {
  return null;
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

// The phone's "remove animations" setting: cards then appear at once.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = v; }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = v; });

// Cards that appear together (a screen opening, a list arriving) come in as a
// short cascade: each one 60 ms after the one before, at most 360 ms.
const cascade = { at: 0, n: 0 };
function nextCascadeDelay() {
  const now = Date.now();
  if (now - cascade.at > 250) cascade.n = 0;
  cascade.at = now;
  const d = Math.min(cascade.n, 6) * 60;
  cascade.n += 1;
  return d;
}

/** Fades and slides its content in when it first appears (in a cascade unless given a delay). */
export function FadeIn({ children, delay: fixedDelay, style }) {
  const [delay] = useState(() => fixedDelay ?? nextCascadeDelay());
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
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

/** A deep-blue (dark: elevated) gradient surface for hero cards and banners. */
// Dark mode: banners and gradient cards take the same mild dark glass as every other card.
const DARK_CARD = ['#1F3157', '#18233A'];

export function GradientCard({ colors = G.navy, style, children, orbs = true, radius = R.xl, animate = true }) {
  const card = (
    <LinearGradient colors={C.dark ? DARK_CARD : colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius, padding: 20, overflow: 'hidden', gap: 10, borderWidth: 1, borderColor: C.dark ? C.glassEdge : HAIRLINE.light }, shadowLg, style]}>
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
  // The docked bar's measured height already includes the safe area.
  return barHeight ? barHeight + 12 : 0;
}

/**
 * The Crescent Transit mark: a gold bus on a crescent, in a double gold frame.
 * The web app shows the same picture (client/src/assets/logo-mark.png).
 */
export function BrandMark({ size = 46 }) {
  return <Image source={require('../../assets/logo-mark.png')} style={{ width: size, height: size, borderRadius: size * 0.22 }} accessibilityIgnoresInvertColors />;
}

/** The app name: "Crescent" in Montserrat, "TRANSIT" in small spaced gold capitals beneath. */
// In light mode the header is white frosted glass, so what sits on it is navy;
// in dark mode it is the same dark glass as the cards, with white on it.
const PILL_LIGHT = !C.dark;
const ON_PILL = C.ink;

/** The logo's wordmark: "Crescent" over a spaced capital "TRANSIT". */
export const Wordmark = ({ style, dark }) => (
  <View style={[{ justifyContent: 'center' }, style]} accessibilityRole="header" accessibilityLabel="Crescent Transit">
    <Text style={[s.wordmark, dark && { color: C.navy }]} numberOfLines={1}>Crescent</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {/* A short line in the logo's crescent gold leads into "TRANSIT". */}
      <View style={{ width: 14, height: 1.5, borderRadius: 1, backgroundColor: '#beaf8e' }} />
      <Text style={[s.wordmarkSub, dark && { color: C.navy }]} numberOfLines={1}>TRANSIT</Text>
    </View>
  </View>
);

/** A round button for the pill (back, sign out, menu). */
export function PillIconButton({ icon, onPress, label }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.pillBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}>
      <Icon name={icon} size={18} color={ON_PILL} />
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
/** The screen's name under a small gold app name; it slides in when the screen changes. */
function PillTitle({ title }) {
  const [v] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [title, v]);
  return (
    <Animated.View
      style={{ flex: 1, justifyContent: 'center', opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}
      accessibilityRole="header"
    >
      <View style={s.pillEyebrowRow}>
        <View style={s.pillEyebrowDot} />
        <Text style={s.pillEyebrow} numberOfLines={1}>CRESCENT TRANSIT</Text>
      </View>
      <Text style={s.pillTitle} numberOfLines={1}>{title}</Text>
    </Animated.View>
  );
}

export function NavPill({ title, onBack, right, glass, plain, style }) {
  // `plain`: no capsule at all, the logo and title sit straight on the page (screen headers).
  if (plain) {
    return (
      <View style={[s.pill, s.pillPlain, style]}>
        {onBack ? <PillIconButton icon="back" label="Back" onPress={onBack} /> : <BrandMark size={44} />}
        {title ? <PillTitle title={title} /> : <Wordmark style={{ flex: 1 }} />}
        {right ? <View style={s.pillRight}>{right}</View> : null}
      </View>
    );
  }
  return (
    <View style={[s.pill, PILL_LIGHT ? s.pillWhite : C.dark ? s.pillCard : glass ? s.pillGlass : s.pillSolid, style]}>
      {PILL_LIGHT ? <Frost tint="light" intensity={70} style={{ borderRadius: R.pill }} /> : null}
      {PILL_LIGHT ? <Sheen radius={R.pill} /> : null}
      {(!glass || C.dark) && !PILL_LIGHT ? <Frost tint="dark" intensity={60} style={{ borderRadius: R.pill }} /> : null}
      {!glass && !PILL_LIGHT && !C.dark ? <LinearGradient pointerEvents="none" colors={['rgba(42,71,135,0.55)', 'rgba(20,37,72,0.15)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: R.pill }]} /> : null}
      {!glass && !PILL_LIGHT ? <Sheen radius={R.pill} dark /> : null}
      {/* A gold hairline that fades out at both ends. */}
      {!glass && !PILL_LIGHT && !C.dark ? <LinearGradient pointerEvents="none" colors={['rgba(247,188,49,0)', 'rgba(247,188,49,0.75)', 'rgba(247,188,49,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.pillGold} /> : null}
      {onBack ? <PillIconButton icon="back" label="Back" onPress={onBack} /> : <BrandMark size={44} />}
      {title ? <PillTitle title={title} /> : <Wordmark style={{ flex: 1 }} />}
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
  const right = options.headerRight?.({ tintColor: ON_PILL, canGoBack: Boolean(back) });
  const t = useT();
  // Screens that once carried their own banner set an empty headerTitle; the title now lives here.
  const title = t((typeof options.headerTitle === 'string' && options.headerTitle) || options.title || route.name);
  // The header's height, so its slice of the backdrop is drawn exactly as the screen's own
  // (which is shifted up behind the header by this much): the two meet without a seam.
  const [h, setH] = useState(0);
  // No header bar: just the screen's title (with a back arrow and the screen's own
  // buttons when it has them) on a transparent strip, so the background runs to the top.
  return (
    <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={{ overflow: 'hidden', backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: insets.top + 56 }}>
      <GlassBackdrop offset={h} top={0} />
      {back ? <PillIconButton icon="back" label="Back" onPress={navigation.goBack} /> : null}
      <Text style={s.plainTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{right}</View> : null}
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
    <LinearGradient colors={C.dark ? DARK_CARD : colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + (compact ? 16 : 22), paddingHorizontal: 20, paddingBottom: compact ? 54 : 56, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' }}>
      {focused ? <StatusBar style="light" /> : null}
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
    <Pressable accessibilityRole="button" onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [s.headerBtn, dark && { backgroundColor: C.paper, borderColor: C.line2, ...shadow }, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Icon name={icon} size={20} color={dark ? C.ink : '#fff'} />
      {badge ? <View style={s.headerBadge}><Text style={s.headerBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
    </Pressable>
  );
}

/** A section label with an optional action link. */
export function SectionTitle({ title, action, onAction }) {
  const t = useT();
  return (
    <View style={[s.row, { marginTop: 6, marginBottom: -4 }]}>
      <View style={s.sectionRule} />
      <Text style={s.section}>{t(title)}</Text>
      {action ? <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}><Text style={s.link}>{action}</Text></Pressable> : null}
    </View>
  );
}

/**
 * The top of an inner screen: just its title on the page background, as on the
 * tabs with a header. When the navigator already shows the title above, nothing
 * is repeated here (only the screen's actions, if any).
 */
// eslint-disable-next-line no-unused-vars
export function PageHead({ eyebrow, title: name, subtitle, actions, icon, colors }) {
  const t = useT();
  const title = t(name);
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const showTitle = Boolean(title) && !headerHeight;
  if (!showTitle && !actions) return null;
  return (
    <View style={{ gap: 10, paddingTop: 2 }}>
      {showTitle ? <Text style={[s.plainTitle, { flex: 0 }]} accessibilityRole="header">{title}</Text> : null}
      {actions ? <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{actions}</View> : null}
    </View>
  );
}

const PANEL_ACCENT = { navy: 'navy', emerald: 'emerald', indigo: 'indigo', red: 'danger', danger: 'danger', violet: 'violet' };

export function Panel({ title: name, icon, actions, children, style, accent = 'navy', summary, badge }) {
  const t = useT();
  const title = name ? t(name) : name;
  return (
    <FadeIn style={[s.panel, style]}>
      <Sheen />
      {title || actions ? (
        <View style={s.panelHead}>
          {title ? (
            <View style={[s.row, { flex: 1, minWidth: 0, gap: 10 }]}>
              {icon ? <IconBubble name={icon} accent={PANEL_ACCENT[accent] ?? 'navy'} size={36} iconSize={18} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.h3}>{title}</Text>
                {summary ? <Txt muted small numberOfLines={2}>{summary}</Txt> : null}
              </View>
            </View>
          ) : <View style={{ flex: 1 }} />}
          {badge || actions ? <View style={[s.row, { gap: 6 }]}>{badge}{actions}</View> : null}
        </View>
      ) : null}
      {children}
    </FadeIn>
  );
}

/**
 * One record in a list of cards: a lead (avatar, route code or icon), title and lines,
 * an optional count pill, and an arrow when it opens something.
 */
export function ListCard({ lead, title, lines = [], count, countLabel, tone, right, onPress }) {
  const Wrap = onPress ? Pressable : View;
  const bar = tone ? ACCENT_BAR[tone] : null;
  const look = { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, borderLeftWidth: bar ? 4 : 1, borderLeftColor: bar ?? C.glassEdge };
  return (
    <Wrap onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={onPress ? ({ pressed }) => [look, pressed && { opacity: 0.8 }] : look}>
      {lead}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt bold numberOfLines={1}>{title}</Txt>
        {lines.filter(Boolean).map((l, i) => <Txt key={i} small muted numberOfLines={2}>{l}</Txt>)}
      </View>
      {right}
      {count != null ? (
        <View style={{ alignItems: 'center', minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, backgroundColor: C.navy50 }}>
          <Text style={{ fontSize: 20, ...F.display, color: C.navy, fontVariant: ['tabular-nums'] }}>{count}</Text>
          <Text style={{ fontSize: 10, ...F[600], color: C.muted, letterSpacing: 0.5 }}>{countLabel}</Text>
        </View>
      ) : null}
      {onPress ? <Icon name="arrow" size={16} color={C.faint} /> : null}
    </Wrap>
  );
}

const STAT_ACCENT = { live: 'emerald', delayed: 'amber', danger: 'danger', offline: 'navy' };

export function Stat({ label: name, value, tone, icon }) {
  const label = useT()(name);
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

/** Which run of the route: UP (to college) or DOWN (from college). */
export function DirectionBadge({ direction }) {
  return direction ? <Badge tone={direction === 'DOWN' ? 'offline' : 'info'}>{DIRECTION_TEXT[direction]}</Badge> : null;
}

const BADGE_ICON = { delayed: 'clock', danger: 'alert' };

/** Status chip: a shape (live dot, clock, alert) plus a word, never colour alone. */
export function Badge({ tone = 'offline', children, dot = true, style }) {
  const t = TONE[tone] ?? TONE.offline;
  const icon = BADGE_ICON[tone];
  return (
    <View style={[s.badge, { backgroundColor: t.bg }, style]}>
      {dot ? (icon ? <Icon name={icon} size={12} color={t.fg} strokeWidth={2.4} /> : <View style={[s.badgeDot, { backgroundColor: t.fg }, tone === 'offline' && { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.fg }]} />) : null}
      <Text style={[s.badgeText, { color: t.fg }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

export const YesNo = ({ value, yes = 'Yes', no = 'No', noTone = 'offline' }) => <Badge tone={value ? 'live' : noTone}>{value ? yes : no}</Badge>;

export const ErrorText = ({ children }) => (children ? (
  <View style={[s.alert, { backgroundColor: C.danger50, borderColor: C.dark ? 'rgba(239,68,68,0.35)' : 'rgba(220,38,38,0.25)' }]} accessibilityRole="alert">
    <Icon name="alert" size={16} color={C.danger} />
    <Text style={[s.alertText, { color: C.danger }]}>{children}</Text>
  </View>
) : null);
export const Notice = ({ children }) => (children ? (
  <View style={[s.alert, { backgroundColor: C.emerald50, borderColor: C.dark ? 'rgba(34,197,94,0.3)' : 'rgba(22,163,74,0.25)' }]}>
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
  primary: { bg: C.navyFill, fg: '#fff' },
  dark: { bg: C.dark ? C.raised : '#1E293B', fg: '#fff' },
  indigo: { bg: C.navyFill, fg: '#fff' },
  danger: { bg: C.dangerFill, fg: '#fff' },
  red: { bg: C.navyFill, fg: '#fff' },
  emerald: { bg: C.dark ? '#15803D' : '#15803D', fg: '#fff' },
  ghost: { bg: C.raised, fg: C.ink, border: C.line },
  soft: { bg: C.navy50, fg: C.dark ? C.navy : C.red600, border: 'transparent' },
  light: { bg: C.card, fg: C.ink, border: C.line },
};

export function Button({ title: name, onPress, variant = 'primary', icon, disabled, busy, small, style, textStyle }) {
  const title = useT()(name);
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
      accessibilityState={{ disabled: off, busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      onPressIn={tickPress}
      style={({ pressed }) => [
        { borderRadius: small ? R.sm : R.md },
        off && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.92 },
        style,
      ]}
    >
      <View style={[box, { flexGrow: 1, backgroundColor: v.bg, borderWidth: v.border ? 1 : 0, borderColor: v.border }]}>{content}</View>
    </Pressable>
  );
}

/** A text link styled action, for row actions. */
export function LinkButton({ title, onPress, danger, icon }) {
  const color = danger ? C.danger : C.indigo;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => [s.linkBtn, { backgroundColor: danger ? C.danger50 : C.indigo50 }, pressed && { opacity: 0.6 }]}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Text style={[s.link, { color, fontSize: 13 }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label: name, hint, children, style }) {
  const label = useT()(name);
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
export function Select({ label, value, onChange, options, placeholder = 'Choose…', disabled, hint, searchable, style, compact, trigger }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => String(o.value) === String(value));
  const list = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  const search = searchable ?? options.length > 12;
  // `trigger(open, current)` draws a custom button (the route pill on the map).
  const control = trigger ? trigger(() => { setQ(''); setOpen(true); }, current) : (
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
      <Icon name="down" size={16} color={C.muted} />
    </Pressable>
  );
  return (
    <>
      {compact || trigger ? control : <Field label={label} hint={hint} style={style}>{control}</Field>}
      <Sheet visible={open} title={label ?? placeholder} onClose={() => setOpen(false)} scroll={false}>
        {search && <SearchBox value={q} onChange={setQ} placeholder="Search" />}
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {list.map((o) => {
            const on = String(o.value) === String(value);
            return (
              <Pressable accessibilityRole="button" key={String(o.value)} onPress={() => { setOpen(false); onChange(o.value); }} style={({ pressed }) => [s.option, on && s.optionOn, pressed && { backgroundColor: C.surface }]}>
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

export function Segmented({ value, onChange, options: list, full }) {
  const t = useT();
  const options = list.map((o) => ({ ...o, label: t(o.label) }));
  // Up to three options share the full width; more scroll sideways.
  const fill = full ?? options.length <= 3;
  const items = options.map((o) => {
    const on = value === o.value;
    return (
      <Pressable key={String(o.value)} onPress={() => { if (!on) tickSelect(); onChange(o.value); }} style={[s.seg, fill && { flex: 1, alignItems: 'center', paddingHorizontal: 4 }, on && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
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
      {value ? <Pressable accessibilityRole="button" onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="x" size={16} color={C.faint} /></Pressable> : null}
    </View>
  );
}

/** A bottom sheet (the web's Modal). */
export function Sheet({ visible = true, title, onClose, children, scroll = true }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose?.()} statusBarTranslucent>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => onClose?.()} />
        <View style={[s.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <Frost intensity={70} style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32 }} />
          <View style={s.grabber} />
          {title || onClose ? (
            <View style={[s.row, { marginBottom: 6 }]}>
              <Text style={[s.h2, { flex: 1 }]}>{title ?? ''}</Text>
              {onClose ? (
                <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={s.closeBtn}><Icon name="x" size={18} color={C.muted} /></Pressable>
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

/**
 * A centred dialog for destructive actions: a warning icon, a plain title,
 * what will happen, and two buttons where the safe one comes first.
 */
export function DangerDialog({ title, message, keepLabel = 'Keep', okLabel, onKeep, onOk, busy }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onKeep}>
      <View style={{ flex: 1, backgroundColor: 'rgba(5,8,12,0.6)', justifyContent: 'center', padding: 20 }}>
        <View accessibilityRole="alert" style={{ backgroundColor: C.surface, borderRadius: 24, padding: 22, gap: 14, borderWidth: 1, borderColor: C.line2, ...shadowLg }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: C.danger50, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="alert" size={24} color={C.danger} />
          </View>
          <Text style={{ fontSize: 21, lineHeight: 27, ...F.displayBold, color: C.ink }}>{title}</Text>
          {message ? <Text style={{ fontSize: 15, lineHeight: 22, color: C.muted }}>{message}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button title={keepLabel} variant="ghost" onPress={onKeep} style={{ flex: 1 }} />
            <Button title={okLabel} variant="danger" busy={busy} onPress={onOk} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

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
  <View style={[s.routeCode, small && { minWidth: 34, paddingVertical: 2, borderRadius: 7 }]}>
    <Text style={[s.routeCodeText, small && { fontSize: 12 }]}>{code}</Text>
  </View>
);

/** ‹ October 2026 › (the web's <input type="month">). */
export function MonthPicker({ value, onChange, light }) {
  const atNow = value >= thisMonth();
  const color = light ? '#fff' : C.navy;
  const btn = [s.monthBtn, light && { backgroundColor: 'rgba(255,255,255,0.18)' }];
  return (
    <View style={[s.row, { gap: 8, alignSelf: 'flex-start' }]}>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChange(shiftMonth(value, -1))} accessibilityLabel="Previous month" style={btn}><Icon name="back" size={16} color={color} /></Pressable>
      <Text style={[s.bold, { color, minWidth: 116, textAlign: 'center' }]}>{monthName(value)}</Text>
      <Pressable accessibilityRole="button" hitSlop={8} disabled={atNow} onPress={() => onChange(shiftMonth(value, 1))} style={[btn, { opacity: atNow ? 0.35 : 1 }]} accessibilityLabel="Next month"><Icon name="arrow" size={16} color={color} /></Pressable>
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
        {clearable && value ? <Pressable accessibilityRole="button" onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear"><Icon name="x" size={18} color={C.muted} /></Pressable> : null}
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

/** Folding sections ease open and shut instead of jumping. */
const foldNext = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

/** Expandable section (the web's <details>). */
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
  section: { flex: 1, fontSize: 13, ...F[600], color: C.muted },
  sectionRule: { width: 0, height: 0 },
  eyebrowLight: { fontSize: 10.5, ...F[700], letterSpacing: 2.2, color: C.gold, marginBottom: 4 },
  bannerTitle: { fontSize: 26, ...F.display, color: '#fff', lineHeight: 32 },
  bannerSub: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 21 },
  bannerIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(247, 188, 49,0.10)', borderWidth: 1, borderColor: HAIRLINE.gold, alignItems: 'center', justifyContent: 'center' },
  orb: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
  orbRing: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(249, 210, 122,0.14)' },
  orbGold: { position: 'absolute', backgroundColor: 'rgba(247, 188, 49,0.10)' },
  heroSheen: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: HAIRLINE.gold },
  headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerBadge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: '#B5282A', borderWidth: 2, borderColor: C.dark ? C.bg : '#fff', alignItems: 'center', justifyContent: 'center' },
  headerBadgeText: { color: '#fff', fontSize: 10.5, ...F[700] },
  h2: { fontSize: 20, lineHeight: 26, ...F.display, color: C.ink },
  h3: { fontSize: 16, ...F[600], color: C.ink, flexShrink: 1, lineHeight: 22 },
  panel: { ...glass, borderRadius: R.lg, padding: 16, gap: 14, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { ...glass, shadowOpacity: 0, flexGrow: 1, flexBasis: '46%', borderRadius: 18, padding: 14, minHeight: 84, justifyContent: 'center', overflow: 'hidden' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statValue: { fontSize: 26, ...F.displayBold, color: C.ink, fontVariant: ['tabular-nums'], lineHeight: 32 },
  statLabel: { fontSize: 12.5, color: C.muted, marginTop: 2, ...F[500], lineHeight: 16 },
  statBar: { position: 'absolute', left: 0, top: 18, bottom: 18, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: R.pill, paddingHorizontal: 10, minHeight: 26, alignSelf: 'flex-start', borderWidth: 1, borderColor: C.line2 },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 12, ...F[600] },
  alert: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: R.md, borderWidth: 1 },
  alertText: { flex: 1, fontSize: 14, lineHeight: 20, ...F[600] },
  empty: { color: C.muted, textAlign: 'center', fontSize: 14, maxWidth: 280 },
  skeleton: { backgroundColor: C.dark ? '#1E2733' : '#E4E9F0', borderRadius: R.md },
  btn: { minHeight: 52, borderRadius: R.md, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { minHeight: 40, borderRadius: R.sm, paddingHorizontal: 12 },
  btnText: { fontSize: 15.5, ...F[600] },
  link: { color: C.link, ...F[600], fontSize: 14 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.pill, alignSelf: 'flex-start' },
  field: { gap: 7 },
  label: { fontSize: 13, ...F[600], color: C.muted },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line, borderRadius: R.md, backgroundColor: C.card, paddingHorizontal: 14, minHeight: 52 },
  // Focus changes the border only: no shadow or elevation that could rebuild the native view.
  inputFocused: { borderColor: C.navy },
  input: { flex: 1, fontSize: 15, color: C.ink, ...F[400], paddingVertical: Platform.OS === 'ios' ? 14 : 10 },
  selectCompact: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.line2, borderRadius: R.pill, paddingHorizontal: 14, minHeight: 40 },
  selectCompactText: { color: C.ink, ...F[600], fontSize: 14, flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: R.md, marginBottom: 2 },
  optionOn: { backgroundColor: C.navy50 },
  optionCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.navyFill, alignItems: 'center', justifyContent: 'center' },
  segmented: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.line2, borderRadius: R.md, padding: 4, gap: 4 },
  seg: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minHeight: 40, justifyContent: 'center' },
  segOn: { backgroundColor: C.dark ? '#2B3A5C' : C.card, ...shadow, shadowOpacity: C.dark ? 0.4 : 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segText: { fontSize: 13.5, ...F[600], color: C.muted },
  segTextOn: { color: C.ink, ...F[700] },
  backdrop: { flex: 1, backgroundColor: C.dark ? 'rgba(5,8,12,0.72)' : 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.dark ? 'rgba(18,28,48,0.80)' : 'rgba(241,241,241,0.80)', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.glassEdge, padding: 20, paddingTop: 10, maxHeight: '90%', gap: 14, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 8 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.raised, borderWidth: 1, borderColor: C.glassEdge, alignItems: 'center', justifyContent: 'center' },
  item: { ...glass, borderRadius: 16, padding: 16, overflow: 'hidden', shadowOpacity: 0 },
  itemOn: { borderColor: C.navy, backgroundColor: C.navy50 },
  itemBar: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  itemTitle: { fontSize: 15, ...F[700], color: C.ink },
  itemBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line2, gap: 7 },
  routeCode: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, minWidth: 44, alignItems: 'center', backgroundColor: C.navyFill },
  routeCodeText: { color: '#fff', ...F.displayBold, fontSize: 14 },
  monthBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: ON_PILL, ...F.brand, fontSize: 19, lineHeight: 23 },
  wordmarkSub: { color: PILL_LIGHT ? ON_PILL : C.muted, ...F[600], fontSize: 9.5, lineHeight: 12, letterSpacing: 4.6, marginTop: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingLeft: 8, paddingRight: 10, borderRadius: R.pill, borderWidth: 1 },
  // A fine gold line along the pill's lower edge.
  pillGold: { position: 'absolute', left: 24, right: 24, bottom: 0, height: 1.5 },
  pillSolid: { backgroundColor: C.glassDark, borderColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', ...shadowLg, shadowOpacity: 0.22, elevation: 0 },
  pillGlass: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(255,255,255,0.14)' },
  pillCard: { backgroundColor: C.glassStrong, borderColor: C.glassEdge, overflow: 'hidden', ...shadowLg, shadowOpacity: 0.3, elevation: 0 },
  pillPlain: { backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 4, paddingRight: 4 },
  pillWhite: { backgroundColor: 'rgba(255,255,255,0.74)', borderColor: 'rgba(255,255,255,0.85)', overflow: 'hidden', ...shadowLg, shadowColor: '#10264a', shadowOpacity: 0.16, elevation: 6 },
  pillTitle: { color: ON_PILL, fontSize: 19, lineHeight: 24, ...F.navTitle },
  plainTitle: { flex: 1, color: C.ink, fontSize: 28, lineHeight: 34, ...F.navTitle, letterSpacing: -0.4 },
  pillEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 },
  pillEyebrowDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: PILL_LIGHT ? '#b08a2e' : C.gold },
  pillEyebrow: { color: PILL_LIGHT ? '#8a6a1f' : C.gold, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.8, ...F.navBold },
  pillRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.line2 },
  pillCta: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.gold, ...glow(C.gold), shadowOpacity: 0.3 },
  pillCtaText: { color: C.onGold, ...F[700], fontSize: 13.5, letterSpacing: 0.2 },
});
