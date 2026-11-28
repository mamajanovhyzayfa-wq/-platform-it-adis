import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Badge, Card, Skeleton, type BadgeTone } from './ui'
import { ProgressBar } from './progress'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import type { CourseCategoryRef, CourseLevel } from '@/api/api'

export const levelLabels: Record<CourseLevel, string> = {
  BEGINNER: 'Начальный',
  INTERMEDIATE: 'Средний',
  ADVANCED: 'Продвинутый',
}

export const levelTones: Record<CourseLevel, BadgeTone> = {
  BEGINNER: 'success',
  INTERMEDIATE: 'primary',
  ADVANCED: 'warning',
}

/** «45 мин», «2 ч 10 мин» — без секунд и лишних знаков. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (hours === 0) return `${rest} мин`
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}

export function pluralLessons(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} урок`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} урока`
  return `${count} уроков`
}

interface CourseCardProps {
  title: string
  description?: string | null
  teacher: string
  level: CourseLevel
  category: CourseCategoryRef | null
  lessonsCount: number
  durationMinutes: number
  studentsCount?: number
  /** Задан, если ученик записан: карточка показывает прогресс. */
  progress?: number
  onPress: () => void
  footer?: ReactNode
}

/**
 * Единая карточка курса для каталога и списка «мои курсы».
 * Не знает, откуда пришли данные, поэтому не дублируется на экранах.
 */
export function CourseCard({
  title,
  description,
  teacher,
  level,
  category,
  lessonsCount,
  durationMinutes,
  studentsCount,
  progress,
  onPress,
  footer,
}: CourseCardProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  return (
    <Card onPress={onPress} accessibilityLabel={`Курс ${title}`}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]} accessibilityElementsHidden>
          <Text style={styles.iconText}>{category?.icon ?? '📘'}</Text>
        </View>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {category?.title ?? 'Курс'} · {teacher}
          </Text>
        </View>
      </View>

      {description ? (
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      ) : null}

      <View style={styles.badges}>
        <Badge label={levelLabels[level]} tone={levelTones[level]} />
        <Badge label={pluralLessons(lessonsCount)} tone="neutral" />
        {durationMinutes > 0 ? <Badge label={formatDuration(durationMinutes)} tone="neutral" /> : null}
        {studentsCount != null && studentsCount > 0 ? (
          <Badge label={`${studentsCount} 👥`} tone="neutral" />
        ) : null}
      </View>

      {progress != null ? <ProgressBar value={progress} /> : null}
      {footer}
    </Card>
  )
}

function CourseCardSkeleton() {
  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Skeleton width={48} height={48} borderRadius={radius.md} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton width="80%" height={18} />
            <Skeleton width="55%" height={12} />
          </View>
        </View>
        <Skeleton lines={2} height={12} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Skeleton width={84} height={20} borderRadius={radius.pill} />
          <Skeleton width={70} height={20} borderRadius={radius.pill} />
        </View>
      </View>
    </Card>
  )
}

export function CourseListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }).map((_, index) => (
        <CourseCardSkeleton key={index} />
      ))}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    iconText: { fontSize: 24 },
    head: { flex: 1, gap: 2 },
    title: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    meta: { fontSize: typography.caption, color: c.textMuted },
    description: { fontSize: typography.body, color: c.textMuted, marginTop: spacing.sm, lineHeight: 20 },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  })
