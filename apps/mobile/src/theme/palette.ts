/**
 * Палитры IT Adis.
 *
 * Фирменные цвета (синий #1B2BCF и зелёный #35D60A) взяты из логотипа и не меняются.
 * Для тёмной темы используется осветлённый вариант того же синего: на тёмном фоне исходный
 * #1B2BCF не проходит по контрасту для текста и иконок.
 */

export interface Palette {
  primary: string
  primaryDark: string
  primarySoft: string
  onPrimary: string
  accent: string
  accentSoft: string
  background: string
  backgroundAlt: string
  card: string
  cardMuted: string
  text: string
  textMuted: string
  textInverse: string
  border: string
  borderStrong: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  overlay: string
  skeleton: string
  white: string
  black: string
}

export const lightColors: Palette = {
  primary: '#1B2BCF',
  primaryDark: '#141FA0',
  primarySoft: '#EEF0FF',
  onPrimary: '#FFFFFF',
  accent: '#35D60A',
  accentSoft: '#EAFBE4',
  background: '#F5F7FB',
  backgroundAlt: '#FFFFFF',
  card: '#FFFFFF',
  cardMuted: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#6B7280',
  textInverse: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  overlay: 'rgba(15, 23, 42, 0.45)',
  skeleton: '#E2E8F0',
  white: '#FFFFFF',
  black: '#000000',
}

const darkColors: Palette = {
  primary: '#5B6BFF',
  primaryDark: '#3E4CDF',
  primarySoft: '#1C2444',
  onPrimary: '#0B1020',
  accent: '#4BE61B',
  accentSoft: '#142B13',
  background: '#0B1220',
  backgroundAlt: '#111A2C',
  card: '#131D31',
  cardMuted: '#1A2438',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textInverse: '#0B1220',
  border: '#243049',
  borderStrong: '#33415C',
  success: '#4ADE80',
  successSoft: '#12301F',
  warning: '#FBBF24',
  warningSoft: '#33260A',
  danger: '#F87171',
  dangerSoft: '#3A1616',
  overlay: 'rgba(2, 6, 23, 0.7)',
  skeleton: '#1E293B',
  white: '#FFFFFF',
  black: '#000000',
}

export type ColorScheme = 'light' | 'dark'

export const palettes: Record<ColorScheme, Palette> = {
  light: lightColors,
  dark: darkColors,
}
