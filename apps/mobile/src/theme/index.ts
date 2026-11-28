
import { lightColors } from './palette'

export { spacing, radius, typography, fontWeight,  control,  } from './tokens'
export {    type Palette,  } from './palette'
export { AppThemeProvider, useTheme, useThemedStyles,  } from './ThemeProvider'

/**
 * Совместимость: экраны, ещё не переведённые на useTheme, продолжают работать.
 * Удаляется после завершения миграции экранов на тему.
 * @deprecated Используйте `useTheme().colors` или `useThemedStyles`. Компоненты дизайн-системы
 * (`src/components/ui/*`) уже работают с активной темой.
 */
export const colors = lightColors
