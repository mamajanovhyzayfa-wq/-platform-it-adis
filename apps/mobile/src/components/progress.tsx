import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

interface ProgressBarProps {
  /** Прогресс в процентах, 0–100. */
  value: number
  /** Показать процент под шкалой. */
  caption?: boolean
  height?: number
  style?: StyleProp<ViewStyle>
}

/** Индикатор прогресса, читающий активную тему. */
export function ProgressBar({ value, caption = true, height = 8, style }: ProgressBarProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0

  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[styles.track, { height, borderRadius: height / 2 }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(safe) }}
      >
        <View
          style={[
            styles.fill,
            { width: `${safe}%`, height, borderRadius: height / 2, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>
      {caption ? <Text style={styles.caption}>{Math.round(safe)}%</Text> : null}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.md },
    track: { backgroundColor: c.primarySoft, overflow: 'hidden' },
    fill: { backgroundColor: c.primary },
    caption: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
  })
