import { StyleSheet, Text, View } from 'react-native'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface ProgressBarProps {
  /** Значение в процентах от 0 до 100. */
  value: number
  showLabel?: boolean
  height?: number
  tone?: 'primary' | 'success' | 'warning' | 'danger'
  accessibilityLabel?: string
}

export function ProgressBar({ value, showLabel = true, height = 8, tone = 'primary', accessibilityLabel }: ProgressBarProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const safeValue = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100)
  const fillColor = {
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  }[tone]

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? 'Прогресс'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(safeValue) }}
    >
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <View
          style={[
            styles.fill,
            { width: `${safeValue}%`, height, borderRadius: height / 2, backgroundColor: fillColor },
          ]}
        />
      </View>
      {showLabel ? <Text style={styles.caption}>{Math.round(safeValue)}%</Text> : null}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs },
    track: { backgroundColor: c.primarySoft, overflow: 'hidden' },
    fill: {},
    caption: { fontSize: typography.caption, color: c.textMuted },
  })
