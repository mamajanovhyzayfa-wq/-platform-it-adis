import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Linking, StyleSheet, Text, View } from 'react-native'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Screen,
  Skeleton,
  TextArea,
  useToast,
} from '@/components/ui'
import { useSubmissionStatus } from '@/components/teacher'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { RoleGate } from '@/components/guards'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate } from '@/utils/format'

const schema = z.object({
  score: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Введите балл числом')
    .refine((value) => Number(value) <= 100, 'Балл слишком большой'),
  comment: z.string().trim().max(4000).optional(),
})

type FormValues = z.infer<typeof schema>

export default function TeacherSubmissionScreen() {
  return (
    <RoleGate allow={['TEACHER', 'ADMIN']}>
      <TeacherSubmissionContent />
    </RoleGate>
  )
}

function TeacherSubmissionContent() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const styles = useThemedStyles(makeStyles)
  const statusMeta = useSubmissionStatus()

  const submission = useQuery({
    queryKey: ['teacher-submission', id],
    queryFn: () => api.teacherSubmission(id),
    enabled: Boolean(id),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { score: '', comment: '' },
  })

  useEffect(() => {
    if (!submission.data) return
    form.reset({
      score: submission.data.review?.score?.toString() ?? submission.data.score?.toString() ?? '',
      comment: submission.data.review?.comment ?? '',
    })
    // Форма заполняется один раз при открытии работы, а не после каждой проверки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.data?.id])

  const review = useMutation({
    mutationFn: (payload: { score: number; comment?: string; returnForRevision: boolean }) =>
      api.reviewSubmission(id, payload),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['teacher-submission', id] })
      void queryClient.invalidateQueries({ queryKey: ['teacher-submissions'] })
      void queryClient.invalidateQueries({ queryKey: ['teacher-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['teacher-courses'] })
      toast.success(variables.returnForRevision ? t('teacher.returnSuccess') : t('teacher.reviewSuccess'))
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  if (submission.isLoading) {
    return (
      <Screen>
        <Skeleton height={96} borderRadius={18} />
        <Skeleton height={180} borderRadius={18} />
        <Skeleton height={220} borderRadius={18} />
      </Screen>
    )
  }

  if (submission.isError || !submission.data) {
    return (
      <Screen>
        <ErrorState onRetry={() => void submission.refetch()} />
      </Screen>
    )
  }

  const data = submission.data
  const status = statusMeta(data.status)

  const submit = (returnForRevision: boolean) =>
    form.handleSubmit((values) => {
      const score = Number(values.score)
      if (score > data.homework.maxScore) {
        form.setError('score', { message: `Максимум ${data.homework.maxScore}` })
        return
      }
      if (returnForRevision && !values.comment?.trim()) {
        form.setError('comment', { message: 'Опишите, что нужно исправить' })
        return
      }
      review.mutate({ score, comment: values.comment?.trim() || undefined, returnForRevision })
    })()

  const openUrl = (url: string) => {
    void Linking.openURL(url).catch(() => toast.error('Не удалось открыть ссылку'))
  }

  return (
    <>
      <Stack.Screen options={{ title: data.homework.title }} />
      <Screen refreshing={submission.isRefetching} onRefresh={() => void submission.refetch()}>
        <Card>
          <View style={styles.row}>
            <Avatar
              firstName={data.student.firstName}
              lastName={data.student.lastName}
              uri={data.student.avatarUrl}
              size={48}
            />
            <View style={styles.rowBody}>
              <Text style={styles.name}>{data.student.name}</Text>
              <Text style={styles.muted}>{data.student.email}</Text>
            </View>
            <Badge label={status.label} tone={status.tone} />
          </View>
          <View style={styles.divider} />
          <Text style={styles.homeworkTitle}>{data.homework.title}</Text>
          <Text style={styles.muted}>{data.homework.course.title}</Text>
          <Text style={styles.meta}>
            {t('teacher.attempt')} {data.attempt} · {t('homework.due')}: {formatFullDate(data.homework.dueAt)} ·{' '}
            {t('teacher.score')}: {data.homework.maxScore}
          </Text>
          <Text style={styles.meta}>
            Отправлено: {formatFullDate(data.submittedAt)}
            {data.reviewedAt ? ` · Проверено: ${formatFullDate(data.reviewedAt)}` : ''}
          </Text>
        </Card>

        <Text style={styles.sectionTitle}>{t('teacher.solution')}</Text>
        <Card>
          {data.text ? <Text style={styles.solutionText}>{data.text}</Text> : null}
          {!data.text && !data.projectUrl && !(data.files && data.files.length > 0) ? (
            <Text style={styles.muted}>{t('teacher.noSolutionText')}</Text>
          ) : null}
          {data.projectUrl ? (
            <Text style={styles.link} onPress={() => openUrl(data.projectUrl!)}>
              {t('teacher.openLink')}: {data.projectUrl}
            </Text>
          ) : null}
          {data.files?.map((file) => (
            <Text key={`${file.name}-${file.url}`} style={styles.link} onPress={() => openUrl(file.url)}>
              📎 {file.name}
            </Text>
          ))}
        </Card>

        <Text style={styles.sectionTitle}>{t('teacher.reviewForm')}</Text>
        <Card>
          <Controller
            control={form.control}
            name="score"
            render={({ field, fieldState }) => (
              <Input
                label={`${t('teacher.score')} (0–${data.homework.maxScore})`}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="number-pad"
                placeholder="0"
              />
            )}
          />
          <Controller
            control={form.control}
            name="comment"
            render={({ field, fieldState }) => (
              <TextArea
                label={t('teacher.comment')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                hint="Ученик увидит комментарий вместе с оценкой."
                minHeight={110}
                maxLength={4000}
              />
            )}
          />
          <View style={styles.actions}>
            <Button
              title={t('teacher.review')}
              loading={review.isPending && review.variables?.returnForRevision === false}
              onPress={() => submit(false)}
            />
            <Button
              title={t('teacher.returnForRevision')}
              variant="ghost"
              loading={review.isPending && review.variables?.returnForRevision === true}
              onPress={() => submit(true)}
            />
          </View>
        </Card>
      </Screen>
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowBody: { flex: 1, gap: 2 },
    name: { fontSize: typography.h2, fontWeight: '700', color: c.text },
    muted: { fontSize: typography.caption, color: c.textMuted },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.md },
    homeworkTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    meta: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xs },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginTop: spacing.md },
    solutionText: { fontSize: typography.body, color: c.text, lineHeight: 22 },
    link: { fontSize: typography.caption, color: c.primary, marginTop: spacing.sm, fontWeight: '600' },
    actions: { gap: spacing.sm, marginTop: spacing.sm },
  })
