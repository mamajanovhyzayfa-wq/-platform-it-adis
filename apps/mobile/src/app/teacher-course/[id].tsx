import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ProgressBar,
  Screen,
  Skeleton,
  TextArea,
  useToast,
} from '@/components/ui'
import { api, type TeacherModule } from '@/api/api'
import { describeApiError } from '@/api/client'
import { RoleGate } from '@/components/guards'
import { useI18n } from '@/i18n'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { courseStatusLabel } from '@/components/teacher'
import { formatFullDate } from '@/utils/format'

const moduleSchema = z.object({
  title: z.string().trim().min(2, 'Минимум 2 символа').max(120),
  description: z.string().trim().max(1000).optional(),
})

const lessonSchema = z.object({
  title: z.string().trim().min(3, 'Минимум 3 символа').max(200),
  description: z.string().trim().max(2000).optional(),
  videoUrl: z.union([z.literal(''), z.string().url('Ссылка должна быть полным URL')]).optional(),
  durationMinutes: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Укажите число минут')
    .refine((value) => Number(value) <= 600, 'Не больше 600 минут'),
  published: z.boolean(),
})

type ModuleForm = z.infer<typeof moduleSchema>
type LessonForm = z.infer<typeof lessonSchema>

export default function TeacherCourseScreen() {
  return (
    <RoleGate allow={['TEACHER', 'ADMIN']}>
      <TeacherCourseContent />
    </RoleGate>
  )
}

function TeacherCourseContent() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useI18n()
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToast()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  const [moduleSheet, setModuleSheet] = useState(false)
  const [lessonSheet, setLessonSheet] = useState<{ moduleId: string; moduleTitle: string } | null>(null)
  const [moduleToDelete, setModuleToDelete] = useState<TeacherModule | null>(null)

  const course = useQuery({
    queryKey: ['teacher-course', id],
    queryFn: () => api.teacherCourse(id),
    enabled: Boolean(id),
  })

  const moduleForm = useForm<ModuleForm>({
    resolver: zodResolver(moduleSchema),
    defaultValues: { title: '', description: '' },
  })
  const lessonForm = useForm<LessonForm>({
    resolver: zodResolver(lessonSchema),
    defaultValues: { title: '', description: '', videoUrl: '', durationMinutes: '0', published: false },
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['teacher-course', id] })
    void queryClient.invalidateQueries({ queryKey: ['teacher-courses'] })
    void queryClient.invalidateQueries({ queryKey: ['teacher-overview'] })
  }

  const createModule = useMutation({
    mutationFn: (values: ModuleForm) =>
      api.createModule(id, { title: values.title, description: values.description || undefined }),
    onSuccess: () => {
      invalidate()
      toast.success(t('teacher.saved'))
      setModuleSheet(false)
      moduleForm.reset()
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const createLesson = useMutation({
    mutationFn: (values: LessonForm) =>
      api.createLesson({
        moduleId: lessonSheet!.moduleId,
        title: values.title,
        description: values.description || undefined,
        videoUrl: values.videoUrl || undefined,
        durationMinutes: Number(values.durationMinutes) || 0,
        published: values.published,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('teacher.saved'))
      setLessonSheet(null)
      lessonForm.reset()
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const deleteModule = useMutation({
    mutationFn: (moduleId: string) => api.deleteModule(moduleId),
    onSuccess: () => {
      invalidate()
      toast.success(t('teacher.saved'))
      setModuleToDelete(null)
    },
    onError: (error) => {
      toast.error(describeApiError(error))
      setModuleToDelete(null)
    },
  })

  if (course.isLoading) {
    return (
      <Screen>
        <Skeleton width="70%" height={26} />
        <Skeleton height={120} borderRadius={18} />
        <Skeleton height={160} borderRadius={18} />
      </Screen>
    )
  }

  if (course.isError || !course.data) {
    return (
      <Screen>
        <ErrorState onRetry={() => void course.refetch()} />
      </Screen>
    )
  }

  const data = course.data
  const hasModules = data.modules.length > 0

  return (
    <>
      <Stack.Screen options={{ title: data.title }} />
      <Screen refreshing={course.isRefetching} onRefresh={() => void course.refetch()}>
        <Card>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{data.title}</Text>
            <Badge label={courseStatusLabel(data.status, t)} tone={data.status === 'DRAFT' ? 'neutral' : 'primary'} />
          </View>
          <Text style={styles.muted}>{data.description}</Text>
          <View style={styles.chips}>
            <Badge label={`${data.studentsCount} ${t('teacher.studentsWord')}`} tone="neutral" size="md" />
            <Badge
              label={`${data.publishedLessonsCount}/${data.lessonsCount} ${t('teacher.lessonsWord')}`}
              tone="primary"
              size="md"
            />
            {data.pendingReviews > 0 ? (
              <Badge label={`${t('teacher.pending')}: ${data.pendingReviews}`} tone="warning" size="md" />
            ) : null}
          </View>
          <ProgressBar value={data.avgProgress} />
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('teacher.program')}</Text>
          <Button
            title={t('teacher.addModule')}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setModuleSheet(true)}
          />
        </View>

        {!hasModules ? (
          <EmptyState
            title={t('teacher.programEmpty')}
            hint={t('teacher.programEmptyHint')}
            icon="🧩"
            action={<Button title={t('teacher.addModule')} onPress={() => setModuleSheet(true)} />}
          />
        ) : (
          data.modules.map((module, index) => (
            <Card key={module.id} style={styles.moduleCard}>
              <View style={styles.moduleHeader}>
                <View style={styles.moduleTitleWrap}>
                  <Text style={styles.moduleIndex}>Модуль {index + 1}</Text>
                  <Text style={styles.moduleTitle}>{module.title}</Text>
                  <Text style={styles.muted}>
                    {module.lessonsCount} {t('teacher.lessonsWord')}
                  </Text>
                </View>
                <View style={styles.moduleActions}>
                  <IconButton
                    icon="＋"
                    variant="soft"
                    accessibilityLabel={t('teacher.addLesson')}
                    onPress={() => {
                      lessonForm.reset({ title: '', description: '', videoUrl: '', durationMinutes: '0', published: false })
                      setLessonSheet({ moduleId: module.id, moduleTitle: module.title })
                    }}
                  />
                  <IconButton
                    icon="🗑"
                    accessibilityLabel={t('teacher.delete')}
                    onPress={() => setModuleToDelete(module)}
                  />
                </View>
              </View>

              {module.lessons.length === 0 ? (
                <Text style={styles.emptyModule}>В модуле пока нет уроков</Text>
              ) : (
                <View style={styles.lessonList}>
                  {module.lessons.map((lesson) => (
                    <Pressable
                      key={lesson.id}
                      accessibilityRole="button"
                      accessibilityLabel={lesson.title}
                      onPress={() => router.push({ pathname: '/teacher-lesson/[id]', params: { id: lesson.id } })}
                      style={({ pressed }) => [styles.lessonRow, { borderColor: theme.colors.border }, pressed && styles.pressed]}
                    >
                      <View style={styles.lessonBody}>
                        <Text style={styles.lessonTitle} numberOfLines={2}>
                          {lesson.title}
                        </Text>
                        <Text style={styles.meta}>
                          {lesson.durationMinutes} мин
                          {lesson.materialsCount > 0 ? ` · материалов: ${lesson.materialsCount}` : ''}
                        </Text>
                      </View>
                      <Badge
                        label={lesson.publishedAt ? t('teacher.published') : t('teacher.draft')}
                        tone={lesson.publishedAt ? 'success' : 'neutral'}
                      />
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          ))
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('teacher.homeworkSection')}</Text>
          <Button
            title={t('teacher.addHomework')}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() =>
              router.push({ pathname: '/teacher-homework/[id]', params: { id: 'new', courseId: id } })
            }
          />
        </View>

        {data.homework.length === 0 ? (
          <EmptyState
            title={t('teacher.homeworkEmpty')}
            hint={t('teacher.homeworkEmptyHint')}
            icon="📝"
            action={
              <Button
                title={t('teacher.addHomework')}
                onPress={() =>
                  router.push({ pathname: '/teacher-homework/[id]', params: { id: 'new', courseId: id } })
                }
              />
            }
          />
        ) : (
          data.homework.map((item) => (
            <Card
              key={item.id}
              onPress={() => router.push({ pathname: '/teacher-homework/[id]', params: { id: item.id, courseId: id } })}
              accessibilityLabel={item.title}
            >
              <View style={styles.homeworkRow}>
                <View style={styles.lessonBody}>
                  <Text style={styles.lessonTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta}>
                    {t('teacher.homeworkDueShort')}: {formatFullDate(item.dueAt)} ·{' '}
                    {t('teacher.maxScoreShort')}: {item.maxScore}
                  </Text>
                  <Text style={styles.meta}>
                    {item.allowResubmit ? t('teacher.resubmitAllowed') : t('teacher.resubmitForbidden')}
                  </Text>
                </View>
                {item.pendingSubmissions > 0 ? (
                  <Badge label={`${t('teacher.pending')}: ${item.pendingSubmissions}`} tone="warning" />
                ) : null}
              </View>
            </Card>
          ))
        )}
      </Screen>

      <BottomSheet
        visible={moduleSheet}
        onClose={() => setModuleSheet(false)}
        title={t('teacher.newModule')}
        description="Модуль объединяет уроки одной темы."
        footer={
          <Button
            title={t('teacher.save')}
            loading={createModule.isPending}
            onPress={moduleForm.handleSubmit((values) => createModule.mutate(values))}
          />
        }
      >
        <Controller
          control={moduleForm.control}
          name="title"
          render={({ field, fieldState }) => (
            <Input
              label={t('teacher.moduleTitle')}
              required
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              placeholder="Например: Введение в JavaScript"
            />
          )}
        />
        <Controller
          control={moduleForm.control}
          name="description"
          render={({ field, fieldState }) => (
            <TextArea
              label={t('teacher.description')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              minHeight={90}
            />
          )}
        />
      </BottomSheet>

      <BottomSheet
        visible={lessonSheet !== null}
        onClose={() => setLessonSheet(null)}
        title={t('teacher.newLesson')}
        description={lessonSheet ? `Модуль: ${lessonSheet.moduleTitle}` : undefined}
        footer={
          <Button
            title={t('teacher.save')}
            loading={createLesson.isPending}
            onPress={lessonForm.handleSubmit((values) => createLesson.mutate(values))}
          />
        }
      >
        <Controller
          control={lessonForm.control}
          name="title"
          render={({ field, fieldState }) => (
            <Input
              label={t('teacher.lessonTitle')}
              required
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              placeholder="Например: Переменные и типы данных"
            />
          )}
        />
        <Controller
          control={lessonForm.control}
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
          control={lessonForm.control}
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
          control={lessonForm.control}
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
          control={lessonForm.control}
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
      </BottomSheet>

      <ConfirmationDialog
        visible={moduleToDelete !== null}
        title={t('teacher.deleteModuleTitle')}
        description={moduleToDelete ? `${moduleToDelete.title}. ${t('teacher.deleteModuleText')}` : undefined}
        confirmLabel={t('teacher.delete')}
        destructive
        loading={deleteModule.isPending}
        onCancel={() => setModuleToDelete(null)}
        onConfirm={() => moduleToDelete && deleteModule.mutate(moduleToDelete.id)}
      />
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    title: { flex: 1, fontSize: typography.h1, fontWeight: '800', color: c.text },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    moduleCard: { gap: spacing.md },
    moduleHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    moduleTitleWrap: { flex: 1 },
    moduleIndex: {
      fontSize: typography.tiny,
      fontWeight: '700',
      color: c.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    moduleTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginTop: 2 },
    moduleActions: { flexDirection: 'row', gap: spacing.xs },
    lessonList: { gap: spacing.sm },
    lessonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    },
    lessonBody: { flex: 1 },
    homeworkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    lessonTitle: { fontSize: typography.body, fontWeight: '600', color: c.text },
    meta: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    emptyModule: { fontSize: typography.caption, color: c.textMuted },
    pressed: { opacity: 0.8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
    switchLabel: { fontSize: typography.body, fontWeight: '600', color: c.text },
  })
