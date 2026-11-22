import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

export interface DividerProps {
  label?: string
  /** Вертикальный разделитель для строк. */
  vertical?: boolean
  inset?: boolean
  style?: StyleProp<ViewStyle>
}

export function Divider({ label, vertical = false, inset = false, style }: DividerProps) {
  const styles = useThemedStyles(makeStyles)

  if (vertical) return <View style={[styles.vertical, style]} accessibilityElementsHidden />

  if (!label) {
    return <View style={[styles.horizontal, inset && styles.inset, style]} accessibilityElementsHidden />
  }

  return (
    <View style={[styles.labeled, style]}>
      <View style={styles.flexLine} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.flexLine} />
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    horizontal: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.md },
    inset: { marginHorizontal: spacing.lg },
    vertical: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: c.border },
    labeled: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
    flexLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    label: { fontSize: typography.tiny, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  })
