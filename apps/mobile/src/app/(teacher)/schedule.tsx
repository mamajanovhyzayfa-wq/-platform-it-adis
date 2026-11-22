import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import {
  BottomSheet,
  Button,
  Card,
  ErrorState,
  Input,
  Screen,
  Skeleton,
  TextArea,
  Title,
  useToast,
} from '@/components/ui'
import { ScheduleCalendar, addDays, addMonths, calendarRange, type CalendarMode } from '@/components/schedule'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

const schema = z.object({
  courseId: z.string().min(1, 'Выберите курс'),
  title: z.string().trim().min(3, 'Минимум 3 символа').max(160, 'Не больше 160 символов'),
  description: z.string().trim().max(2000, 'Не больше 2000 символов').optional(),
})

type FormValues = z.infer<typeof schema>
type PickerMode = 'date' | 'time'

const DURATIONS = [45, 60, 90, 120]

/** Ближайшее занятие по умолчанию: через час, но не позднее 21:00. */
function defaultStart(): Date {
  const date = new Date()
  date.setMinutes(0, 0, 0)
  date.setHours(date.getHours() + 1)
  if (date.getHours() >= 21) {
    const tomorrow = addDays(date, 1)
    tomorrow.setHours(10, 0, 0, 0)
    return tomorrow
  }
  return date
}

function mergeDate(base: Date, selected: Date): Date {
  const next = new Date(base)
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate())
  return next
}

function mergeTime(base: Date, selected: Date): Date {
  const next = new Date(base)
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
  return next
}

/**
 * Расписание преподавателя: тот же календарь, что у ученика, плюс создание занятий.
 * Пересечения по времени проверяет сервер — текст конфликта показывается в форме.
 */
export default function TeacherSchedule() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<CalendarMode>('week')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [selected, setSelected] = useState<Date>(() => new Date())

  const [sheetOpen, setSheetOpen] = useState(false)
  const [startsAt, setStartsAt] = useState<Date>(defaultStart)
  const [duration, setDuration] = useState(60)
  const [picker, setPicker] = useState<PickerMode | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const range = useMemo(() => calendarRange(mode, anchor), [mode, anchor])

  const schedule = useQuery({
    queryKey: ['schedule', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api.schedule({ from: range.from.toISOString(), to: range.to.toISOString() }),
  })

  const courses = useQuery({
    queryKey: ['teacher-courses'],
    queryFn: api.teacherCourses,
    enabled: sheetOpen,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { courseId: '', title: '', description: '' },
  })

  // Список курсов приходит после открытия панели: подставляем первый, чтобы форма сразу готова.
  useEffect(() => {
    if (!sheetOpen) return
    const first = courses.data?.[0]
    if (first && !form.getValues('courseId')) form.setValue('courseId', first.id, { shouldValidate: true })
  }, [courses.data, sheetOpen, form])

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.createSchedule({
        courseId: values.courseId,
        title: values.title,
        description: values.description?.trim() || undefined,
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedule'] })
      toast.success('Занятие добавлено в расписание')
      setSheetOpen(false)
    },
    onError: (error) => {
      const message = describeApiError(error)
      setFormError(message)
      toast.error(message)
    },
  })

  const shift = (direction: -1 | 1) => {
    if (mode === 'day') {
      const next = addDays(selected, direction)
      setAnchor(next)
      setSelected(next)
      return
    }
    if (mode === 'week') {
      const next = addDays(anchor, direction * 7)
      setAnchor(next)
      setSelected(next)
      return
    }
    setAnchor(addMonths(anchor, direction))
    setSelected(addMonths(anchor, direction))
  }

  const openSheet = () => {
    form.reset({ courseId: courses.data?.[0]?.id ?? '', title: '', description: '' })
    setStartsAt(defaultStart())
    setDuration(60)
    setFormError(null)
    setSheetOpen(true)
  }

  const applyDraft = (mode: PickerMode, value: Date) => {
    setStartsAt((current) => (mode === 'date' ? mergeDate(current, value) : mergeTime(current, value)))
  }

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') {
      const currentMode = picker
      setPicker(null)
      if (event.type !== 'set' || !value || !currentMode) return
      applyDraft(currentMode, value)
      return
    }
    if (value && picker) applyDraft(picker, value)
  }

  const submit = form.handleSubmit((values) => {
    setFormError(null)
    const endsAt = new Date(startsAt.getTime() + duration * 60_000)
    if (endsAt.getTime() <= Date.now()) {
      setFormError('Занятие должно заканчиваться в будущем')
      return
    }
    create.mutate(values)
  })

  return (
    <>
      <Screen refreshing={schedule.isRefetching} onRefresh={() => void schedule.refetch()}>
        <View style={styles.head}>
          <Title subtitle="Занятия ваших курсов · проверка пересечений по времени.">{t('schedule.title')}</Title>
          <Button title="+ Занятие" size="sm" fullWidth={false} onPress={openSheet} />
        </View>

        {schedule.isLoading ? (
          <>
            <Skeleton height={48} borderRadius={24} />
            <Skeleton height={72} borderRadius={16} />
            <Card>
              <Skeleton width="55%" height={18} />
              <Skeleton width="35%" height={12} style={{ marginTop: spacing.sm }} />
              <Skeleton height={44} borderRadius={12} style={{ marginTop: spacing.md }} />
            </Card>
          </>
        ) : schedule.isError ? (
          <ErrorState
            title="Не удалось загрузить расписание"
            message={describeApiError(schedule.error)}
            onRetry={() => void schedule.refetch()}
          />
        ) : (
          <ScheduleCalendar
            items={schedule.data ?? []}
            mode={mode}
            anchor={anchor}
            selected={selected}
            onChangeMode={(next) => {
              setMode(next)
              setAnchor(selected)
            }}
            onShift={shift}
            onToday={() => {
              const today = new Date()
              setAnchor(today)
              setSelected(today)
            }}
            onSelect={(date) => {
              setSelected(date)
              if (mode === 'day') setAnchor(date)
            }}
          />
        )}
      </Screen>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Новое занятие"
        description="Ученики курса получат уведомление о занятии."
        footer={
          <>
            <Button title="Создать занятие" loading={create.isPending} onPress={() => void submit()} />
            <Button title="Отмена" variant="ghost" onPress={() => setSheetOpen(false)} />
          </>
        }
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          {courses.isLoading ? (
            <Skeleton height={40} borderRadius={radius.md} />
          ) : (courses.data ?? []).length === 0 ? (
            <Text style={styles.hint}>Сначала создайте курс — занятие привязывается к курсу.</Text>
          ) : (
            <>
              <Text style={styles.label}>Курс</Text>
              <View style={styles.chips}>
                {(courses.data ?? []).map((course) => {
                  const active = form.watch('courseId') === course.id
                  return (
                    <Pressable
                      key={course.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => form.setValue('courseId', course.id, { shouldValidate: true })}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.card,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, active && { color: theme.colors.primary }]} numberOfLines={1}>
                        {course.title}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              {form.formState.errors.courseId ? (
                <Text style={styles.error}>{form.formState.errors.courseId.message}</Text>
              ) : null}
            </>
          )}

          <Controller
            control={form.control}
            name="title"
            render={({ field, fieldState }) => (
              <Input
                label="Тема занятия"
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                placeholder="Например: Разбор макетов и адаптива"
              />
            )}
          />

          <Text style={styles.label}>Начало</Text>
          <View style={styles.dateRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Дата: ${formatFullDate(startsAt.toISOString())}`}
              onPress={() => setPicker(picker === 'date' ? null : 'date')}
              style={({ pressed }) => [
                styles.dateField,
                { borderColor: theme.colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.fieldLabel}>Дата</Text>
              <Text style={styles.fieldValue}>{formatFullDate(startsAt.toISOString())}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Время: ${formatTime(startsAt.toISOString())}`}
              onPress={() => setPicker(picker === 'time' ? null : 'time')}
              style={({ pressed }) => [
                styles.timeField,
                { borderColor: theme.colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.fieldLabel}>Время</Text>
              <Text style={styles.fieldValue}>{formatTime(startsAt.toISOString())}</Text>
            </Pressable>
          </View>

          {picker ? (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={startsAt}
                mode={picker}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                is24Hour
                onChange={onPickerChange}
                themeVariant={theme.scheme}
              />
              {Platform.OS === 'ios' ? (
                <Button title="Готово" size="sm" variant="secondary" onPress={() => setPicker(null)} />
              ) : null}
            </View>
          ) : null}

          <Text style={styles.label}>Длительность</Text>
          <View style={styles.chips}>
            {DURATIONS.map((minutes) => {
              const active = minutes === duration
              return (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setDuration(minutes)}
                  style={[
                    styles.chip,
                    styles.durationChip,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.card,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, active && { color: theme.colors.primary }]}>{minutes} мин</Text>
                </Pressable>
              )
            })}
          </View>

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <TextArea
                label="Описание (необязательно)"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                placeholder="Что разберём на занятии"
                minHeight={80}
                maxLength={2000}
              />
            )}
          />

          {formError ? <Text style={styles.error}>{formError}</Text> : null}
        </ScrollView>
      </BottomSheet>
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    form: { gap: spacing.sm, paddingBottom: spacing.sm },
    label: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted, marginTop: spacing.xs },
    hint: { fontSize: typography.caption, color: c.textMuted, lineHeight: 19 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      maxWidth: '100%',
    },
    durationChip: { minWidth: 74, alignItems: 'center' },
    chipText: { fontSize: typography.caption, fontWeight: '600', color: c.text },
    dateRow: { flexDirection: 'row', gap: spacing.sm },
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
    pickerWrap: { alignItems: 'center' },
    error: { fontSize: typography.caption, color: c.danger, marginTop: spacing.xs },
    pressed: { opacity: 0.8 },
  })
