import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native'
import { control, radius, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface IconButtonProps {
  /** Иконка, эмодзи или текстовый глиф. */
  icon: ReactNode
  onPress: () => void
  accessibilityLabel: string
  variant?: 'solid' | 'soft' | 'ghost'
  size?: number
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'ghost',
  size = control.touch,
  disabled = false,
  loading = false,
  style,
}: IconButtonProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const isDisabled = disabled || loading
  const background =
    variant === 'solid' ? theme.colors.primary : variant === 'soft' ? theme.colors.primarySoft : 'transparent'
  const foreground =
    variant === 'solid' ? theme.colors.onPrimary : variant === 'soft' ? theme.colors.primary : theme.colors.text

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: radius.pill, backgroundColor: background },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : typeof icon === 'string' ? (
        <Text style={[styles.glyph, { color: foreground }]}>{icon}</Text>
      ) : (
        icon
      )}
    </Pressable>
  )
}

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    base: { alignItems: 'center', justifyContent: 'center' },
    glyph: { fontSize: 18, fontWeight: '700' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
  })
