import { StyleSheet, Text, View } from 'react-native'
import { Avatar, Badge, Card, ProgressBar } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import type { TeacherCourse, TeacherSubmission } from '@/api/api'
import { useI18n, type MessageKey } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate } from '@/utils/format'

const STATUS_KEY = {
  SUBMITTED: 'homework.status.SUBMITTED',
  REVIEWED: 'homework.status.REVIEWED',
  RETURNED: 'homework.status.RETURNED',
} as const

const STATUS_TONE: Record<TeacherSubmission['status'], BadgeTone> = {
  SUBMITTED: 'warning',
  REVIEWED: 'success',
  RETURNED: 'danger',
}

/** Подпись статуса курса для бейджа. */
export function courseStatusLabel(status: TeacherCourse['status'], t: (key: MessageKey) => string) {
  if (status === 'DRAFT') return t('teacher.draft')
  return status === 'ACTIVE' ? t('teacher.statusActive') : t('teacher.statusArchived')
}

/** Подпись и цвет статуса работы — общие для очереди и карточки проверки. */
export function useSubmissionStatus() {
  const { t } = useI18n()
  return (status: TeacherSubmission['status']) => ({
    label: t(STATUS_KEY[status]),
    tone: STATUS_TONE[status],
  })
}

/** Карточка курса в кабинете преподавателя. */
export function TeacherCourseCard({ course, onPress }: { course: TeacherCourse; onPress: () => void }) {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)

  return (
    <Card onPress={onPress} accessibilityLabel={`Курс ${course.title}`}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>
          {course.title}
        </Text>
        <Badge label={courseStatusLabel(course.status, t)} tone={course.status === 'DRAFT' ? 'neutral' : 'primary'} />
      </View>
      <Text style={styles.muted}>
        {course.studentsCount} {t('teacher.studentsWord')} · {course.lessonsCount} {t('teacher.lessonsWord')}
      </Text>
      {course.pendingReviews > 0 ? (
        <Badge label={`${t('teacher.pending')}: ${course.pendingReviews}`} tone="warning" style={styles.pending} />
      ) : null}
      <View style={styles.progress}>
        <ProgressBar value={course.avgProgress} showLabel={false} height={6} />
        <Text style={styles.progressText}>{course.avgProgress}%</Text>
      </View>
    </Card>
  )
}

/** Строка работы ученика: используется на главной и в очереди проверки. */
export function SubmissionRow({ item, onPress }: { item: TeacherSubmission; onPress: () => void }) {
  const { t } = useI18n()
  const status = useSubmissionStatus()(item.status)
  const styles = useThemedStyles(makeStyles)

  return (
    <Card onPress={onPress} accessibilityLabel={`Работа ${item.student.name}`}>
      <View style={styles.row}>
        <Avatar firstName={item.student.firstName} lastName={item.student.lastName} uri={item.student.avatarUrl} size={40} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.student.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.homework.title} · {item.homework.course.title}
          </Text>
          <Text style={styles.meta}>
            {formatFullDate(item.submittedAt)} · {t('teacher.attempt')} {item.attempt}
            {item.score !== null ? ` · ${item.score}/${item.homework.maxScore}` : ''}
          </Text>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </View>
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    title: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    pending: { marginTop: spacing.sm },
    progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    progressText: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    meta: { fontSize: typography.tiny, color: c.textMuted },
  })
