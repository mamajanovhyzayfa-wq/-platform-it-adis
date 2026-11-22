/**
 * Дизайн-система IT Adis: токены, палитры и доступ к активной теме.
 *
 * Экраны не импортируют конкретные цвета. Внутри компонента стили создаются фабрикой:
 *
 * ```tsx
 * const makeStyles = (c: Palette) => StyleSheet.create({ title: { color: c.text } })
 * const styles = useThemedStyles(makeStyles)
 * ```
 */
import type { ViewStyle } from 'react-native'
import { lightColors } from './palette'

export { spacing, radius, typography, fontWeight, lineHeight, control, duration } from './tokens'
export { lightColors, darkColors, palettes, type Palette, type ColorScheme } from './palette'
export { AppThemeProvider, useTheme, useThemedStyles, type Theme } from './ThemeProvider'
export type { ThemeMode } from '@/store/theme'

/**
 * Совместимость: экраны, ещё не переведённые на useTheme, продолжают работать.
 * Удаляется после завершения миграции экранов на тему.
 * @deprecated Используйте `useTheme().colors` или `useThemedStyles`. Компоненты дизайн-системы
 * (`src/components/ui/*`) уже работают с активной темой.
 */
export const colors = lightColors

/** @deprecated Используйте `useTheme().shadow.card`. */
export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } satisfies ViewStyle,
} as const
