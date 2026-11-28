import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { control, radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  /** Иконка или эмодзи слева от текста. */
  icon?: ReactNode
  fullWidth?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityHint?: string
  testID?: string
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const isDisabled = disabled || loading
  const foreground =
    variant === 'primary' || variant === 'danger' || variant === 'success'
      ? theme.colors.onPrimary
      : theme.colors.primary

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        variant === 'primary' && { backgroundColor: theme.colors.primary },
        variant === 'secondary' && { backgroundColor: theme.colors.primarySoft },
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && { backgroundColor: theme.colors.danger },
        variant === 'success' && { backgroundColor: theme.colors.success },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{typeof icon === 'string' ? <Text style={{ color: foreground }}>{icon}</Text> : icon}</View> : null}
          <Text style={[styles.text, { color: foreground }, size === 'sm' && styles.textSmall]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: {
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    sm: { height: control.sm, borderRadius: radius.sm },
    md: { height: control.md },
    lg: { height: control.lg, borderRadius: radius.lg },
    ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
    fullWidth: { alignSelf: 'stretch' },
    content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
    icon: { alignItems: 'center', justifyContent: 'center' },
    text: { fontSize: 16, fontWeight: '700' },
    textSmall: { fontSize: typography.caption },
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.82 },
  })
