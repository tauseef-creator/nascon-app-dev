// Design tokens for the Apple Sports-inspired dark style. Tenant brand colours come from the
// login response and are read through useBrand() (src/auth/AuthContext.tsx).
import { Platform, TextStyle, ViewStyle } from 'react-native';

export const colors = {
  bg: '#000000',
  card: '#1C1C1E',
  cardHi: '#2C2C2E',
  ink: '#30D158',
  accent: '#30D158',
  accentBg: '#0F2A17',
  headerTint: '#0B2A12',
  text: '#FFFFFF',
  textMuted: '#98989F',
  border: '#38383A',
  divider: '#2C2C2E',
  success: '#30D158',
  successBg: '#0F2A17',
  danger: '#FF6961',
  dangerBg: '#3A1A1A',
  warning: '#FFD60A',
  warningBg: '#332B0A',
  info: '#EBEBF5',
  infoBg: '#2C2C2E',
  neutralBg: '#2C2C2E',
  live: '#FF453A',
  white: '#FFFFFF',
  black: '#000000',
};

export const DEFAULT_PRIMARY = '#0B5FFF';
export const DEFAULT_SECONDARY = '#FFB800';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 12, md: 18, lg: 22, pill: 999 };
export const TOUCH = 48;

export const font = {
  body: 15,
  small: 13,
  label: 15,
  title: 17,
  h1: 28,
  score: 48,
};

/**
 * Type scale by role. Display numbers are heavy with tight tracking; headings are bold with slight
 * negative tracking; labels are semibold; captions and overlines are small, medium weight, and
 * muted. Overlines are uppercase with open tracking so they read as labels, not body text.
 */
export const type = {
  display: { fontFamily: 'Inter_800ExtraBold', fontSize: 56, lineHeight: 62, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  score: { fontFamily: 'Inter_800ExtraBold', fontSize: 32, lineHeight: 38, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  h1: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },
  h2: { fontFamily: 'Inter_700Bold', fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
  caption: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: 'Inter_700Bold', fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

export const text: Record<string, TextStyle> = {
  body: { ...type.body, color: colors.text },
  muted: { ...type.body, color: colors.textMuted },
  small: { fontFamily: 'Inter_500Medium', fontSize: font.small, color: colors.textMuted, lineHeight: 18 },
  label: { ...type.label, color: colors.text },
  title: { ...type.title, color: colors.text },
  h1: { ...type.h1, color: colors.text },
  section: { ...type.title, color: colors.text },
  heading: { ...type.h2, color: colors.text },
  caption: { ...type.caption, color: colors.textMuted },
  overline: { ...type.overline, color: colors.textMuted },
};

/**
 * Surfaces: translucent fills with a soft hairline edge, so cards read as layered glass over the
 * header wash. `sheen` is a faint top-down highlight drawn over a surface (see <Sheen />).
 */
export const surface = {
  glass: 'rgba(28,28,30,0.86)',
  glassHi: 'rgba(44,44,46,0.9)',
  edge: 'rgba(255,255,255,0.08)',
  edgeStrong: 'rgba(255,255,255,0.14)',
};

export const gradients = {
  /** Screen header wash: brand green fading into the black canvas. */
  wash: ['#0E3418', 'rgba(9,32,15,0.55)', 'rgba(0,0,0,0)'] as const,
  washLocations: [0, 0.45, 1] as const,
  /** Glossy highlight laid over cards and buttons. */
  sheen: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)'] as const,
  /** Primary action fill: brand green with a slightly deeper base. */
  primary: ['#3BDB64', '#2AC151'] as const,
  /** Bottom bar: near-black with a faint lift at the top edge. */
  bar: ['rgba(22,22,24,0.98)', 'rgba(6,6,7,1)'] as const,
};

export const shadow: ViewStyle = Platform.select({
  android: { elevation: 1 },
  default: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
}) as ViewStyle;

// ---- colour helpers (contrast-safe text on brand colours) ----
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [11, 95, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black, whichever reads better on the given background. */
export function onColor(bg: string): string {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#111827') ? '#FFFFFF' : '#111827';
}

export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.max(0, Math.round(v * (1 - amount))));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** A version of the brand colour that has at least 4.5:1 contrast on white (for text/links). */
export function readableOnWhite(hex: string): string {
  let c = hex;
  for (let i = 0; i < 10 && contrast(c, '#FFFFFF') < 4.5; i++) c = darken(c, 0.12);
  return c;
}

/** Bright tenant accent that stays readable on the dark app surface. */
export function readableOnDark(hex: string): string {
  let c = hex;
  for (let i = 0; i < 10 && contrast(c, '#1C1C1E') < 4.5; i++) {
    const [r, g, b] = hexToRgb(c).map((v) => Math.min(255, Math.round(v + (255 - v) * 0.12)));
    c = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return c;
}

export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());
}
