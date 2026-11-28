/**
 * Базовые токены дизайн-системы IT Adis.
 * Сетка отступов, радиусы, типографика и тени не зависят от темы.
 */

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const

/** Размеры шрифта. Имена сохранены для совместимости с существующими экранами. */
export const typography = {
  display: 34,
  title: 28,
  h1: 22,
  h2: 18,
  body: 15,
  caption: 13,
  tiny: 11,
} as const

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const

/** Высота интерактивных элементов: минимум 44 pt по требованиям доступности. */
export const control = {
  sm: 40,
  md: 50,
  lg: 56,
  touch: 44,
} as const
