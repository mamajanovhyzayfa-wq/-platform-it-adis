import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Badge, Button, Card, EmptyState } from './ui'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatRange, canJoin } from '@/utils/format'
import type { HomeworkItem, ScheduleItem } from '@/api/api'

const scheduleTone: Record<ScheduleItem['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'primary'> = {
  SCHEDULED: 'primary',
  ONGOING: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  RESCHEDULED: 'warning',
}

const scheduleLabel: Record<ScheduleItem['status'], string> = {
  SCHEDULED: 'Запланировано',
  ONGOING: 'Идёт сейчас',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  RESCHEDULED: 'Перенесено',
}

export function ScheduleList({ items, alwaysEnabled = false }: { items: ScheduleItem[]; alwaysEnabled?: boolean }) {
  const styles = useThemedStyles(makeStyles)

  if (items.length === 0) return <EmptyState title="В расписании нет занятий" hint="Новые занятия появятся здесь." />

  return (
    <View style={{ gap: spacing.md }}>
      {items.map((item) => (
        <Card key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Badge label={scheduleLabel[item.status]} tone={scheduleTone[item.status]} />
          </View>
          <Text style={styles.muted}>{item.course.title}</Text>
          <Text style={styles.muted}>{formatRange(item.startsAt, item.endsAt)}</Text>
          <Text style={styles.muted}>Преподаватель: {item.teacher}</Text>
          {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
          <Button
            title={alwaysEnabled || canJoin(item.startsAt, item.endsAt) ? 'Присоединиться' : 'Подключение за 15 минут до начала'}
            variant={alwaysEnabled || canJoin(item.startsAt, item.endsAt) ? 'primary' : 'secondary'}
            disabled={!alwaysEnabled && !canJoin(item.startsAt, item.endsAt)}
            onPress={() => router.push({ pathname: '/video/[scheduleId]', params: { scheduleId: item.id } })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ))}
    </View>
  )
}

const homeworkTone = (status?: string) => {
  if (status === 'REVIEWED') return 'success' as const
  if (status === 'RETURNED') return 'warning' as const
  if (status === 'SUBMITTED') return 'primary' as const
  return 'neutral' as const
}

const homeworkLabel = (status?: string) => {
  if (status === 'REVIEWED') return 'Проверено'
  if (status === 'RETURNED') return 'На доработке'
  if (status === 'SUBMITTED') return 'На проверке'
  return 'К сдаче'
}

export function HomeworkList({ items, onPress }: { items: HomeworkItem[]; onPress?: (item: HomeworkItem) => void }) {
  const styles = useThemedStyles(makeStyles)

  if (items.length === 0) return <EmptyState title="Заданий пока нет" hint="Преподаватель ещё не выдал задания." />

  return (
    <View style={{ gap: spacing.md }}>
      {items.map((item) => (
        <Card
          key={item.id}
          onPress={onPress ? () => onPress(item) : undefined}
          accessibilityLabel={`Задание ${item.title}`}
        >
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Badge label={homeworkLabel(item.submission?.status)} tone={homeworkTone(item.submission?.status)} />
          </View>
          <Text style={styles.muted}>{item.course.title}</Text>
          <Text style={styles.muted}>Сдать до {formatRange(item.dueAt, item.dueAt)}</Text>
          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>
          <Text style={styles.muted}>
            Максимум баллов: {item.maxScore}
            {item.submission?.score != null ? ` · Оценка: ${item.submission.score}` : ''}
          </Text>
          <Text style={styles.action}>{item.submission ? 'Открыть работу →' : 'Сдать решение →'}</Text>
        </Card>
      ))}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    cardTitle: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
    muted: { fontSize: typography.body, color: c.textMuted, marginTop: spacing.xs },
    description: { fontSize: typography.body, color: c.text, marginTop: spacing.sm },
    action: { fontSize: typography.caption, fontWeight: '700', color: c.primary, marginTop: spacing.sm },
  })
