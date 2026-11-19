import { useState } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { FieldLabel, FieldMessage } from './Field'

export interface TextAreaProps extends Omit<TextInputProps, 'style' | 'multiline'> {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  maxLength?: number
  minHeight?: number
}

export function TextArea({
  label,
  error,
  hint,
  required,
  maxLength = 2000,
  minHeight = 120,
  value,
  onFocus,
  onBlur,
  ...props
}: TextAreaProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [focused, setFocused] = useState(false)
  const length = value?.length ?? 0

  return (
    <View style={styles.container}>
      {label ? <FieldLabel required={required}>{label}</FieldLabel> : null}
      <TextInput
        {...props}
        value={value}
        multiline
        textAlignVertical="top"
        maxLength={maxLength}
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
        style={[
          styles.input,
          {
            minHeight,
            color: theme.colors.text,
            borderColor: error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border,
          },
        ]}
      />
      <View style={styles.footer}>
        <FieldMessage error={error} hint={hint} />
        <Text style={styles.counter}>
          {length}/{maxLength}
        </Text>
      </View>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { marginBottom: spacing.md },
    input: {
      borderWidth: 1,
      borderRadius: radius.md,
      backgroundColor: c.card,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
      lineHeight: 22,
    },
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
    counter: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xs, marginLeft: 'auto' },
  })
