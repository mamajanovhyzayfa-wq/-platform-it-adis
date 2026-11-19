import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

/** Подпись поля формы. */
export function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Text style={styles.label}>
      {children}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  )
}

/** Сообщение об ошибке или подсказка под полем. */
export function FieldMessage({ error, hint }: { error?: string; hint?: string }) {
  const styles = useThemedStyles(makeStyles)
  if (error) return <Text style={styles.error}>{error}</Text>
  if (hint) return <Text style={styles.hint}>{hint}</Text>
  return null
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    label: { fontSize: typography.caption, color: c.textMuted, marginBottom: spacing.xs, fontWeight: '600' },
    required: { color: c.danger },
    error: { color: c.danger, fontSize: typography.caption, marginTop: spacing.xs },
    hint: { color: c.textMuted, fontSize: typography.caption, marginTop: spacing.xs },
  })
