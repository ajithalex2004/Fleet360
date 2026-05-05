/**
 * Shared design tokens for all PDF templates.
 * Keep all colors / spacing / typography here so templates stay consistent.
 */

export const colors = {
  // Brand
  primary: '#1a5e47',         // deep teal — XL AI brand accent
  primaryLight: '#2e8b6f',
  accent: '#0ea5e9',           // sky blue for emphasis

  // Greys
  text: '#1f2937',
  textMuted: '#6b7280',
  textSubtle: '#9ca3af',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  rowAlt: '#f9fafb',

  // Status
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',

  // Surfaces
  white: '#ffffff',
  offwhite: '#fafafa',
} as const;

export const spacing = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  xxxl: 32,
} as const;

export const typography = {
  // Font families — see fonts.ts for registration
  latin: 'Noto Sans',
  arabic: 'Noto Sans Arabic',

  // Sizes (points)
  micro: 7,
  small: 9,
  body: 10,
  large: 12,
  h3: 14,
  h2: 18,
  h1: 24,
  display: 32,
} as const;

export type Lang = 'en' | 'ar';

/** Font family for the current language. */
export function fontFor(lang: Lang): string {
  return lang === 'ar' ? typography.arabic : typography.latin;
}

/** Direction for the current language. */
export function dirFor(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** Format a money amount in the AED-default style. */
export function formatMoney(amount: number | string | undefined | null, currency = 'AED'): string {
  if (amount == null || amount === '') return '—';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Format a date — short form, e.g. "05 May 2026". */
export function formatDate(input: Date | string | undefined | null, lang: Lang = 'en'): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}
