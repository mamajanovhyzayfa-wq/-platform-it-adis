import { useEffect, useRef } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEvent } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Badge, Button, Card, ErrorState, Screen, Skeleton, useToast } from '@/components/ui'
import { ProgressBar } from '@/components/progress'
import { formatDuration } from '@/components/learning'
import { api, type LessonMaterialItem } from '@/api/api'
import { describeApiError } from '@/api/client'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const materialIcons: Record<LessonMaterialItem['type'], string> = {
  DOCUMENT: '📄',
  VIDEO: '🎬',
  PRESENTATION: '📊',
  IMAGE: '🖼️',
  LINK: '🔗',
}

const clock = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * Урок: видео с сохранением позиции, конспект, материалы и отметка о завершении.
 * Позиция пишется на сервер не чаще раза в 10 секунд, чтобы не забивать API.
 */
export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()

  const lesson = useQuery({
    queryKey: ['lesson', id],
    queryFn: () => api.lesson(id),
    enabled: Boolean(id),
  })

  const saveProgress = useMutation({
    mutationFn: (positionSeconds: number) => api.saveLessonProgress(id, positionSeconds),
  })

  const complete = useMutation({
    mutationFn: () => api.completeLesson(id),
    onSuccess: (result) => {
      toast.show({
        message:
          result.awarded.length > 0
            ? `Урок завершён. Новое достижение: ${result.awarded.join(', ')}`
            : `Урок завершён. Прогресс курса: ${result.progress}%`,
        tone: 'success',
      })
      void queryClient.invalidateQueries({ queryKey: ['lesson', id] })
      void queryClient.invalidateQueries({ queryKey: ['course'] })
      void queryClient.invalidateQueries({ queryKey: ['my-courses'] })
      void queryClient.invalidateQueries({ queryKey: ['learning-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['achievements'] })
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  if (lesson.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Урок' }} />
        <Skeleton height={210} borderRadius={radius.lg} />
        <Card>
          <Skeleton width="30%" height={18} borderRadius={radius.pill} />
          <Skeleton width="85%" height={24} style={{ marginTop: spacing.md }} />
          <Skeleton width="55%" height={13} style={{ marginTop: spacing.sm }} />
        </Card>
        <Card>
          <Skeleton width="35%" height={18} />
          <Skeleton lines={5} height={13} style={{ marginTop: spacing.md }} />
        </Card>
      </Screen>
    )
  }

  if (lesson.isError || !lesson.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Урок' }} />
        <ErrorState
          title="Урок недоступен"
          message={lesson.error ? describeApiError(lesson.error) : 'Возможно, урок ещё не опубликован.'}
          onRetry={() => void lesson.refetch()}
        />
        <Button title="К курсу" variant="ghost" onPress={() => router.back()} />
      </Screen>
    )
  }

  const data = lesson.data
  const completed = data.progress?.status === 'COMPLETED'
  const position = data.progress?.lastPositionSeconds ?? 0

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: data.course.title }} />

      {data.videoUrl ? (
        <LessonVideo
          key={data.id}
          url={data.videoUrl}
          startAt={position}
          onProgress={(seconds) => saveProgress.mutate(seconds)}
        />
      ) : (
        <Card style={styles.noVideo}>
          <Text style={styles.noVideoIcon}>🎧</Text>
          <Text style={styles.sectionTitle}>Урок без видеозаписи</Text>
          <Text style={styles.muted}>Изучите конспект и материалы ниже.</Text>
        </Card>
      )}

      <Card>
        <View style={styles.badges}>
          <Badge label={completed ? 'Пройден' : position > 0 ? 'В процессе' : 'Новый'} tone={completed ? 'success' : 'primary'} />
          <Badge label={formatDuration(data.durationMinutes)} tone="neutral" />
          <Badge label={data.module.title} tone="neutral" />
        </View>
        <Text style={styles.title}>{data.title}</Text>
        {data.description ? <Text style={styles.description}>{data.description}</Text> : null}
        <Text style={styles.muted}>
          {data.course.title} · пройдено {data.course.completedLessons} из {data.course.lessonsCount}
        </Text>
        <ProgressBar value={data.course.progress} />
        {data.videoUrl && position > 0 && !completed ? (
          <Text style={styles.hint}>Видео продолжится с {clock(position)}</Text>
        ) : null}
      </Card>

      {data.content ? (
        <Card>
          <Text style={styles.sectionTitle}>Конспект</Text>
          <Text style={styles.content}>{data.content}</Text>
        </Card>
      ) : null}

      {data.materials.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>Материалы урока</Text>
          {data.materials.map((material) => (
            <Pressable
              key={material.id}
              accessibilityRole="link"
              accessibilityLabel={`Открыть ${material.title}`}
              onPress={() => void Linking.openURL(material.url).catch(() => toast.error('Не удалось открыть ссылку'))}
              style={({ pressed }) => [styles.material, { borderTopColor: theme.colors.border }, pressed && styles.pressed]}
            >
              <Text style={styles.materialIcon}>{materialIcons[material.type] ?? '📎'}</Text>
              <View style={styles.materialText}>
                <Text style={styles.materialTitle}>{material.title}</Text>
                <Text style={styles.muted}>{material.mimeType ?? material.type.toLowerCase()}</Text>
              </View>
              <Text style={styles.materialArrow}>↗</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Button
        title={completed ? 'Урок уже завершён' : 'Отметить урок завершённым'}
        variant={completed ? 'secondary' : 'primary'}
        disabled={completed}
        loading={complete.isPending}
        onPress={() => complete.mutate()}
      />
      {!completed ? (
        <Text style={styles.footnote}>После завершения прогресс курса пересчитается автоматически.</Text>
      ) : null}

      <View style={styles.navRow}>
        <Button
          title="← Предыдущий"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!data.prevLesson}
          onPress={() =>
            data.prevLesson && router.replace({ pathname: '/lesson/[id]', params: { id: data.prevLesson.id } })
          }
        />
        <Button
          title="Следующий →"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!data.nextLesson}
          onPress={() =>
            data.nextLesson && router.replace({ pathname: '/lesson/[id]', params: { id: data.nextLesson.id } })
          }
        />
      </View>

      <Button
        title="К программе курса"
        variant="ghost"
        onPress={() => router.push({ pathname: '/course/[id]', params: { id: data.course.id } })}
      />
    </Screen>
  )
}

/** Плеер вынесен отдельно: хуки expo-video не должны вызываться условно. */
function LessonVideo({
  url,
  startAt,
  onProgress,
}: {
  url: string
  startAt: number
  onProgress: (seconds: number) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const lastSaved = useRef(startAt)

  const player = useVideoPlayer(url, (instance) => {
    instance.timeUpdateEventInterval = 5
    instance.loop = false
    if (startAt > 0) instance.currentTime = startAt
  })

  const timeUpdate = useEvent(player, 'timeUpdate')
  const currentTime = timeUpdate?.currentTime ?? startAt

  useEffect(() => {
    if (currentTime <= 0) return
    if (Math.abs(currentTime - lastSaved.current) < 10) return
    lastSaved.current = currentTime
    onProgress(Math.round(currentTime))
  }, [currentTime, onProgress])

  // При уходе с экрана сохраняем последнюю позицию, даже если 10 секунд не прошли.
  useEffect(() => {
    return () => {
      const seconds = Math.round(player.currentTime)
      if (seconds > 0) onProgress(seconds)
    }
  }, [player, onProgress])

  return (
    <View style={[styles.player, { backgroundColor: theme.colors.black }]}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
      <Text style={styles.playerHint}>Позиция просмотра сохраняется автоматически · {clock(currentTime)}</Text>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    player: { borderRadius: radius.lg, overflow: 'hidden' },
    video: { width: '100%', aspectRatio: 16 / 9 },
    playerHint: { color: c.textMuted, fontSize: typography.tiny, padding: spacing.sm, textAlign: 'center' },
    noVideo: { alignItems: 'center', paddingVertical: spacing.xl },
    noVideoIcon: { fontSize: 34, marginBottom: spacing.sm },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    title: { fontSize: typography.h1, fontWeight: '800', color: c.text, marginTop: spacing.md },
    description: { fontSize: typography.body, color: c.text, marginTop: spacing.sm, lineHeight: 22 },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    hint: { fontSize: typography.caption, color: c.primary, marginTop: spacing.sm, fontWeight: '600' },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginBottom: spacing.sm },
    content: { fontSize: typography.body, color: c.text, lineHeight: 24 },
    material: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    pressed: { opacity: 0.65 },
    materialIcon: { fontSize: 20 },
    materialText: { flex: 1 },
    materialTitle: { fontSize: typography.body, fontWeight: '600', color: c.text },
    materialArrow: { fontSize: 16, color: c.primary },
    footnote: { fontSize: typography.tiny, color: c.textMuted, textAlign: 'center' },
    navRow: { flexDirection: 'row', gap: spacing.sm },
  })
