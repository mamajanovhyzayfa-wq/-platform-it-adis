import { StyleSheet, Text } from 'react-native'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { Button } from './Button'
import { Card } from './Card'

interface ErrorStateProps {
  message?: string
  title?: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({
  message = 'Не удалось загрузить данные. Проверьте подключение и попробуйте снова.',
  title = 'Что-то пошло не так',
  onRetry,
  retryLabel = 'Повторить',
}: ErrorStateProps) {
  const styles = useThemedStyles(makeStyles)

  return (
    <Card style={styles.card}>
      <Text style={styles.badge} accessibilityElementsHidden>
        ⚠️
      </Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button title={retryLabel} variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
    badge: { fontSize: 28, marginBottom: spacing.xs },
    title: { fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center' },
    message: { fontSize: typography.caption, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
    retry: { marginTop: spacing.md, alignSelf: 'stretch' },
  })
