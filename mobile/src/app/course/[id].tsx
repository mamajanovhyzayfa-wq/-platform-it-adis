import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton } from '@/components/ui'
import { ProgressBar } from '@/components/progress'
import { formatDuration, levelLabels, levelTones, pluralLessons } from '@/components/learning'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

/**
 * Страница курса: программа по модулям, прогресс по каждому уроку и запись.
 * Уроки, закрытые сервером, помечены замком и не открываются без записи.
 */
export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({})

  const course = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.course(id),
    enabled: Boolean(id),
  })

  const enroll = useMutation({
    mutationFn: () => api.enrollCourse(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['course', id] })
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['my-courses'] })
      void queryClient.invalidateQueries({ queryKey: ['learning-overview'] })
    },
  })

  const expanded = useMemo(() => {
    if (!course.data) return openModules
    if (Object.keys(openModules).length > 0) return openModules
    const first = course.data.modules[0]
    return first ? { [first.id]: true } : {}
  }, [course.data, openModules])

  if (course.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Курс' }} />
        <Card>
          <Skeleton width="30%" height={20} borderRadius={radius.pill} />
          <Skeleton width="85%" height={26} style={{ marginTop: spacing.md }} />
          <Skeleton width="55%" height={13} style={{ marginTop: spacing.sm }} />
          <Skeleton lines={2} height={13} style={{ marginTop: spacing.md }} />
          <Skeleton height={10} borderRadius={5} style={{ marginTop: spacing.lg }} />
        </Card>
        <Card>
          <Skeleton width="45%" height={20} />
          <Skeleton height={48} style={{ marginTop: spacing.md }} />
          <Skeleton height={48} style={{ marginTop: spacing.sm }} />
        </Card>
      </Screen>
    )
  }

  if (course.isError || !course.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Курс' }} />
        <ErrorState
          title="Курс недоступен"
          message={course.error ? describeApiError(course.error) : 'Курс не найден или снят с публикации.'}
          onRetry={() => void course.refetch()}
        />
      </Screen>
    )
  }

  const data = course.data
  const firstAvailable = data.modules.flatMap((module) => module.lessons).find((lesson) => !lesson.locked)

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: data.title }} />

      <Card>
        <View style={styles.badges}>
          {data.category ? <Badge label={`${data.category.icon ?? ''} ${data.category.title}`.trim()} tone="primary" /> : null}
          <Badge label={levelLabels[data.level]} tone={levelTones[data.level]} />
          {data.isEnrolled ? <Badge label="Вы записаны" tone="success" /> : <Badge label="Открыт для записи" tone="neutral" />}
        </View>

        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.muted}>Преподаватель: {data.teacher.name}</Text>
        <Text style={styles.description}>{data.description}</Text>

        <View style={styles.stats}>
          <Stat value={String(data.modules.length)} label="модулей" />
          <Stat value={String(data.lessonsCount)} label={pluralLessons(data.lessonsCount).replace(/^\d+\s/, '')} />
          <Stat value={formatDuration(data.durationMinutes)} label="длительность" />
        </View>

        {data.isEnrolled ? (
          <>
            <ProgressBar value={data.progress} />
            <Text style={styles.muted}>
              Пройдено {data.completedLessons} из {data.lessonsCount} уроков
            </Text>
          </>
        ) : (
          <Button
            title="Записаться на курс"
            loading={enroll.isPending}
            onPress={() => enroll.mutate()}
            style={{ marginTop: spacing.md }}
          />
        )}
        {enroll.isError ? <Text style={styles.error}>{describeApiError(enroll.error)}</Text> : null}

        {data.isEnrolled && firstAvailable ? (
          <Button
            title="Продолжить обучение"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: firstAvailable.id } })}
          />
        ) : null}
      </Card>

      {data.modules.length === 0 ? <EmptyState title="Программа курса готовится" hint="Модули появятся здесь после публикации." /> : null}

      {data.modules.map((module) => {
        const open = expanded[module.id] ?? false
        return (
          <Card key={module.id} padded={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setOpenModules((prev) => ({ ...prev, [module.id]: !open }))}
              style={styles.moduleHead}
            >
              <View style={styles.moduleNumber}>
                <Text style={[styles.moduleNumberText, { color: theme.colors.primary }]}>{module.position}</Text>
              </View>
              <View style={styles.moduleText}>
                <Text style={styles.moduleTitle}>{module.title}</Text>
                <Text style={styles.muted}>
                  {module.completedLessons} из {module.lessonsCount} · {pluralLessons(module.lessonsCount)}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: theme.colors.textMuted }]}>{open ? '▴' : '▾'}</Text>
            </Pressable>

            {open ? (
              <View style={styles.lessons}>
                {module.description ? <Text style={styles.moduleDescription}>{module.description}</Text> : null}
                {module.lessons.length === 0 ? <Text style={styles.muted}>Уроки ещё не опубликованы.</Text> : null}
                {module.lessons.map((lesson, index) => {
                  const done = lesson.status === 'COMPLETED'
                  const inProgress = lesson.status === 'IN_PROGRESS'
                  return (
                    <Pressable
                      key={lesson.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Урок ${lesson.title}${lesson.locked ? ', закрыт' : ''}`}
                      disabled={lesson.locked}
                      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
                      style={({ pressed }) => [
                        styles.lesson,
                        { borderTopColor: theme.colors.border },
                        index === 0 && styles.lessonFirst,
                        pressed && styles.lessonPressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.lessonIcon,
                          {
                            backgroundColor: done ? theme.colors.successSoft : inProgress ? theme.colors.primarySoft : theme.colors.cardMuted,
                          },
                        ]}
                      >
                        <Text style={styles.lessonIconText}>{lesson.locked ? '🔒' : done ? '✓' : inProgress ? '▶' : '○'}</Text>
                      </View>
                      <View style={styles.lessonText}>
                        <Text style={[styles.lessonTitle, lesson.locked && styles.locked]} numberOfLines={2}>
                          {lesson.title}
                        </Text>
                        <Text style={styles.muted}>
                          {lesson.durationMinutes > 0 ? formatDuration(lesson.durationMinutes) : 'Без видео'}
                          {lesson.materialsCount > 0 ? ` · ${lesson.materialsCount} материал(ов)` : ''}
                          {done ? ' · пройден' : inProgress ? ' · в процессе' : ''}
                        </Text>
                      </View>
                      {!lesson.locked ? <Text style={styles.arrow}>›</Text> : null}
                    </Pressable>
                  )
                })}
              </View>
            ) : null}
          </Card>
        )
      })}
    </Screen>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    title: { fontSize: typography.h1, fontWeight: '800', color: c.text, marginTop: spacing.md },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    description: { fontSize: typography.body, color: c.text, marginTop: spacing.md, lineHeight: 22 },
    stats: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
    stat: { flex: 1 },
    statValue: { fontSize: 18, fontWeight: '800', color: c.text },
    error: { fontSize: typography.caption, color: c.danger, marginTop: spacing.sm },
    moduleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
    moduleNumber: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primarySoft,
    },
    moduleNumberText: { fontSize: typography.h2, fontWeight: '800' },
    moduleText: { flex: 1 },
    moduleTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text },
    chevron: { fontSize: 16 },
    lessons: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    moduleDescription: { fontSize: typography.caption, color: c.textMuted, marginBottom: spacing.sm },
    lesson: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    lessonFirst: { borderTopWidth: 0 },
    lessonPressed: { opacity: 0.7 },
    lessonIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    lessonIconText: { fontSize: 13 },
    lessonText: { flex: 1 },
    lessonTitle: { fontSize: typography.body, fontWeight: '600', color: c.text },
    locked: { color: c.textMuted },
    arrow: { fontSize: 20, color: c.textMuted },
  })
