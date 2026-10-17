// Design tokens for the "Clean light" style. Tenant brand colours come from the
// login response and are read through useBrand() (src/auth/AuthContext.tsx).
import { Platform, TextStyle, ViewStyle } from 'react-native';

export const colors = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  text: '#111827',
  textMuted: '#4B5563',
  border: '#D1D5DB',
  divider: '#E5E7EB',
  success: '#047857',
  successBg: '#D1FAE5',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  warning: '#92400E',
  warningBg: '#FEF3C7',
  info: '#1D4ED8',
  infoBg: '#DBEAFE',
  neutralBg: '#E5E7EB',
  live: '#B91C1C',
  white: '#FFFFFF',
  black: '#000000',
};

export const DEFAULT_PRIMARY = '#0B5FFF';
export const DEFAULT_SECONDARY = '#FFB800';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const TOUCH = 48;

export const font = {
  body: 16,
  small: 14,
  label: 16,
  title: 20,
  h1: 24,
  score: 48,
};

export const text: Record<string, TextStyle> = {
  body: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  muted: { fontSize: font.body, color: colors.textMuted, lineHeight: 22 },
  small: { fontSize: font.small, color: colors.textMuted, lineHeight: 20 },
  label: { fontSize: font.label, color: colors.text, fontWeight: '600' },
  title: { fontSize: font.title, color: colors.text, fontWeight: '700' },
  h1: { fontSize: font.h1, color: colors.text, fontWeight: '800' },
  section: {
    fontSize: font.small,
    color: colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
};

export const shadow: ViewStyle = Platform.select({
  android: { elevation: 2 },
  default: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
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

export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());
}
