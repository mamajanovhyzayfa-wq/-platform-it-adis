import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Badge, Button, Card, EmptyState, IconButton } from './ui'
import type { BadgeTone } from './ui'
import type { ScheduleItem } from '@/api/api'
import { canJoin, formatRange, formatTime } from '@/utils/format'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

export type CalendarMode = 'day' | 'week' | 'month'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/** Локальная полночь — сравнения дней делаются по календарю пользователя. */
export function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  return next
}

/** Неделя начинается с понедельника. */
export function startOfWeek(date: Date): Date {
  const base = startOfDay(date)
  const weekday = (base.getDay() + 6) % 7
  return addDays(base, -weekday)
}

/** 42 ячейки сетки месяца: всегда шесть строк, без «прыжков» высоты. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

/** Период запроса к серверу: ровно то, что видно на календаре. */
export function calendarRange(mode: CalendarMode, anchor: Date): { from: Date; to: Date } {
  if (mode === 'day') {
    const from = startOfDay(anchor)
    return { from, to: addDays(from, 1) }
  }
  if (mode === 'week') {
    const from = startOfWeek(anchor)
    return { from, to: addDays(from, 7) }
  }
  const grid = monthGrid(anchor)
  return { from: grid[0] as Date, to: addDays(grid[grid.length - 1] as Date, 1) }
}

export function sameDay(left: Date | string, right: Date | string): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

function dayLabel(date: Date): string {
  return `${WEEKDAYS_FULL[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS[date.getMonth()].toLowerCase()}`
}

const statusTone: Record<ScheduleItem['status'], BadgeTone> = {
  SCHEDULED: 'primary',
  ONGOING: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  RESCHEDULED: 'warning',
}

const statusLabel: Record<ScheduleItem['status'], string> = {
  SCHEDULED: 'Запланировано',
  ONGOING: 'Идёт сейчас',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  RESCHEDULED: 'Перенесено',
}

export interface ScheduleCalendarProps {
  items: ScheduleItem[]
  mode: CalendarMode
  anchor: Date
  selected: Date
  onChangeMode: (mode: CalendarMode) => void
  onShift: (direction: -1 | 1) => void
  onToday: () => void
  onSelect: (date: Date) => void
}

/**
 * Календарь занятий: переключатель день/неделя/месяц, сетка месяца и повестка дня.
 * Компонент не загружает данные — экран держит период и передаёт занятия.
 */
export function ScheduleCalendar({
  items,
  mode,
  anchor,
  selected,
  onChangeMode,
  onShift,
  onToday,
  onSelect,
}: ScheduleCalendarProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()

  const dayItems = useMemo(() => items.filter((item) => sameDay(item.startsAt, selected)), [items, selected])
  const modes: Array<{ key: CalendarMode; label: string }> = [
    { key: 'day', label: 'День' },
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
  ]

  const title =
    mode === 'month'
      ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
      : mode === 'week'
        ? `${formatDayShort(startOfWeek(anchor))} — ${formatDayShort(addDays(startOfWeek(anchor), 6))}`
        : formatDayShort(selected)

  return (
    <>
      <View style={styles.toolbar}>
        <View style={styles.modes}>
          {modes.map((item) => {
            const active = item.key === mode
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onChangeMode(item.key)}
                style={[
                  styles.mode,
                  { borderColor: active ? theme.colors.primary : theme.colors.border },
                  active && { backgroundColor: theme.colors.primarySoft },
                ]}
              >
                <Text style={[styles.modeText, active && { color: theme.colors.primary }]}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={styles.periodRow}>
          <IconButton icon="‹" accessibilityLabel="Предыдущий период" onPress={() => onShift(-1)} />
          <Text style={styles.period} numberOfLines={1}>
            {title}
          </Text>
          <IconButton icon="›" accessibilityLabel="Следующий период" onPress={() => onShift(1)} />
          <Pressable accessibilityRole="button" onPress={onToday} style={styles.todayButton}>
            <Text style={[styles.todayText, { color: theme.colors.primary }]}>Сегодня</Text>
          </Pressable>
        </View>
      </View>

      {mode === 'month' ? (
        <MonthGrid anchor={anchor} selected={selected} items={items} onSelect={onSelect} />
      ) : null}

      {mode === 'week' ? (
        <View style={styles.week}>
          {Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)).map((date) => {
            const active = sameDay(date, selected)
            const hasItems = items.some((item) => sameDay(item.startsAt, date))
            const isToday = sameDay(date, new Date())
            return (
              <Pressable
                key={date.toISOString()}
                accessibilityRole="button"
                accessibilityLabel={dayLabel(date)}
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(date)}
                style={[
                  styles.weekDay,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.card,
                  },
                ]}
              >
                <Text style={[styles.weekDayName, isToday && { color: theme.colors.primary }]}>
                  {WEEKDAYS[(date.getDay() + 6) % 7]}
                </Text>
                <Text style={[styles.weekDayNumber, active && { color: theme.colors.primary }]}>{date.getDate()}</Text>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: hasItems ? theme.colors.primary : 'transparent' },
                  ]}
                />
              </Pressable>
            )
          })}
        </View>
      ) : null}

      <View style={styles.agendaHead}>
        <Text style={styles.agendaTitle}>{mode === 'day' ? 'Занятия' : dayLabel(selected)}</Text>
        {dayItems.length > 0 ? <Badge label={`${dayItems.length}`} tone="primary" /> : null}
      </View>

      {dayItems.length === 0 ? (
        <EmptyState title="В этот день занятий нет" hint="Выберите другой день или создайте занятие." icon="🗓" />
      ) : (
        <View style={{ gap: spacing.md }}>
          {dayItems.map((item) => (
            <LessonCard key={item.id} item={item} />
          ))}
        </View>
      )}

      <Text style={styles.timezoneNote}>Время указано по часовому поясу устройства.</Text>
    </>
  )
}

function formatDayShort(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()].toLowerCase().slice(0, 3)}`
}

function MonthGrid({
  anchor,
  selected,
  items,
  onSelect,
}: {
  anchor: Date
  selected: Date
  items: ScheduleItem[]
  onSelect: (date: Date) => void
}) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const grid = useMemo(() => monthGrid(anchor), [anchor])
  const today = new Date()

  return (
    <Card padded={false} style={styles.month}>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {grid.map((date) => {
          const inMonth = date.getMonth() === anchor.getMonth()
          const active = sameDay(date, selected)
          const isToday = sameDay(date, today)
          const count = items.filter((item) => sameDay(item.startsAt, date)).length
          return (
            <Pressable
              key={date.toISOString()}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(date)}${count > 0 ? `, занятий: ${count}` : ''}`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(date)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.cellCircle,
                  active && { backgroundColor: theme.colors.primary },
                  !active && isToday && { borderColor: theme.colors.primary, borderWidth: 1 },
                ]}
              >
                <Text
                  style={[
                    styles.cellText,
                    !inMonth && { color: theme.colors.textMuted, opacity: 0.5 },
                    active && { color: theme.colors.white, fontWeight: '800' },
                  ]}
                >
                  {date.getDate()}
                </Text>
              </View>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: count > 0 && !active ? theme.colors.primary : 'transparent',
                  },
                ]}
              />
            </Pressable>
          )
        })}
      </View>
    </Card>
  )
}

/** Карточка занятия: время, курс, статус и подключение в окне занятия. */
export function LessonCard({ item }: { item: ScheduleItem }) {
  const styles = useThemedStyles(makeStyles)
  const joinable = item.status !== 'CANCELLED' && canJoin(item.startsAt, item.endsAt)

  return (
    <Card>
      <View style={styles.cardHead}>
        <View style={styles.timeBox}>
          <Text style={styles.timeStart}>{formatTime(item.startsAt)}</Text>
          <Text style={styles.timeEnd}>{formatTime(item.endsAt)}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.course.title}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.teacher}
          </Text>
        </View>
        <Badge label={statusLabel[item.status]} tone={statusTone[item.status]} />
      </View>

      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      <Text style={styles.range}>{formatRange(item.startsAt, item.endsAt)}</Text>

      {item.status !== 'CANCELLED' ? (
        <Button
          title={joinable ? 'Присоединиться' : 'Подключение за 15 минут до начала'}
          variant={joinable ? 'primary' : 'secondary'}
          disabled={!joinable}
          onPress={() => router.push({ pathname: '/video/[scheduleId]', params: { scheduleId: item.id } })}
          style={{ marginTop: spacing.md }}
        />
      ) : null}
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    toolbar: { gap: spacing.sm },
    modes: { flexDirection: 'row', gap: spacing.xs },
    mode: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    modeText: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted },
    periodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    period: { flex: 1, textAlign: 'center', fontSize: typography.body, fontWeight: '700', color: c.text },
    todayButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    todayText: { fontSize: typography.caption, fontWeight: '700' },
    week: { flexDirection: 'row', gap: spacing.xs },
    weekDay: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      gap: 2,
    },
    weekDayName: { fontSize: typography.tiny, fontWeight: '600', color: c.textMuted, textTransform: 'uppercase' },
    weekDayNumber: { fontSize: typography.h2, fontWeight: '700', color: c.text },
    month: { paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
    weekdayRow: { flexDirection: 'row', paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
    weekday: {
      flex: 1,
      textAlign: 'center',
      fontSize: typography.tiny,
      fontWeight: '700',
      color: c.textMuted,
      textTransform: 'uppercase',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.xs },
    cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
    cellCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    cellText: { fontSize: typography.caption, fontWeight: '600', color: c.text },
    dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
    agendaHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    agendaTitle: { flex: 1, fontSize: typography.h2, fontWeight: '800', color: c.text },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    timeBox: { alignItems: 'flex-start', minWidth: 52 },
    timeStart: { fontSize: typography.h2, fontWeight: '800', color: c.primary },
    timeEnd: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    cardBody: { flex: 1, gap: 1 },
    cardTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    muted: { fontSize: typography.caption, color: c.textMuted },
    description: { fontSize: typography.caption, color: c.text, marginTop: spacing.sm, lineHeight: 19 },
    range: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.sm },
    timezoneNote: { fontSize: typography.tiny, color: c.textMuted, textAlign: 'center', marginTop: spacing.sm },
  })
