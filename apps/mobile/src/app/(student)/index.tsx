import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton } from '@/components/ui'
import { ProgressBar } from '@/components/progress'
import { CourseCard, formatDuration, pluralLessons } from '@/components/learning'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { canJoin, formatRange, formatTime } from '@/utils/format'

export default function StudentHome() {
  const router = useRouter()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { t } = useI18n()
  const user = useAuthStore((state) => state.user)

  const overview = useQuery({ queryKey: ['learning-overview'], queryFn: api.courseOverview })
  // Отдельный ключ от бесконечного списка уведомлений: здесь нужен только счётчик.
  const notifications = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.notifications({ limit: 5 }),
  })
  const unread = notifications.data?.unread ?? 0

  if (overview.isLoading) return <HomeSkeleton />

  if (overview.isError) {
    return (
      <Screen refreshing={overview.isRefetching} onRefresh={() => void overview.refetch()}>
        <ErrorState
          title="Не удалось загрузить обучение"
          message={describeApiError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      </Screen>
    )
  }

  const data = overview.data
  if (!data) return <HomeSkeleton />

  const nextClass = data.nextClass
  const canJoinNow = nextClass ? canJoin(nextClass.startsAt, nextClass.endsAt) : false
  const today = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <Screen
      refreshing={overview.isRefetching}
      onRefresh={() => {
        void overview.refetch()
        void notifications.refetch()
      }}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.hi} accessibilityRole="header">
            {t('home.greeting')}, {user?.firstName ?? 'ученик'} 👋
          </Text>
          <Text style={styles.muted}>{today}</Text>
        </View>
        <Button
          title={unread > 0 ? `🔔 ${unread > 99 ? '99+' : unread}` : '🔔'}
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={() => router.push('/notifications')}
          accessibilityHint={t('home.notifications')}
        />
      </View>

      <View style={styles.topRow}>
        <Card
          style={[styles.coinCard, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentSoft }]}
          onPress={() => router.push('/coins')}
          accessibilityLabel="Баланс и история IT Coins"
        >
          <Text style={styles.coinLabel}>IT Coins</Text>
          <Text style={[styles.coinValue, { color: theme.colors.success }]}>{data.coinBalance}</Text>
          <Text style={styles.coinHint}>История и баланс →</Text>
        </Card>

        <Card style={styles.progressCard}>
          <View style={styles.progressHead}>
            <Text style={styles.cardTitle}>Прогресс</Text>
            <Text style={[styles.progressValue, { color: theme.colors.primary }]}>{data.overallProgress}%</Text>
          </View>
          <ProgressBar value={data.overallProgress} caption={false} height={10} />
          <Text style={styles.muted}>
            {data.completedLessons} из {data.totalLessons} уроков · {pluralLessons(data.totalLessons)}
          </Text>
        </Card>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('home.nextLesson')}</Text>
        {nextClass ? <Badge label={nextClass.status === 'ONGOING' ? 'Идёт сейчас' : 'Запланировано'} tone={nextClass.status === 'ONGOING' ? 'success' : 'primary'} /> : null}
      </View>

      {nextClass ? (
        <Card>
          <Text style={styles.cardTitle}>{nextClass.title}</Text>
          <Text style={styles.muted}>{nextClass.course.title}</Text>
          <Text style={styles.classTime}>
            {formatRange(nextClass.startsAt, nextClass.endsAt)} · {nextClass.timezone.replace('_', ' ')}
          </Text>
          {nextClass.teacher ? <Text style={styles.muted}>Преподаватель: {nextClass.teacher}</Text> : null}
          <View style={styles.actions}>
            <Button
              title={canJoinNow ? t('home.join') : 'К расписанию'}
              variant={canJoinNow ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
              onPress={() =>
                canJoinNow
                  ? router.push({ pathname: '/video/[scheduleId]', params: { scheduleId: nextClass.id } })
                  : router.push('/(student)/schedule')
              }
            />
            <Button
              title="Расписание"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => router.push('/(student)/schedule')}
          />
          </View>
          {!canJoinNow ? (
            <Text style={styles.hint}>
              Подключение откроется за 15 минут до начала · {formatTime(nextClass.startsAt)}
            </Text>
          ) : null}
        </Card>
      ) : (
        <EmptyState title={t('home.noLessons')} hint="Новые занятия появятся в расписании автоматически." />
      )}

      <Text style={styles.sectionTitle}>{t('home.continue')}</Text>
      {data.continueLearning ? (
        <Card>
          <Text style={styles.cardTitle}>{data.continueLearning.courseTitle}</Text>
          {data.continueLearning.lessonTitle ? (
            <Text style={styles.muted}>
              {data.continueLearning.moduleTitle} · {data.continueLearning.lessonTitle}
            </Text>
          ) : null}
          <ProgressBar value={data.continueLearning.progress} />
          <View style={styles.actions}>
            <Button
              title="Продолжить урок"
              style={{ flex: 1 }}
              disabled={!data.continueLearning.lessonId}
              onPress={() =>
                data.continueLearning?.lessonId
                  ? router.push({ pathname: '/lesson/[id]', params: { id: data.continueLearning.lessonId } })
                  : undefined
              }
            />
            <Button
              title="Курс"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() =>
                router.push({ pathname: '/course/[id]', params: { id: data.continueLearning?.courseId ?? '' } })
              }
            />
          </View>
        </Card>
      ) : (
        <EmptyState title={t('courses.empty')} hint="Выберите курс в каталоге и начните обучение." />
      )}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('home.activeCourses')}</Text>
        <Text style={styles.link} onPress={() => router.push('/(student)/courses')}>
          Каталог →
        </Text>
      </View>

      {data.activeCourses.length === 0 ? (
        <EmptyState title={t('courses.empty')} hint="Запишитесь на курс в каталоге." />
      ) : (
        <View style={styles.courseList}>
          {data.activeCourses.map((item) => (
            <CourseCard
              key={item.enrollmentId}
              title={item.course.title}
              description={item.course.description}
              teacher={item.course.teacher.name}
              level={item.course.level}
              category={item.course.category}
              lessonsCount={item.lessonsCount}
              durationMinutes={item.course.durationMinutes}
              progress={item.progress}
              onPress={() => router.push({ pathname: '/course/[id]', params: { id: item.course.id } })}
              footer={
                item.nextLesson ? (
                  <Text style={styles.nextLink}>
                    Следующий урок: {item.nextLesson.title} · {formatDuration(item.nextLesson.durationMinutes)}
                  </Text>
                ) : (
                  <Text style={styles.nextLink}>Курс завершён 🎉</Text>
                )
              }
            />
          ))}
        </View>
      )}
    </Screen>
  )
}

function HomeSkeleton() {
  const styles = useThemedStyles(makeStyles)
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Skeleton width="65%" height={26} />
          <Skeleton width="45%" height={13} style={{ marginTop: spacing.sm }} />
        </View>
        <Skeleton width={44} height={40} borderRadius={radius.md} />
      </View>
      <View style={styles.topRow}>
        <Card style={styles.coinCard}>
          <Skeleton width="55%" height={12} />
          <Skeleton width="70%" height={30} style={{ marginTop: spacing.sm }} />
          <Skeleton width="80%" height={11} style={{ marginTop: spacing.sm }} />
        </Card>
        <Card style={styles.progressCard}>
          <Skeleton width="50%" height={14} />
          <Skeleton height={10} borderRadius={5} style={{ marginTop: spacing.md }} />
          <Skeleton width="60%" height={11} style={{ marginTop: spacing.sm }} />
        </Card>
      </View>
      <Skeleton width="40%" height={20} style={{ marginTop: spacing.md }} />
      <Card>
        <Skeleton width="70%" height={18} />
        <Skeleton width="50%" height={12} style={{ marginTop: spacing.sm }} />
        <Skeleton width="85%" height={12} style={{ marginTop: spacing.sm }} />
        <Skeleton height={44} borderRadius={radius.md} style={{ marginTop: spacing.lg }} />
      </Card>
      <Skeleton width="45%" height={20} style={{ marginTop: spacing.md }} />
      <Card>
        <Skeleton width="75%" height={18} />
        <Skeleton width="55%" height={12} style={{ marginTop: spacing.sm }} />
        <Skeleton height={8} borderRadius={4} style={{ marginTop: spacing.lg }} />
      </Card>
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
    headerText: { flex: 1 },
    hi: { fontSize: typography.title, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    topRow: { flexDirection: 'row', gap: spacing.sm },
    coinCard: { flex: 1, justifyContent: 'space-between' },
    coinLabel: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' },
    coinValue: { fontSize: 30, fontWeight: '800', marginTop: spacing.xs },
    coinHint: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.sm },
    progressCard: { flex: 1.35, justifyContent: 'space-between' },
    progressHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    progressValue: { fontSize: 24, fontWeight: '800' },
    cardTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginTop: spacing.md },
    link: { fontSize: typography.caption, fontWeight: '700', color: c.primary },
    classTime: { fontSize: typography.body, color: c.primary, marginTop: spacing.sm, fontWeight: '600' },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    hint: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.sm },
    courseList: { gap: spacing.md },
    nextLink: { fontSize: typography.caption, color: c.primary, marginTop: spacing.md, fontWeight: '600' },
  })
