import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { Card } from './Card'

export interface EmptyStateProps {
  title: string
  hint?: string
  /** Эмодзи или иконка. */
  icon?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, icon = '📭', action }: EmptyStateProps) {
  const styles = useThemedStyles(makeStyles)

  return (
    <Card style={styles.card}>
      <Text style={styles.icon} accessibilityElementsHidden>
        {icon}
      </Text>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
    icon: { fontSize: 30 },
    title: { fontSize: 16, fontWeight: '600', color: c.text, textAlign: 'center' },
    hint: { fontSize: typography.caption, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
    action: { marginTop: spacing.md, alignSelf: 'stretch' },
  })
