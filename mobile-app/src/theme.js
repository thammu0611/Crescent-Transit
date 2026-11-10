// Crescent Transit's palette (the 2026 redesign): a calm neutral ground, white
// cards, one blue accent (#2563EB) for actions and links, and functional status
// colours. Dark mode (applyDarkPalette) uses a near-black ground with
// elevated card surfaces. Older token names (navy, gold, red ...) are kept and
// mapped onto the new roles, so every screen picks up a change made here:
//   navy / red    -> accent (links, icons, selected states, primary buttons)
//   navyFill      -> primary button fill (white text passes AA in both themes)
//   gold          -> highlight on deep-blue hero surfaces
//   ink / muted / faint -> text, secondary text, captions
export const C = {
  navy: '#2563EB',
  navyFill: '#2563EB',
  navy900: '#0F172A',
  navy700: '#475569',
  navy100: '#D6E2FB',
  navy50: '#EAF1FF',
  gold: '#FBBF24',
  onGold: '#111827',
  red: '#2563EB',
  red600: '#1D4ED8',
  red50: '#EAF1FF',
  crimson: '#1D4ED8',
  slate: '#475569',
  link: '#1D4ED8',
  skyBlue: '#38BDF8',
  bg: '#F4F6F9',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  raised: '#EEF2F7',
  glass: '#FFFFFF',
  glassStrong: '#FFFFFF',
  glassEdge: 'rgba(15,23,42,0.08)',
  glassDark: 'rgba(15,23,42,0.72)',
  paper: '#FFFFFF',
  ink: '#0F172A',
  muted: '#475569',
  faint: '#64748B',
  line: 'rgba(15,23,42,0.14)',
  line2: 'rgba(15,23,42,0.08)',
  live: '#15803D',
  live50: '#DCFCE7',
  delayed: '#B45309',
  delayed50: '#FEF3C7',
  offline: '#64748B',
  offline50: '#EEF2F7',
  danger: '#DC2626',
  danger50: '#FEE2E2',
  dangerFill: '#DC2626',
  emerald: '#15803D',
  emerald700: '#166534',
  emerald50: '#DCFCE7',
  indigo: '#1D4ED8',
  indigo700: '#1E40AF',
  indigo50: '#EAF1FF',
  violet: '#6D28D9',
  sky: '#0369A1',
  rose: '#DC2626',
};

/** Two-stop gradients. Hero surfaces are deep blue in both themes (white text, AA). */
export const G = {
  navy: ['#1E3A8A', '#172554'],
  emerald: ['#334155', '#1E293B'],
  indigo: ['#2563EB', '#1D4ED8'],
  violet: ['#1E3A8A', '#172554'],
  red: ['#2563EB', '#2563EB'],
  gold: ['#FBBF24', '#F59E0B'],
  danger: ['#DC2626', '#B91C1C'],
  dark: ['#334155', '#1E293B'],
  sunrise: ['#2563EB', '#1E3A8A'],
  primary: ['#2563EB', '#2563EB'],
};

/** Soft accent pairs for icon bubbles: [background, foreground]. */
const accents = () => ({
  indigo: [C.indigo50, C.indigo],
  emerald: [C.emerald50, C.emerald700],
  red: [C.danger50, C.danger],
  amber: [C.delayed50, C.delayed],
  navy: [C.navy50, C.navy],
  danger: [C.danger50, C.danger],
  violet: [C.indigo50, C.violet],
  sky: [C.indigo50, C.sky],
  rose: [C.danger50, C.rose],
});
export const ACCENT = accents();

const tones = () => ({
  live: { fg: C.live, bg: C.live50 },
  delayed: { fg: C.delayed, bg: C.delayed50 },
  offline: { fg: C.offline, bg: C.offline50 },
  danger: { fg: C.danger, bg: C.danger50 },
  info: { fg: C.indigo, bg: C.indigo50 },
});
export const TONE = tones();

export const FRESH_COLOR = { live: C.live, delayed: C.delayed, offline: C.offline };

export const THEME_KEY = 'ubts.theme';

/** The dark theme: near-black ground, elevated surfaces. Runs once, before any screen loads (index.js). */
export function applyDarkPalette() {
  Object.assign(C, {
    dark: true,
    navy: '#4F8CFF',
    navyFill: '#2563EB',
    navy900: '#E6EDF5',
    navy700: '#94A3B8',
    navy100: 'rgba(79,140,255,0.30)',
    navy50: 'rgba(79,140,255,0.14)',
    gold: '#FBBF24',
    red: '#4F8CFF',
    red600: '#7AA7FF',
    red50: 'rgba(79,140,255,0.14)',
    crimson: '#7AA7FF',
    bg: '#0B0F14',
    card: '#161D27',
    surface: '#121821',
    raised: '#1C2531',
    glass: '#161D27',
    glassStrong: '#121821',
    glassEdge: 'rgba(255,255,255,0.08)',
    glassDark: 'rgba(5,8,12,0.72)',
    paper: '#161D27',
    ink: '#E6EDF5',
    muted: '#94A3B8',
    faint: '#7C8AA0',
    line: 'rgba(255,255,255,0.14)',
    line2: 'rgba(255,255,255,0.08)',
    live: '#4ADE80',
    live50: 'rgba(34,197,94,0.14)',
    delayed: '#FBBF24',
    delayed50: 'rgba(245,158,11,0.14)',
    offline: '#94A3B8',
    offline50: 'rgba(148,163,184,0.12)',
    danger: '#F87171',
    danger50: 'rgba(239,68,68,0.14)',
    dangerFill: '#DC2626',
    emerald: '#4ADE80',
    emerald700: '#4ADE80',
    emerald50: 'rgba(34,197,94,0.14)',
    indigo: '#93B8FF',
    indigo700: '#93B8FF',
    indigo50: 'rgba(79,140,255,0.14)',
    violet: '#C4B5FD',
    sky: '#7DD3FC',
    rose: '#F87171',
    slate: '#94A3B8',
    link: '#7AA7FF',
  });
  Object.assign(G, { navy: ['#1A2740', '#161D27'], violet: ['#1A2740', '#161D27'], emerald: ['#1C2531', '#161D27'], dark: ['#1C2531', '#161D27'] });
  Object.assign(ACCENT, accents());
  Object.assign(TONE, tones());
  Object.assign(FRESH_COLOR, { live: C.live, delayed: C.delayed, offline: C.offline });
  Object.assign(glass, { backgroundColor: C.card, borderColor: C.glassEdge, shadowColor: '#000', shadowOpacity: 0.35 });
}

export const R = { sm: 12, md: 14, lg: 20, xl: 24, pill: 999 };

/** Wide, faint shadows: cards float rather than sit in a box. */
// No Android elevation: on a translucent surface it draws a grey shadow
// through the glass. iOS and the web keep the soft drop shadow.
export const shadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 0,
};

/** A liquid glass surface: translucent fill, bright edge, soft depth. */
export const glass = {
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  borderColor: 'rgba(15,23,42,0.08)',
  ...shadow,
};

export const shadowLg = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.12,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 4,
};

export const glow = (color) => ({
  shadowColor: color,
  shadowOpacity: 0.28,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 5,
});

/** Hairline used around cards and on gradient surfaces. */
export const HAIRLINE = { light: 'rgba(255,255,255,0.10)', gold: 'rgba(247, 188, 49, 0.35)' };

/**
 * Fonts. Inter for all interface text: body, buttons, labels, schedules and
 * small headings. Poppins only for the logo and large headings and figures
 * (22px and up), never small text. A family per weight, as Android needs.
 */
export const F = {
  400: { fontFamily: 'Inter_400Regular', fontWeight: 'normal' },
  500: { fontFamily: 'Inter_500Medium', fontWeight: 'normal' },
  600: { fontFamily: 'Inter_600SemiBold', fontWeight: 'normal' },
  700: { fontFamily: 'Inter_700Bold', fontWeight: 'normal' },
  800: { fontFamily: 'Inter_700Bold', fontWeight: 'normal' },
  // Large headings and figures: Plus Jakarta Sans, tight tracking.
  display: { fontFamily: 'PlusJakartaSans_700Bold', fontWeight: 'normal', letterSpacing: -0.3 },
  displayBold: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontWeight: 'normal', letterSpacing: -0.5 },
  // The app name: a refined serif wordmark.
  // The app name and navigation labels: Montserrat, as in the web app's navbar.
  brand: { fontFamily: 'Montserrat_800ExtraBold', fontWeight: 'normal', letterSpacing: -0.2 },
  // Navigation (header titles, tab labels): Plus Jakarta Sans, crisp at small sizes.
  nav: { fontFamily: 'PlusJakartaSans_600SemiBold', fontWeight: 'normal', letterSpacing: 0.1 },
  navBold: { fontFamily: 'PlusJakartaSans_700Bold', fontWeight: 'normal', letterSpacing: 0 },
  navTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontWeight: 'normal', letterSpacing: -0.3 },
};

/** The Inter family for a fontWeight ('bold', '600', 500 ...). */
export function interFor(weight) {
  const w = weight === 'bold' ? 700 : Number(weight) || 400;
  if (w >= 700) return 'Inter_700Bold';
  if (w >= 600) return 'Inter_600SemiBold';
  if (w >= 500) return 'Inter_500Medium';
  return 'Inter_400Regular';
}
