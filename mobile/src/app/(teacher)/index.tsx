import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Screen, Skeleton } from '@/components/ui'
import { SubmissionRow, TeacherCourseCard } from '@/components/teacher'
import { api } from '@/api/api'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatRange } from '@/utils/format'

export default function TeacherHome() {
  const { t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const router = useRouter()
  const overview = useQuery({ queryKey: ['teacher-overview'], queryFn: api.teacherOverview })
  const styles = useThemedStyles(makeStyles)

  if (overview.isLoading) return <TeacherHomeSkeleton />

  if (overview.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => void overview.refetch()} />
      </Screen>
    )
  }

  const data = overview.data
  if (!data) return null

  const stats = [
    { label: t('teacher.coursesTitle'), value: String(data.stats.courses) },
    { label: t('nav.students'), value: String(data.stats.students) },
    { label: t('teacher.pending'), value: String(data.stats.pendingReviews) },
    { label: t('teacher.avgProgress'), value: `${data.stats.avgProgress}%` },
  ]

  return (
    <Screen refreshing={overview.isRefetching} onRefresh={() => void overview.refetch()}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.hi}>
            {t('home.greeting')}, {user?.firstName ?? ''}
          </Text>
          <Text style={styles.muted}>{t('teacher.homeSubtitle')}</Text>
        </View>
        <IconButton icon="🔔" accessibilityLabel={t('home.notifications')} onPress={() => router.push('/notifications')} />
      </View>

      <View style={styles.statsGrid}>
        {stats.map((item) => (
          <Card key={item.label} style={styles.statCard} padded={false}>
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </Card>
        ))}
      </View>

      <Text style={styles.sectionTitle}>{t('home.nextLesson')}</Text>
      {data.nextClass ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{data.nextClass.title}</Text>
            <Badge
              label={data.nextClass.status === 'ONGOING' ? t('status.ONGOING') : t('status.SCHEDULED')}
              tone={data.nextClass.status === 'ONGOING' ? 'success' : 'primary'}
            />
          </View>
          <Text style={styles.muted}>{data.nextClass.course.title}</Text>
          <Text style={styles.muted}>{formatRange(data.nextClass.startsAt, data.nextClass.endsAt)}</Text>
          <Button
            title={t('home.join')}
            size="sm"
            style={styles.joinButton}
            onPress={() => router.push({ pathname: '/video/[scheduleId]', params: { scheduleId: data.nextClass!.id } })}
          />
        </Card>
      ) : (
        <EmptyState title={t('home.noLessons')} hint={t('schedule.empty')} />
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('teacher.coursesTitle')}</Text>
        <Text style={styles.link} onPress={() => router.push('/(teacher)/courses')}>
          {t('teacher.allCourses')}
        </Text>
      </View>
      {data.courses.length === 0 ? (
        <EmptyState title={t('teacher.noCourses')} hint={t('teacher.noCoursesHint')} icon="📚" />
      ) : (
        data.courses.map((course) => (
          <TeacherCourseCard
            key={course.id}
            course={course}
            onPress={() => router.push({ pathname: '/teacher-course/[id]', params: { id: course.id } })}
          />
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('teacher.reviewTitle')}</Text>
        <Text style={styles.link} onPress={() => router.push('/(teacher)/homework')}>
          {t('home.details')}
        </Text>
      </View>
      {data.recentSubmissions.length === 0 ? (
        <EmptyState title={t('teacher.pendingEmpty')} hint={t('teacher.pendingHint')} icon="✅" />
      ) : (
        data.recentSubmissions.map((item) => (
          <SubmissionRow
            key={item.id}
            item={item}
            onPress={() => router.push({ pathname: '/teacher-submission/[id]', params: { id: item.id } })}
          />
        ))
      )}
    </Screen>
  )
}

function TeacherHomeSkeleton() {
  const styles = useThemedStyles(makeStyles)
  return (
    <Screen>
      <Skeleton width="55%" height={26} />
      <Skeleton width="40%" height={14} />
      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={82} borderRadius={18} style={styles.skeletonStat} />
        ))}
      </View>
      <Skeleton height={110} borderRadius={18} />
      <Skeleton width="45%" height={20} />
      <Skeleton height={130} borderRadius={18} />
      <Skeleton height={130} borderRadius={18} />
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    headerText: { flex: 1 },
    hi: { fontSize: typography.title, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: 2 },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    statCard: { flexBasis: '47%', flexGrow: 1, padding: spacing.md },
    skeletonStat: { flexBasis: '47%', flexGrow: 1 },
    statValue: { fontSize: 26, fontWeight: '800', color: c.primary },
    statLabel: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginTop: spacing.md },
    link: { fontSize: typography.caption, fontWeight: '700', color: c.primary, marginTop: spacing.md },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
    cardTitle: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
    joinButton: { marginTop: spacing.md, alignSelf: 'flex-start', paddingHorizontal: spacing.xl },
  })
