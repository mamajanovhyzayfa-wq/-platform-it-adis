import { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, Loader, Screen } from '@/components/ui'
import { ProgressBar } from '@/components/progress'
import { api, type AnswerValue, type TestAttemptStart, type TestQuestion, type TestSubmitResult } from '@/api/api'
import { describeApiError } from '@/api/client'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

function formatTimer(seconds: number) {
  const safe = Math.max(seconds, 0)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export default function TestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const styles = useThemedStyles(makeStyles)

  const { data: test, isLoading } = useQuery({ queryKey: ['test', id], queryFn: () => api.test(id), enabled: Boolean(id) })

  const [attempt, setAttempt] = useState<TestAttemptStart | null>(null)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [index, setIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [result, setResult] = useState<TestSubmitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submittedRef = useRef(false)

  const start = useMutation({
    mutationFn: () => api.startTest(id),
    onSuccess: (data) => {
      submittedRef.current = false
      setAttempt(data)
      const restored: Record<string, AnswerValue> = {}
      for (const saved of data.savedAnswers) {
        restored[saved.questionId] = (saved.value as AnswerValue) ?? null
      }
      setAnswers(restored)
      setSecondsLeft(Math.max(Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1000), 0))
      setIndex(0)
      setResult(null)
      setError(null)
    },
    onError: (mutationError) => setError(describeApiError(mutationError)),
  })

  const submit = useMutation({
    mutationFn: () =>
      api.submitTest(id, {
        attemptId: attempt?.attemptId ?? '',
        answers: Object.keys(answers).map((questionId) => ({ questionId, value: answers[questionId] })),
      }),
    onSuccess: (data) => {
      setResult(data)
      setSecondsLeft(null)
      void queryClient.invalidateQueries({ queryKey: ['tests'] })
    },
    onError: (mutationError) => {
      submittedRef.current = false
      setError(describeApiError(mutationError))
    },
  })

  useEffect(() => {
    if (secondsLeft === null || result) return
    if (secondsLeft <= 0) {
      if (!submittedRef.current) {
        submittedRef.current = true
        submit.mutate()
      }
      return
    }
    const timer = setTimeout(() => setSecondsLeft((value) => (value ?? 1) - 1), 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, result])

  if (isLoading) {
    return (
      <Screen>
        <Loader />
      </Screen>
    )
  }

  if (!test) {
    return (
      <Screen>
        <EmptyState title="Тест недоступен" hint="Возможно, он не опубликован или курс не назначен." />
      </Screen>
    )
  }

  if (result) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Результат' }} />
        <Card>
          <Text style={styles.title}>{result.passed ? 'Тест пройден 🎉' : 'Нужно повторить материал'}</Text>
          <Text style={styles.score}>
            {result.score} / {result.maxScore} баллов
          </Text>
          <ProgressBar value={result.percent} />
          <Text style={styles.muted}>Процент правильных ответов: {result.percent}%</Text>
          <Text style={styles.muted}>
            Верно: {result.correctCount} · Ошибок: {result.incorrectCount} · Всего: {result.totalQuestions}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button title="К тестам" variant="secondary" style={{ flex: 1 }} onPress={() => router.back()} />
            <Button
              title="Ещё попытка"
              style={{ flex: 1 }}
              onPress={() => start.mutate()}
              disabled={test.attemptsLeft !== null && test.attemptsLeft <= 0}
            />
          </View>
        </Card>
      </Screen>
    )
  }

  if (!attempt) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: test.title }} />
        <Card>
          <Text style={styles.title}>{test.title}</Text>
          <Text style={styles.muted}>{test.course.title}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Badge label={`${test.questions.length} вопросов`} tone="primary" />
            <Badge label={`${test.timeLimitMinutes} мин`} tone="neutral" />
            <Badge label={`Порог ${test.passingScore}%`} tone="warning" />
          </View>
          {test.description ? <Text style={styles.body}>{test.description}</Text> : null}
          <Text style={styles.muted}>
            {test.attemptsLeft === null ? '' : `Осталось попыток: ${test.attemptsLeft}`}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={test.attemptsLeft === 0 ? 'Попытки закончились' : 'Начать тест'}
            style={{ marginTop: spacing.lg }}
            disabled={test.attemptsLeft === 0}
            loading={start.isPending}
            onPress={() => start.mutate()}
          />
          <Text style={styles.hint}>
            Время запускается сразу после начала. Баллы считает сервер, покидать экран во время теста не
            рекомендуется.
          </Text>
        </Card>
      </Screen>
    )
  }

  const question = attempt.questions[index]
  if (!question) {
    return (
      <Screen>
        <EmptyState title="В тесте нет вопросов" />
      </Screen>
    )
  }

  const answeredCount = attempt.questions.filter((item) => {
    const value = answers[item.id]
    return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0) && value !== ''
  }).length

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: test.title }} />

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.counter}>
            Вопрос {index + 1} из {attempt.questions.length}
          </Text>
          <Text style={[styles.timer, secondsLeft !== null && secondsLeft <= 60 ? styles.timerDanger : null]}>
            ⏱ {secondsLeft === null ? '—' : formatTimer(secondsLeft)}
          </Text>
        </View>
        <ProgressBar value={(answeredCount / attempt.questions.length) * 100} />
        <Text style={styles.muted}>
          Отвечено {answeredCount} из {attempt.questions.length} · {question.points} балл(ов) за вопрос
        </Text>
      </Card>

      <Card>
        <Text style={styles.prompt}>{question.prompt}</Text>
        <QuestionInput
          question={question}
          value={answers[question.id] ?? null}
          onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
        />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          title="← Назад"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={index === 0}
          onPress={() => setIndex((value) => Math.max(value - 1, 0))}
        />
        {index < attempt.questions.length - 1 ? (
          <Button title="Далее →" style={{ flex: 1 }} onPress={() => setIndex((value) => value + 1)} />
        ) : (
          <Button
            title="Завершить"
            style={{ flex: 1 }}
            loading={submit.isPending}
            onPress={() =>
              Alert.alert('Завершить тест?', `Отвечено ${answeredCount} из ${attempt.questions.length}.`, [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Завершить',
                  onPress: () => {
                    submittedRef.current = true
                    submit.mutate()
                  },
                },
              ])
            }
          />
        )}
      </View>

      <View style={styles.dots}>
        {attempt.questions.map((item, itemIndex) => (
          <Text
            key={item.id}
            onPress={() => setIndex(itemIndex)}
            style={[
              styles.dot,
              itemIndex === index && styles.dotActive,
              answers[item.id] !== undefined && answers[item.id] !== null && itemIndex !== index && styles.dotAnswered,
            ]}
          >
            {itemIndex + 1}
          </Text>
        ))}
      </View>
    </Screen>
  )
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: TestQuestion
  value: AnswerValue
  onChange: (value: AnswerValue) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  if (question.type === 'SINGLE') {
    return (
      <View style={{ marginTop: spacing.md }}>
        {question.options.map((option) => (
          <Pressable key={option.id} style={styles.choice} onPress={() => onChange(option.id)}>
            <View style={[styles.radio, value === option.id && styles.radioActive]} />
            <Text style={styles.choiceText}>{option.text}</Text>
          </Pressable>
        ))}
      </View>
    )
  }

  if (question.type === 'MULTIPLE') {
    const selected = Array.isArray(value) ? value : []
    return (
      <View style={{ marginTop: spacing.md }}>
        {question.options.map((option) => {
          const isSelected = selected.includes(option.id)
          return (
            <Pressable
              key={option.id}
              style={styles.choice}
              onPress={() =>
                onChange(isSelected ? selected.filter((item) => item !== option.id) : [...selected, option.id])
              }
            >
              <View style={[styles.radio, isSelected && styles.radioActive]} />
              <Text style={styles.choiceText}>{option.text}</Text>
            </Pressable>
          )
        })}
      </View>
    )
  }

  if (question.type === 'BOOLEAN') {
    return (
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Button
          title="Верно"
          variant={value === true ? 'primary' : 'secondary'}
          style={{ flex: 1 }}
          onPress={() => onChange(true)}
        />
        <Button
          title="Неверно"
          variant={value === false ? 'primary' : 'secondary'}
          style={{ flex: 1 }}
          onPress={() => onChange(false)}
        />
      </View>
    )
  }

  if (question.type === 'MATCHING') {
    const rights = question.matchPairsRight ?? []
    const pairs = Array.isArray(value) ? value : []
    const current = new Map<string, string>()
    for (const pair of pairs) {
      const [left, right] = pair.split('::')
      if (left && right) current.set(left, right)
    }

    return (
      <View style={{ marginTop: spacing.md }}>
        {(question.matchPairsLeft ?? []).map((left) => (
          <View key={left} style={{ marginBottom: spacing.md }}>
            <Text style={styles.matchLeft}>{left}</Text>
            <View style={styles.matchRow}>
              {rights.map((right) => {
                const isSelected = current.get(left) === right
                return (
                  <Text
                    key={`${left}-${right}`}
                    onPress={() => {
                      const next = new Map(current)
                      next.set(left, right)
                      onChange([...next.entries()].map(([key, val]) => `${key}::${val}`))
                    }}
                    style={[styles.matchChip, isSelected && styles.matchChipActive]}
                  >
                    {right}
                  </Text>
                )
              })}
            </View>
          </View>
        ))}
      </View>
    )
  }

  return (
    <TextInput
      style={styles.input}
      value={value === null || value === undefined ? '' : String(value)}
      onChangeText={(text) => {
        if (question.type === 'NUMBER') {
          const parsed = Number(text.replace(',', '.'))
          onChange(text.trim() === '' ? null : Number.isFinite(parsed) ? parsed : text)
          return
        }
        onChange(text)
      }}
      placeholder={question.type === 'NUMBER' ? 'Введите число' : 'Введите ответ'}
      placeholderTextColor={theme.colors.textMuted}
      keyboardType={question.type === 'NUMBER' ? 'numeric' : 'default'}
      multiline={question.type === 'TEXT'}
      autoCapitalize="none"
    />
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  title: { fontSize: typography.h1, fontWeight: '800', color: c.text },
  score: { fontSize: 30, fontWeight: '800', color: c.primary, marginTop: spacing.sm },
  body: { fontSize: typography.body, color: c.text, marginTop: spacing.sm, lineHeight: 22 },
  muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
  hint: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.md, lineHeight: 16 },
  error: { fontSize: typography.caption, color: c.danger, marginTop: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counter: { fontSize: typography.body, fontWeight: '700', color: c.text },
  timer: { fontSize: typography.h2, fontWeight: '800', color: c.primary },
  timerDanger: { color: c.danger },
  prompt: { fontSize: typography.h2, fontWeight: '700', color: c.text, lineHeight: 25 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  choiceText: { flex: 1, fontSize: typography.body, color: c.text },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  radioActive: { borderColor: c.primary, backgroundColor: c.primary },
  input: {
    marginTop: spacing.md,
    minHeight: 50,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: c.text,
    backgroundColor: c.white,
  },
  matchLeft: { fontSize: typography.body, fontWeight: '700', color: c.text, marginBottom: spacing.xs },
  matchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  matchChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    color: c.text,
    fontSize: typography.caption,
    overflow: 'hidden',
  },
  matchChipActive: { borderColor: c.primary, backgroundColor: c.primarySoft, color: c.primary },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.md },
  dot: {
    width: 30,
    height: 30,
    lineHeight: 30,
    textAlign: 'center',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: c.card,
    color: c.textMuted,
    fontSize: typography.caption,
  },
  dotAnswered: { backgroundColor: c.primarySoft, color: c.primary },
  dotActive: { backgroundColor: c.primary, color: c.white, fontWeight: '700' },
})
