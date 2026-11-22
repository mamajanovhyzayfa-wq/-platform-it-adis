import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, Switch, Text, View } from 'react-native'
import {
  Badge,
  Button,
  Card,
  ConfirmationDialog,
  ErrorState,
  Input,
  Screen,
  Skeleton,
  TextArea,
  useToast,
} from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { RoleGate } from '@/components/guards'
import { useI18n } from '@/i18n'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const schema = z.object({
  title: z.string().trim().min(3, 'Минимум 3 символа').max(200),
  description: z.string().trim().max(2000).optional(),
  content: z.string().max(50000).optional(),
  videoUrl: z.union([z.literal(''), z.string().url('Ссылка должна быть полным URL')]).optional(),
  durationMinutes: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Укажите число минут')
    .refine((value) => Number(value) <= 600, 'Не больше 600 минут'),
  published: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export default function TeacherLessonScreen() {
  return (
    <RoleGate allow={['TEACHER', 'ADMIN']}>
      <TeacherLessonContent />
    </RoleGate>
  )
}

function TeacherLessonContent() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const lesson = useQuery({
    queryKey: ['lesson', id],
    queryFn: () => api.lesson(id),
    enabled: Boolean(id),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      content: '',
      videoUrl: '',
      durationMinutes: '0',
      published: false,
    },
  })

  useEffect(() => {
    if (!lesson.data) return
    form.reset({
      title: lesson.data.title,
      description: lesson.data.description ?? '',
      content: lesson.data.content ?? '',
      videoUrl: lesson.data.videoUrl ?? '',
      durationMinutes: String(lesson.data.durationMinutes),
      published: lesson.data.publishedAt !== null,
    })
  }, [lesson.data, form])

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.updateLesson(id, {
        title: values.title,
        description: values.description || undefined,
        content: values.content || undefined,
        videoUrl: values.videoUrl || undefined,
        durationMinutes: Number(values.durationMinutes) || 0,
        published: values.published,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['teacher-course'] })
      void queryClient.invalidateQueries({ queryKey: ['lesson', id] })
      void queryClient.invalidateQueries({ queryKey: ['course'] })
      toast.success(t('teacher.saved'))
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteLesson(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['teacher-course'] })
      toast.success(t('teacher.saved'))
      router.back()
    },
    onError: (error) => {
      toast.error(describeApiError(error))
      setConfirmDelete(false)
    },
  })

  if (lesson.isLoading) {
    return (
      <Screen>
        <Skeleton width="65%" height={24} />
        <Skeleton height={120} borderRadius={18} />
        <Skeleton height={200} borderRadius={18} />
      </Screen>
    )
  }

  if (lesson.isError || !lesson.data) {
    return (
      <Screen>
        <ErrorState onRetry={() => void lesson.refetch()} />
      </Screen>
    )
  }

  const data = lesson.data
  const published = form.watch('published')

  return (
    <>
      <Stack.Screen options={{ title: data.title }} />
      <Screen refreshing={lesson.isRefetching} onRefresh={() => void lesson.refetch()}>
        <Card>
          <View style={styles.badges}>
            <Badge label={data.module.title} tone="neutral" size="md" />
            <Badge
              label={data.publishedAt ? t('teacher.published') : t('teacher.draft')}
              tone={data.publishedAt ? 'success' : 'neutral'}
              size="md"
            />
          </View>
          <Text style={styles.muted}>{data.course.title}</Text>
        </Card>

        <Card>
          <Controller
            control={form.control}
            name="title"
            render={({ field, fieldState }) => (
              <Input
                label={t('teacher.lessonTitle')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <TextArea
                label={t('teacher.description')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                minHeight={80}
              />
            )}
          />
          <Controller
            control={form.control}
            name="videoUrl"
            render={({ field, fieldState }) => (
              <Input
                label={t('teacher.videoUrl')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://…mp4"
              />
            )}
          />
          <Controller
            control={form.control}
            name="durationMinutes"
            render={({ field, fieldState }) => (
              <Input
                label={t('teacher.duration')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="number-pad"
              />
            )}
          />
          <Controller
            control={form.control}
            name="content"
            render={({ field, fieldState }) => (
              <TextArea
                label={t('teacher.content')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                minHeight={160}
                maxLength={50000}
              />
            )}
          />
          <Controller
            control={form.control}
            name="published"
            render={({ field }) => (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('teacher.published')}</Text>
                <Switch
                  value={field.value}
                  onValueChange={field.onChange}
                  trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
                  thumbColor={theme.colors.white}
                  accessibilityLabel={t('teacher.published')}
                />
              </View>
            )}
          />
        </Card>

        <Button
          title={t('teacher.save')}
          loading={save.isPending}
          onPress={form.handleSubmit((values) => save.mutate(values))}
        />

        <Button
          title={t('teacher.delete')}
          variant="ghost"
          disabled={published}
          accessibilityHint={published ? 'Сначала снимите урок с публикации' : undefined}
          onPress={() => setConfirmDelete(true)}
        />
      </Screen>

      <ConfirmationDialog
        visible={confirmDelete}
        title={t('teacher.deleteLessonTitle')}
        description={t('teacher.deleteLessonText')}
        confirmLabel={t('teacher.delete')}
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.sm },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    switchLabel: { fontSize: typography.body, fontWeight: '600', color: c.text },
  })
