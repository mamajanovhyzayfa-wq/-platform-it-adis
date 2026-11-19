import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import {
  Button,
  Card,
  ErrorState,
  Input,
  Modal,
  Screen,
  Skeleton,
  TextArea,
  useToast,
} from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { RoleGate } from '@/components/guards'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

const schema = z.object({
  title: z.string().trim().min(3, 'Минимум 3 символа').max(200, 'Не больше 200 символов'),
  description: z.string().trim().min(3, 'Опишите задание').max(5000, 'Не больше 5000 символов'),
  maxScore: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Введите балл числом')
    .refine((value) => Number(value) >= 1, 'Минимум 1 балл')
    .refine((value) => Number(value) <= 100, 'Не больше 100 баллов'),
  allowResubmit: z.boolean(),
  dueAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Укажите дедлайн'),
})

type FormValues = z.infer<typeof schema>
type PickerMode = 'date' | 'time'

/** Дедлайн по умолчанию — через неделю в 18:00. */
function defaultDueAt(): Date {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  date.setHours(18, 0, 0, 0)
  return date
}

function mergeDatePart(base: Date, selected: Date): Date {
  const next = new Date(base)
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate())
  return next
}

function mergeTimePart(base: Date, selected: Date): Date {
  const next = new Date(base)
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
  return next
}

export default function TeacherHomeworkScreen() {
  return (
    <RoleGate allow={['TEACHER', 'ADMIN']}>
      <TeacherHomeworkContent />
    </RoleGate>
  )
}

function TeacherHomeworkContent() {
  const { id, courseId } = useLocalSearchParams<{ id: string; courseId?: string }>()
  const isNew = id === 'new'
  const { t } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null)
  const [draftDate, setDraftDate] = useState<Date>(defaultDueAt)

  const homework = useQuery({
    queryKey: ['teacher-homework', id],
    queryFn: () => api.teacherHomework(id),
    enabled: !isNew && Boolean(id),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      maxScore: '10',
      allowResubmit: false,
      dueAt: defaultDueAt().toISOString(),
    },
  })

  const dueAtValue = form.watch('dueAt')
  const dueAtDate = useMemo(() => new Date(dueAtValue), [dueAtValue])
  const allowResubmit = form.watch('allowResubmit')

  useEffect(() => {
    if (!homework.data) return
    form.reset({
      title: homework.data.title,
      description: homework.data.description,
      maxScore: String(homework.data.maxScore),
      allowResubmit: homework.data.allowResubmit,
      dueAt: homework.data.dueAt,
    })
  }, [homework.data, form])

  const targetCourseId = courseId ?? homework.data?.course.id ?? ''

  const invalidate = () => {
    if (targetCourseId) void queryClient.invalidateQueries({ queryKey: ['teacher-course', targetCourseId] })
    void queryClient.invalidateQueries({ queryKey: ['teacher-course'] })
    void queryClient.invalidateQueries({ queryKey: ['teacher-courses'] })
    void queryClient.invalidateQueries({ queryKey: ['teacher-overview'] })
    if (!isNew) void queryClient.invalidateQueries({ queryKey: ['teacher-homework', id] })
  }

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        title: values.title,
        description: values.description,
        dueAt: new Date(values.dueAt).toISOString(),
        maxScore: Number(values.maxScore),
        allowResubmit: values.allowResubmit,
      }
      return isNew ? api.createHomework(targetCourseId, payload) : api.updateHomework(id, payload)
    },
    onSuccess: () => {
      invalidate()
      toast.success(t('teacher.homeworkSaved'))
      router.back()
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const openPicker = (mode: PickerMode) => {
    setDraftDate(dueAtDate)
    setPickerMode(mode)
  }

  const applyDraft = (next: Date) => {
    form.setValue('dueAt', next.toISOString(), { shouldValidate: true, shouldDirty: true })
    setPickerMode(null)
  }

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setPickerMode(null)
      if (event.type !== 'set' || !selected) return
      applyDraft(pickerMode === 'date' ? mergeDatePart(dueAtDate, selected) : mergeTimePart(dueAtDate, selected))
      return
    }
    if (event.type === 'dismissed' || !selected) return
    setDraftDate((current) =>
      pickerMode === 'date' ? mergeDatePart(current, selected) : mergeTimePart(current, selected),
    )
  }

  if (!isNew && homework.isLoading) {
    return (
      <Screen>
        <Skeleton height={120} borderRadius={18} />
        <Skeleton height={220} borderRadius={18} />
        <Skeleton height={110} borderRadius={18} />
      </Screen>
    )
  }

  if (!isNew && (homework.isError || !homework.data)) {
    return (
      <Screen>
        <ErrorState onRetry={() => void homework.refetch()} />
      </Screen>
    )
  }

  if (isNew && !targetCourseId) {
    return (
      <Screen>
        <ErrorState title="Курс не выбран" message="Откройте курс и создайте задание из его программы." />
      </Screen>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: isNew ? t('teacher.newHomework') : t('teacher.editHomework') }} />
      <Screen
        refreshing={!isNew && homework.isRefetching}
        onRefresh={isNew ? undefined : () => void homework.refetch()}
      >
        <Card>
          <Controller
            control={form.control}
            name="title"
            render={({ field, fieldState }) => (
              <Input
                label={t('teacher.homeworkTitle')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                placeholder="Например: Свёрстать экран профиля"
              />
            )}
          />
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <TextArea
                label={t('teacher.homeworkDescription')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                hint="Что нужно сделать и по каким критериям оценивается работа."
                minHeight={140}
                maxLength={5000}
              />
            )}
          />
        </Card>

        <Card>
          <Text style={styles.blockTitle}>{t('teacher.dueAt')}</Text>
          <View style={styles.dateRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('teacher.date')}: ${formatFullDate(dueAtDate.toISOString())}`}
              onPress={() => openPicker('date')}
              style={({ pressed }) => [styles.dateField, { borderColor: theme.colors.border }, pressed && styles.pressed]}
            >
              <Text style={styles.fieldLabel}>{t('teacher.date')}</Text>
              <Text style={styles.fieldValue}>{formatFullDate(dueAtDate.toISOString())}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('teacher.time')}: ${formatTime(dueAtDate.toISOString())}`}
              onPress={() => openPicker('time')}
              style={({ pressed }) => [styles.timeField, { borderColor: theme.colors.border }, pressed && styles.pressed]}
            >
              <Text style={styles.fieldLabel}>{t('teacher.time')}</Text>
              <Text style={styles.fieldValue}>{formatTime(dueAtDate.toISOString())}</Text>
            </Pressable>
          </View>
          {form.formState.errors.dueAt ? (
            <Text style={styles.error}>{form.formState.errors.dueAt.message}</Text>
          ) : null}

          <Controller
            control={form.control}
            name="maxScore"
            render={({ field, fieldState }) => (
              <View style={styles.scoreField}>
                <Input
                  label={t('teacher.maxScore')}
                  required
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  keyboardType="number-pad"
                  hint="От 1 до 100. Этот балл увидит ученик при проверке."
                />
              </View>
            )}
          />

          <Controller
            control={form.control}
            name="allowResubmit"
            render={({ field }) => (
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchLabel}>{t('teacher.allowResubmit')}</Text>
                  <Text style={styles.switchHint}>{t('teacher.allowResubmitHint')}</Text>
                </View>
                <Switch
                  value={field.value}
                  onValueChange={field.onChange}
                  trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
                  thumbColor={theme.colors.white}
                  accessibilityLabel={t('teacher.allowResubmit')}
                />
              </View>
            )}
          />
          <Text style={styles.resubmitState}>
            {allowResubmit ? t('teacher.resubmitAllowed') : t('teacher.resubmitForbidden')}
          </Text>
        </Card>

        <Button
          title={t('teacher.save')}
          loading={save.isPending}
          onPress={form.handleSubmit((values) => save.mutate(values))}
        />
      </Screen>

      {Platform.OS === 'android' && pickerMode ? (
        <DateTimePicker
          value={dueAtDate}
          mode={pickerMode}
          display="default"
          is24Hour
          onChange={onPickerChange}
        />
      ) : null}

      <Modal
        visible={Platform.OS === 'ios' && pickerMode !== null}
        onClose={() => setPickerMode(null)}
        title={pickerMode === 'date' ? t('teacher.date') : t('teacher.time')}
        footer={
          <Button
            title={t('teacher.done')}
            onPress={() => {
              applyDraft(draftDate)
            }}
          />
        }
      >
        <DateTimePicker
          value={draftDate}
          mode={pickerMode ?? 'date'}
          display="spinner"
          is24Hour
          onChange={onPickerChange}
          themeVariant={theme.scheme}
        />
      </Modal>
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    blockTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text },
    dateRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    dateField: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: c.card,
      gap: 2,
    },
    timeField: {
      width: 108,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: c.card,
      gap: 2,
    },
    fieldLabel: { fontSize: typography.tiny, color: c.textMuted, fontWeight: '600' },
    fieldValue: { fontSize: typography.body, color: c.text, fontWeight: '600' },
    error: { fontSize: typography.caption, color: c.danger, marginTop: spacing.xs },
    scoreField: { marginTop: spacing.md },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    switchText: { flex: 1, gap: 2 },
    switchLabel: { fontSize: typography.body, fontWeight: '600', color: c.text },
    switchHint: { fontSize: typography.caption, color: c.textMuted, lineHeight: 18 },
    resubmitState: {
      fontSize: typography.tiny,
      fontWeight: '700',
      color: c.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.xs,
    },
    pressed: { opacity: 0.8 },
  })
