import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, typography, useThemedStyles, type Palette } from '@/theme'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | 'accent'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  label: string
  tone?: BadgeTone
  size?: BadgeSize
  style?: StyleProp<ViewStyle>
}

export function Badge({ label, tone = 'neutral', size = 'sm', style }: BadgeProps) {
  const styles = useThemedStyles(makeStyles)
  const palette = {
    neutral: { bg: styles.neutralBg.backgroundColor, text: styles.neutralText.color },
    success: { bg: styles.successBg.backgroundColor, text: styles.successText.color },
    warning: { bg: styles.warningBg.backgroundColor, text: styles.warningText.color },
    danger: { bg: styles.dangerBg.backgroundColor, text: styles.dangerText.color },
    primary: { bg: styles.primaryBg.backgroundColor, text: styles.primaryText.color },
    accent: { bg: styles.accentBg.backgroundColor, text: styles.accentText.color },
  }[tone]

  return (
    <View style={[styles.base, size === 'md' && styles.md, { backgroundColor: palette.bg }, style]}>
      <Text style={[styles.text, size === 'md' && styles.textMd, { color: palette.text }]}>{label}</Text>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
    md: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    text: { fontSize: typography.tiny, fontWeight: '700' },
    textMd: { fontSize: typography.caption },
    neutralBg: { backgroundColor: c.cardMuted },
    neutralText: { color: c.textMuted },
    successBg: { backgroundColor: c.successSoft },
    successText: { color: c.success },
    warningBg: { backgroundColor: c.warningSoft },
    warningText: { color: c.warning },
    dangerBg: { backgroundColor: c.dangerSoft },
    dangerText: { color: c.danger },
    primaryBg: { backgroundColor: c.primarySoft },
    primaryText: { color: c.primary },
    accentBg: { backgroundColor: c.accentSoft },
    accentText: { color: c.success },
  })
