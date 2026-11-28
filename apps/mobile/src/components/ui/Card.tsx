import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, useTheme, useThemedStyles, type Palette } from '@/theme'

interface CardProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** Карточка-кнопка: реагирует на нажатие и доступна скринридеру. */
  onPress?: () => void
  padded?: boolean
  accessibilityLabel?: string
  testID?: string
}

export function Card({ children, style, onPress, padded = true, accessibilityLabel, testID }: CardProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const content = <View style={[styles.card, padded && styles.padded, { borderColor: theme.colors.border }, style]}>{children}</View>

  if (!onPress) return content

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    padded: { padding: spacing.lg },
    pressed: { opacity: 0.85 },
  })
