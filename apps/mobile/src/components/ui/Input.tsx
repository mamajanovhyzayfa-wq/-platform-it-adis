import { useState, type ReactNode } from 'react'
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { control, radius, spacing, useTheme, useThemedStyles, type Palette } from '@/theme'
import { FieldLabel, FieldMessage } from './Field'

interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  containerStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextInputProps['style']>
}

export function Input({
  label,
  error,
  hint,
  required,
  leftIcon,
  rightIcon,
  containerStyle,
  inputStyle,
  onFocus,
  onBlur,
  editable = true,
  ...props
}: InputProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [focused, setFocused] = useState(false)

  const borderColor = error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <FieldLabel required={required}>{label}</FieldLabel> : null}
      <View style={[styles.row, { borderColor }, !editable && styles.readonly]}>
        {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
        <TextInput
          {...props}
          editable={editable}
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          style={[styles.input, { color: theme.colors.text }, inputStyle]}
        />
        {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
      </View>
      <FieldMessage error={error} hint={hint} />
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { marginBottom: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: control.md,
      borderWidth: 1,
      borderRadius: radius.md,
      backgroundColor: c.card,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm, minHeight: control.sm },
    icon: { alignItems: 'center', justifyContent: 'center' },
    readonly: { backgroundColor: c.cardMuted },
    hintSpacing: { marginTop: spacing.xs },
  })
