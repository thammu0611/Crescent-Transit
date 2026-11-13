// Crescent Transit's palette: the university's own colours (crescent.education)
// on the app's calm layout. Navy (#1C315E) is the accent for actions, links and
// selected states; gold (#F7BC31) is the highlight; crimson (#A02022) is for
// danger; the ground is the site's light grey. Dark mode (applyDarkPalette) is
// a deep-navy night with gold accents, as the site sets gold on navy.
//   navy / red    -> accent (links, icons, selected states)
//   navyFill      -> primary button fill (white text passes AA in both themes)
//   gold          -> highlight (and the accent in dark mode)
//   ink / muted / faint -> text, secondary text, captions
export const C = {
  navy: '#1C315E',
  navyFill: '#1C315E',
  navy900: '#142548',
  navy700: '#454E70',
  navy100: '#D9DEE8',
  navy50: '#EEF1F6',
  gold: '#F7BC31',
  onGold: '#142548',
  red: '#1C315E',
  red600: '#142548',
  red50: '#EEF1F6',
  crimson: '#A02022',
  slate: '#3E4C57',
  link: '#0170B9',
  skyBlue: '#6EC1E4',
  bg: '#F1F1F1',
  // Glass: cards and surfaces are translucent so the transit-map ground shows through, softly.
  card: 'rgba(255,255,255,0.80)',
  surface: 'rgba(255,255,255,0.84)',
  raised: 'rgba(225,230,238,0.62)',
  glass: 'rgba(255,255,255,0.80)',
  glassStrong: 'rgba(255,255,255,0.88)',
  glassEdge: 'rgba(255,255,255,0.75)',
  glassHi: 'rgba(255,255,255,0.95)',
  glassDark: 'rgba(20,37,72,0.72)',
  paper: 'rgba(255,255,255,0.80)',
  ink: '#141414',
  muted: '#54595F',
  faint: '#6B7280',
  line: 'rgba(28,49,94,0.14)',
  line2: 'rgba(28,49,94,0.09)',
  live: '#237A36',
  live50: '#E9F7EB',
  delayed: '#96650A',
  delayed50: '#FBF1DC',
  offline: '#5F6672',
  offline50: '#ECEEF1',
  danger: '#A02022',
  danger50: '#F9E9E9',
  dangerFill: '#A02022',
  emerald: '#237A36',
  emerald700: '#1F6B2F',
  emerald50: '#E9F7EB',
  indigo: '#1C315E',
  indigo700: '#142548',
  indigo50: '#EEF1F6',
  violet: '#5B4B9A',
  sky: '#0170B9',
  rose: '#A02022',
};

/** Two-stop gradients. Hero surfaces are the university navy in both themes (white text, AA). */
export const G = {
  navy: ['#1C315E', '#142548'],
  emerald: ['#3E4C57', '#2C3740'],
  indigo: ['#1C315E', '#142548'],
  violet: ['#1C315E', '#142548'],
  red: ['#1C315E', '#1C315E'],
  gold: ['#F7BC31', '#E0A51F'],
  danger: ['#B5282A', '#7D1618'],
  dark: ['#3E4C57', '#2C3740'],
  sunrise: ['#2A4787', '#1C315E'],
  primary: ['#1C315E', '#1C315E'],
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

/** The dark theme: a deep-navy night with gold accents. Runs once, before any screen loads (index.js). */
export function applyDarkPalette() {
  Object.assign(C, {
    dark: true,
    navy: '#F7BC31',
    navyFill: '#2F4E96',
    navy900: '#E9EDF5',
    navy700: '#A7B0C3',
    navy100: 'rgba(247,188,49,0.30)',
    navy50: 'rgba(247,188,49,0.13)',
    gold: '#F7BC31',
    red: '#F7BC31',
    red600: '#F9D27A',
    red50: 'rgba(247,188,49,0.13)',
    crimson: '#F28B8D',
    bg: '#0D1524',
    card: 'rgba(30,44,72,0.84)',
    surface: 'rgba(20,31,52,0.90)',
    raised: 'rgba(255,255,255,0.07)',
    glass: 'rgba(30,44,72,0.84)',
    glassStrong: 'rgba(20,31,52,0.90)',
    glassEdge: 'rgba(255,255,255,0.12)',
    glassHi: 'rgba(255,255,255,0.14)',
    glassDark: 'rgba(8,13,24,0.72)',
    paper: 'rgba(30,44,72,0.84)',
    ink: '#E9EDF5',
    muted: '#A7B0C3',
    faint: '#8793AB',
    line: 'rgba(255,255,255,0.13)',
    line2: 'rgba(255,255,255,0.08)',
    live: '#6FD487',
    live50: 'rgba(111,212,135,0.14)',
    delayed: '#EABC69',
    delayed50: 'rgba(234,188,105,0.14)',
    offline: '#A7B0C3',
    offline50: 'rgba(167,176,195,0.12)',
    danger: '#F28B8D',
    danger50: 'rgba(242,139,141,0.14)',
    dangerFill: '#B5282A',
    emerald: '#6FD487',
    emerald700: '#6FD487',
    emerald50: 'rgba(111,212,135,0.14)',
    indigo: '#C6D3F2',
    indigo700: '#C6D3F2',
    indigo50: 'rgba(150,175,235,0.16)',
    violet: '#C4B5FD',
    sky: '#8CC4EE',
    rose: '#F28B8D',
    slate: '#A7B0C3',
    link: '#8CC4EE',
  });
  Object.assign(G, { navy: ['#1F3157', '#18233A'], violet: ['#1F3157', '#18233A'], indigo: ['#1F3157', '#18233A'], emerald: ['#22304D', '#18233A'], dark: ['#22304D', '#18233A'] });
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
  shadowColor: '#142548',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 0,
};

/** A liquid glass surface: translucent fill, bright edge, soft depth. */
export const glass = {
  backgroundColor: 'rgba(255,255,255,0.72)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.75)',
  ...shadow,
};

export const shadowLg = {
  shadowColor: '#142548',
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
