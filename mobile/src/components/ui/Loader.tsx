import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface LoaderProps {
  label?: string
  size?: 'small' | 'large'
  /** Встроенный вариант без вертикальных отступов — для кнопок и списков. */
  inline?: boolean
  style?: StyleProp<ViewStyle>
}

export function Loader({ label, size = 'small', inline = false, style }: LoaderProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Загрузка'}
      style={[styles.base, !inline && styles.block, style]}
    >
      <ActivityIndicator size={size} color={theme.colors.primary} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    block: { paddingVertical: spacing.xxl },
    label: { fontSize: typography.caption, color: c.textMuted },
  })
