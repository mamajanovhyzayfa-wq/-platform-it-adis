import { useEffect, useRef, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  Input,
  Screen,
  Skeleton,
  TextArea,
  useToast,
} from '@/components/ui'
import { api, type HomeworkSubmission } from '@/api/api'
import { describeApiError, isNetworkError } from '@/api/client'
import { enqueue } from '@/offline/queue'
import { clearHomeworkDraft, loadHomeworkDraft, saveHomeworkDraft } from '@/offline/drafts'
import { useOffline } from '@/offline/OfflineSyncProvider'
import { RoleGate } from '@/components/guards'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

const urlSchema = z
  .string()
  .trim()
  .refine((value) => /^https?:\/\/\S+$/i.test(value), 'Ссылка должна начинаться с http:// или https://')

const schema = z
  .object({
    text: z.string().trim().max(20000, 'Не больше 20 000 символов').optional(),
    projectUrl: z.union([z.literal(''), urlSchema]).optional(),
    files: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Название файла').max(255, 'Не больше 255 символов'),
          url: urlSchema,
        }),
      )
      .max(5, 'Не больше 5 файлов'),
  })
  .refine(
    (values) =>
      Boolean(values.text?.trim()) || Boolean(values.projectUrl) || (values.files?.some((file) => file.url) ?? false),
    { message: 'Добавьте текст решения, ссылку на проект или файл', path: ['text'] },
  )

type FormValues = z.infer<typeof schema>

/** Уникальный ключ попытки: повторная отправка того же тела не создаст вторую работу. */
function makeIdempotencyKey(homeworkId: string): string {
  return `${homeworkId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function HomeworkScreen() {
  return (
    <RoleGate allow={['STUDENT']}>
      <HomeworkContent />
    </RoleGate>
  )
}

function HomeworkContent() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const queryClient = useQueryClient()
  const styles = useThemedStyles(makeStyles)
  const offline = useOffline()

  const homework = useQuery({
    queryKey: ['homework', id],
    queryFn: () => api.homeworkById(id),
    enabled: Boolean(id),
  })

  const [formError, setFormError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey(id))
  const [draftRestored, setDraftRestored] = useState(false)
  const [queued, setQueued] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { text: '', projectUrl: '', files: [] },
  })
  const files = useFieldArray({ control: form.control, name: 'files' })

  useEffect(() => {
    if (offline.pending === 0) setQueued(false)
  }, [offline.pending])

  // Черновик восстанавливается до того, как пользователь начнёт вводить текст.
  useEffect(() => {
    let active = true
    void loadHomeworkDraft(id).then((draft) => {
      if (!active || !draft) return
      form.reset({ text: draft.text, projectUrl: draft.projectUrl, files: draft.files })
      setDraftRestored(true)
    })
    return () => {
      active = false
    }
  }, [form, id])

  // Автосохранение текста, ссылки и файлов переживает закрытие приложения.
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void saveHomeworkDraft(id, {
          text: values.text ?? '',
          projectUrl: values.projectUrl ?? '',
          files: (values.files ?? []).filter(
            (file): file is { name: string; url: string } => Boolean(file?.name && file?.url),
          ),
        })
      }, 700)
    })
    return () => {
      subscription.unsubscribe()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [form, id])

  const submit = useMutation({
    mutationFn: (values: FormValues) =>
      api.submitHomework(id, {
        text: values.text?.trim() || undefined,
        projectUrl: values.projectUrl || undefined,
        files: (values.files ?? []).filter((file) => file.name && file.url),
        idempotencyKey,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['homework'] })
      void queryClient.invalidateQueries({ queryKey: ['homework', id] })
      void queryClient.invalidateQueries({ queryKey: ['learning-overview'] })
      toast.success('Решение отправлено преподавателю')
      form.reset({ text: '', projectUrl: '', files: [] })
      setIdempotencyKey(makeIdempotencyKey(id))
      setQueued(false)
      setDraftRestored(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void clearHomeworkDraft(id)
    },
    onError: async (error) => {
      if (isNetworkError(error)) {
        await enqueue({
          type: 'homework-submit',
          homeworkId: id,
          payload: {
            text: form.getValues('text')?.trim() || undefined,
            projectUrl: form.getValues('projectUrl') || undefined,
            files: (form.getValues('files') ?? []).filter((file) => file.name && file.url),
            idempotencyKey,
          },
        })
        if (saveTimer.current) clearTimeout(saveTimer.current)
        await clearHomeworkDraft(id)
        setQueued(true)
        setDraftRestored(false)
        form.reset({ text: '', projectUrl: '', files: [] })
        setIdempotencyKey(makeIdempotencyKey(id))
        toast.show({
          message: 'Нет сети. Решение сохранено на устройстве и отправится автоматически.',
          tone: 'warning',
          duration: 5000,
        })
        return
      }
      const message = describeApiError(error)
      setFormError(message)
      toast.error(message)
    },
  })

  const submission = homework.data?.mySubmission ?? null
  const deadlinePassed = homework.data ? Date.now() > new Date(homework.data.dueAt).getTime() : false
  // Сервер — единственный источник правил версий: лимит, статус проверки и срок.
  const canSubmit = homework.data?.canSubmit ?? false

  if (homework.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Задание' }} />
        <Skeleton height={150} borderRadius={18} />
        <Skeleton height={110} borderRadius={18} />
      </Screen>
    )
  }

  if (homework.isError || !homework.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Задание' }} />
        <ErrorState
          title="Задание недоступно"
          message={homework.error ? describeApiError(homework.error) : 'Задание не найдено или курс не назначен.'}
          onRetry={() => void homework.refetch()}
        />
      </Screen>
    )
  }

  const data = homework.data

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => toast.error('Не удалось открыть ссылку'))
  }

  return (
    <Screen refreshing={homework.isRefetching} onRefresh={() => void homework.refetch()}>
      <Stack.Screen options={{ headerShown: true, title: data.title }} />

      <Card>
        <Text style={styles.course}>{data.course.title}</Text>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.badges}>
          <Badge label={`До ${formatFullDate(data.dueAt)}, ${formatTime(data.dueAt)}`} tone={deadlinePassed ? 'danger' : 'primary'} />
          <Badge label={`${data.maxScore} балл(ов)`} tone="neutral" />
          <Badge label={`Версий: ${data.attemptsUsed ?? 0} из ${data.maxAttempts}`} tone="neutral" />
          <Badge
            label={data.allowResubmit ? 'Повторная сдача разрешена' : 'Без повторной сдачи'}
            tone={data.allowResubmit ? 'success' : 'warning'}
          />
        </View>
        <Text style={styles.description}>{data.description}</Text>
        {data.materials && data.materials.length > 0 ? (
          <View style={styles.extraBlock}>
            <Text style={styles.label}>Материалы задания</Text>
            {data.materials.map((material) => (
              <Pressable key={material.url} onPress={() => openLink(material.url)}>
                <Text style={styles.link}>📎 {material.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {data.criteria && data.criteria.length > 0 ? (
          <View style={styles.extraBlock}>
            <Text style={styles.label}>Критерии оценивания</Text>
            {data.criteria.map((criterion) => (
              <Text key={criterion.title} style={styles.hint}>
                {criterion.title} · {criterion.weight}%
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      {submission ? <SubmissionCard submission={submission} maxScore={data.maxScore} onOpen={openLink} /> : null}

      {canSubmit ? (
        <Card>
          <Text style={styles.blockTitle}>{submission ? 'Отправить новое решение' : 'Ваше решение'}</Text>
          <Text style={styles.hint}>
            Прикрепите текст, ссылку на репозиторий или файлы. После отправки работу проверит преподаватель.
          </Text>
          {draftRestored ? (
            <Text style={styles.offlineNotice}>Черновик восстановлен с устройства.</Text>
          ) : null}
          {queued || offline.pending > 0 ? (
            <Text style={styles.offlineNotice}>
              Есть решения в очереди: {Math.max(offline.pending, queued ? 1 : 0)}. Отправятся при восстановлении связи.
            </Text>
          ) : null}

          <Controller
            control={form.control}
            name="text"
            render={({ field, fieldState }) => (
              <TextArea
                label="Текст решения"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                placeholder="Что сделано, какие решения приняты, что проверить"
                minHeight={120}
                maxLength={20000}
              />
            )}
          />

          <Controller
            control={form.control}
            name="projectUrl"
            render={({ field, fieldState }) => (
              <Input
                label="Ссылка на проект"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                placeholder="https://github.com/..."
                autoCapitalize="none"
                keyboardType="url"
              />
            )}
          />

          <Text style={styles.label}>Файлы (ссылки)</Text>
          {files.fields.length === 0 ? (
            <Text style={styles.hint}>Файлов пока нет — можно добавить ссылку на диск или архив.</Text>
          ) : null}

          {files.fields.map((file, index) => (
            <View key={file.id} style={styles.fileRow}>
              <View style={styles.fileFields}>
                <Controller
                  control={form.control}
                  name={`files.${index}.name`}
                  render={({ field, fieldState }) => (
                    <Input
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                      placeholder="Название файла"
                      containerStyle={styles.fieldTight}
                    />
                  )}
                />
                <Controller
                  control={form.control}
                  name={`files.${index}.url`}
                  render={({ field, fieldState }) => (
                    <Input
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                      placeholder="https://..."
                      autoCapitalize="none"
                      keyboardType="url"
                      containerStyle={styles.fieldTight}
                    />
                  )}
                />
              </View>
              <IconButton icon="✕" accessibilityLabel="Удалить файл" onPress={() => files.remove(index)} />
            </View>
          ))}

          {files.fields.length < 5 ? (
            <Button
              title="＋ Добавить файл"
              variant="secondary"
              size="sm"
              onPress={() => files.append({ name: '', url: '' })}
              style={{ marginTop: spacing.sm }}
            />
          ) : null}

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <Button
            title={submission ? 'Отправить повторно' : 'Отправить решение'}
            loading={submit.isPending}
            onPress={form.handleSubmit((values) => {
              setFormError(null)
              submit.mutate(values)
            })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : (
        <Card>
          <Text style={styles.blockTitle}>Работа отправлена</Text>
          <Text style={styles.hint}>
            {data.submitBlockedReason ??
              (submission?.status === 'RETURNED'
                ? 'Преподаватель вернул работу, но лимит версий уже исчерпан.'
                : 'Новая версия сейчас недоступна.')}
          </Text>
          <Button title="К списку заданий" variant="secondary" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  )
}

function SubmissionCard({
  submission,
  maxScore,
  onOpen,
}: {
  submission: HomeworkSubmission
  maxScore: number
  onOpen: (url: string) => void
}) {
  const styles = useThemedStyles(makeStyles)
  const tone = submission.status === 'REVIEWED' ? 'success' : submission.status === 'RETURNED' ? 'warning' : 'primary'
  const label =
    submission.status === 'REVIEWED' ? 'Проверено' : submission.status === 'RETURNED' ? 'На доработке' : 'На проверке'

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.blockTitle}>Ваша работа</Text>
        <Badge label={label} tone={tone} />
      </View>
      <Text style={styles.hint}>
        Попытка {submission.attempt} · отправлено {formatFullDate(submission.submittedAt)},{' '}
        {formatTime(submission.submittedAt)}
      </Text>

      {submission.text ? <Text style={styles.body}>{submission.text}</Text> : null}

      {submission.projectUrl ? (
        <Text style={styles.link} onPress={() => onOpen(submission.projectUrl as string)}>
          {submission.projectUrl}
        </Text>
      ) : null}

      {(submission.files ?? []).map((file) => (
        <Pressable key={`${file.name}-${file.url}`} onPress={() => onOpen(file.url)}>
          <Text style={styles.link}>📎 {file.name}</Text>
        </Pressable>
      ))}

      {submission.review ? (
        <View style={styles.review}>
          <Text style={styles.reviewScore}>
            Оценка: {submission.review.score} из {maxScore}
          </Text>
          {submission.review.comment ? <Text style={styles.body}>{submission.review.comment}</Text> : null}
          {submission.review.reviewer ? (
            <Text style={styles.hint}>Проверил: {submission.review.reviewer}</Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    course: { fontSize: typography.tiny, fontWeight: '700', color: c.primary, textTransform: 'uppercase' },
    title: { fontSize: typography.h1, fontWeight: '800', color: c.text, marginTop: spacing.xs },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
    description: { fontSize: typography.body, color: c.text, marginTop: spacing.md, lineHeight: 22 },
    blockTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    hint: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs, lineHeight: 19 },
    body: { fontSize: typography.body, color: c.text, marginTop: spacing.sm, lineHeight: 21 },
    link: { fontSize: typography.caption, color: c.primary, fontWeight: '600', marginTop: spacing.sm },
    review: {
      marginTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.md,
      gap: 2,
    },
    reviewScore: { fontSize: typography.body, fontWeight: '800', color: c.text },
    label: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted, marginTop: spacing.sm },
    extraBlock: { marginTop: spacing.md, gap: spacing.xs },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    fileFields: { flex: 1 },
    fieldTight: { marginBottom: spacing.xs },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    error: { fontSize: typography.caption, color: c.danger, marginTop: spacing.sm },
    offlineNotice: {
      fontSize: typography.caption,
      color: c.warning,
      marginTop: spacing.sm,
      fontWeight: '600',
      lineHeight: 18,
    },
  })
