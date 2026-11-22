import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, Loader, Screen, Title } from '@/components/ui'
import { api } from '@/api/api'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

export default function TestsScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { data, isLoading, isRefetching, refetch, error } = useQuery({ queryKey: ['tests'], queryFn: api.tests })

  if (isLoading) {
    return (
      <Screen>
        <Loader />
      </Screen>
    )
  }

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Title subtitle={error ? 'Не удалось загрузить тесты' : 'Тесты по вашим курсам'}>Тестирование</Title>

      {(data ?? []).length === 0 ? (
        <EmptyState title="Тестов пока нет" hint="Преподаватель ещё не опубликовал тесты." />
      ) : (
        (data ?? []).map((test) => (
          <Card key={test.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{test.title}</Text>
              <Badge label={`${test.questionsCount} вопр.`} tone="primary" />
            </View>
            <Text style={styles.muted}>{test.course.title}</Text>
            <Text style={styles.muted}>
              {test.timeLimitMinutes} мин · порог {test.passingScore}% · попыток {test.attemptsAllowed}
            </Text>
            <Text style={styles.muted}>
              Пройдено попыток: {test.myAttempts}
              {test.bestScore > 0 ? ` · лучший результат ${test.bestScore}` : ''}
            </Text>
            <Button
              title={test.hasActiveAttempt ? 'Продолжить тест' : 'Пройти тест'}
              style={{ marginTop: spacing.md }}
              onPress={() => router.push({ pathname: '/test/[id]', params: { id: test.id } })}
            />
          </Card>
        ))
      )}
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
  muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
})
