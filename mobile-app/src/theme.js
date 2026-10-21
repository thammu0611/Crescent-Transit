// Crescent Transit's palette, taken from crescent.education: navy #1c315e,
// gold #f7bc31 for accents on navy, crimson #a02022 for the main buttons and
// for accent text on light surfaces, slate #3e4c57 and #454e70 for dark cards
// and secondary actions, light grey #f1f1f1 behind white cards, near-black
// text. Status colours (live / delayed / offline) stay functional. The
// gradients, shadows and radii the mobile design is built from live here too,
// so every screen picks up a change made in this file.
export const C = {
  navy: '#1c315e',
  navy900: '#142548',
  navy700: '#454e70',
  navy100: '#d9dee8',
  navy50: '#eef1f6',
  // Gold is the website's accent: lines, highlighted text and active states on navy.
  gold: '#f7bc31',
  // Crimson: buttons, and accent text or lines on white (gold is unreadable there).
  red: '#a02022',
  red600: '#a02022',
  red50: '#f9e9e9',
  crimson: '#a02022',
  slate: '#3e4c57',
  link: '#0170b9',
  skyBlue: '#6ec1e4',
  // Liquid glass: the site's light grey base under a soft glow (GlassBackdrop), and translucent
  // surfaces with a bright edge that let the glow through.
  bg: '#f1f1f1',
  card: 'rgba(255,255,255,0.7)',
  surface: 'rgba(255,255,255,0.5)',
  glass: 'rgba(255,255,255,0.68)',
  glassStrong: 'rgba(255,255,255,0.84)',
  // Outline of glass surfaces: a fine navy hairline (the bright top edge is Sheen).
  glassEdge: 'rgba(28,49,94,0.10)',
  glassDark: 'rgba(20,37,72,0.58)',
  ink: '#141414',
  muted: '#54595f',
  faint: '#9b9b9c',
  line: 'rgba(28,49,94,0.14)',
  line2: 'rgba(28,49,94,0.09)',
  live: '#2b8a3e',
  live50: '#e9f7eb',
  delayed: '#b9832a',
  delayed50: '#f9f0de',
  offline: '#8b909b',
  offline50: '#f0eff0',
  danger: '#a02022',
  danger50: '#f9e9e9',
  emerald: '#2b8a3e',
  emerald700: '#1f6b2f',
  emerald50: '#e9f7eb',
  indigo: '#454e70',
  indigo700: '#363e5a',
  indigo50: '#eceef3',
  violet: '#454e70',
  sky: '#454e70',
  rose: '#a02022',
};

/** Two-stop gradients, top-left to bottom-right; kept close in tone, as the website's flat colours. */
export const G = {
  navy: ['#1c315e', '#142548'],
  // Big cards (route card, contact card) use the website's slate.
  emerald: ['#4a5a66', '#3e4c57'],
  indigo: ['#4f5a80', '#3a4262'],
  violet: ['#454e70', '#1c315e'],
  red: ['#b5282a', '#8a1a1c'],
  gold: ['#f9c94f', '#e0a414'],
  danger: ['#b5282a', '#7d1618'],
  dark: ['#3e4c57', '#2c3740'],
  sunrise: ['#f7bc31', '#a02022'],
};

/** Soft accent pairs for icon bubbles: [background, foreground]. */
export const ACCENT = {
  indigo: [C.indigo50, C.indigo],
  emerald: [C.emerald50, C.emerald700],
  red: [C.red50, C.red600],
  amber: [C.delayed50, C.delayed],
  navy: [C.navy50, C.navy],
  danger: [C.danger50, C.danger],
  violet: [C.indigo50, C.violet],
  sky: [C.indigo50, C.sky],
  rose: [C.red50, C.rose],
};

export const TONE = {
  live: { fg: C.live, bg: C.live50 },
  delayed: { fg: C.delayed, bg: C.delayed50 },
  offline: { fg: C.offline, bg: C.offline50 },
  danger: { fg: C.danger, bg: C.danger50 },
  info: { fg: C.indigo, bg: C.indigo50 },
};

export const FRESH_COLOR = { live: C.live, delayed: C.delayed, offline: C.offline };

export const R = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };

/** Wide, faint shadows: cards float rather than sit in a box. */
// No Android elevation: on a translucent surface it draws a grey shadow
// through the glass. iOS and the web keep the soft drop shadow.
export const shadow = {
  shadowColor: '#142548',
  shadowOpacity: 0.08,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 0,
};

/** A liquid glass surface: translucent fill, bright edge, soft depth. */
export const glass = {
  backgroundColor: 'rgba(255,255,255,0.68)',
  borderWidth: 1,
  borderColor: 'rgba(28,49,94,0.10)',
  ...shadow,
};

export const shadowLg = {
  shadowColor: '#142548',
  shadowOpacity: 0.16,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 14 },
  elevation: 7,
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
  display: { fontFamily: 'Poppins_600SemiBold', fontWeight: 'normal', letterSpacing: -0.3 },
  displayBold: { fontFamily: 'Poppins_700Bold', fontWeight: 'normal', letterSpacing: -0.3 },
  // The app name: a refined serif wordmark.
  // The app name and navigation labels: Montserrat, as in the web app's navbar.
  brand: { fontFamily: 'Montserrat_800ExtraBold', fontWeight: 'normal', letterSpacing: -0.2 },
  nav: { fontFamily: 'Montserrat_600SemiBold', fontWeight: 'normal', letterSpacing: 0.2 },
  navBold: { fontFamily: 'Montserrat_700Bold', fontWeight: 'normal', letterSpacing: 0.1 },
};

/** The Inter family for a fontWeight ('bold', '600', 500 ...). */
export function interFor(weight) {
  const w = weight === 'bold' ? 700 : Number(weight) || 400;
  if (w >= 700) return 'Inter_700Bold';
  if (w >= 600) return 'Inter_600SemiBold';
  if (w >= 500) return 'Inter_500Medium';
  return 'Inter_400Regular';
}
