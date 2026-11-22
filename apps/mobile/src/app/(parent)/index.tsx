import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Loader,
  ProgressBar,
  Screen,
} from '@/components/ui'
import { api, type ParentChild } from '@/api/api'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { formatDate, formatTime } from '@/utils/format'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const relationLabels = (t: ReturnType<typeof useI18n>['t']): Record<ParentChild['relation'], string> => ({
  MOTHER: t('parent.relation.MOTHER'),
  FATHER: t('parent.relation.FATHER'),
  GUARDIAN: t('parent.relation.GUARDIAN'),
  OTHER: t('parent.relation.OTHER'),
})

/** Кабинет родителя: только подтверждённые дети, их учёба, задания и платежи. */
export default function ParentHome() {
  const { t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const dashboard = useQuery({ queryKey: ['parent-dashboard'], queryFn: api.parentDashboard })

  if (dashboard.isLoading) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    )
  }

  if (dashboard.isError) {
    return (
      <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
        <ErrorState
          title={t('parent.loadError')}
          message={t('parent.noChildrenHint')}
          onRetry={() => void dashboard.refetch()}
        />
      </Screen>
    )
  }

  const data = dashboard.data
  if (!data) return null
  const relations = relationLabels(t)

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('parent.dashboardTitle')}</Text>
          <Text style={styles.muted}>
            {user?.firstName} {user?.lastName} · {t('parent.dashboardSubtitle')}
          </Text>
        </View>
        <IconButton icon="🔔" accessibilityLabel={t('home.notifications')} onPress={() => router.push('/notifications')} />
      </View>

      <Text style={styles.sectionTitle}>{t('parent.childrenTitle')}</Text>
      {data.children.length === 0 ? (
        <EmptyState title={t('parent.noChildren')} hint={t('parent.noChildrenHint')} icon="👨‍👩‍👧" />
      ) : null}

      {data.children.map((child) => (
        <View key={child.id} style={styles.childBlock}>
          <Card>
            <View style={styles.rowBetween}>
              <View style={styles.childTitle}>
                <Text style={styles.childName}>{child.name}</Text>
                <Text style={styles.muted}>{child.email}</Text>
              </View>
              <Badge label={relations[child.relation]} tone="primary" />
            </View>
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{child.coins}</Text>
                <Text style={styles.statLabel}>{t('parent.coins')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{Math.round(child.attendanceRate)}%</Text>
                <Text style={styles.statLabel}>{t('parent.attendance')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{new Intl.NumberFormat('ru-RU').format(child.paidTotalKgs)}</Text>
                <Text style={styles.statLabel}>{t('parent.paid')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{child.achievements}</Text>
                <Text style={styles.statLabel}>{t('parent.achievements')}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('parent.courses')}</Text>
            {child.courses.length === 0 ? (
              <Text style={styles.muted}>{t('parent.noCourses')}</Text>
            ) : (
              child.courses.map((course) => (
                <View key={course.id} style={styles.courseRow}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemTitle}>{course.title}</Text>
                    <Text style={styles.percent}>{Math.round(course.progress)}%</Text>
                  </View>
                  <ProgressBar
                    value={course.progress}
                    showLabel={false}
                    height={7}
                    accessibilityLabel={`${t('courses.progress')}: ${course.title}`}
                  />
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('parent.upcoming')}</Text>
            {child.upcoming.length === 0 ? (
              <Text style={styles.muted}>{t('parent.noUpcoming')}</Text>
            ) : (
              child.upcoming.map((lesson) => (
                <View key={lesson.id} style={styles.listRow}>
                  <Text style={styles.itemTitle}>{lesson.title}</Text>
                  <Text style={styles.muted}>
                    {formatDate(lesson.startsAt)}, {formatTime(lesson.startsAt)}
                  </Text>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('parent.homework')}</Text>
            {child.homework.length === 0 ? (
              <Text style={styles.muted}>{t('parent.noHomework')}</Text>
            ) : (
              child.homework.map((item) => (
                <View key={item.id} style={styles.listRow}>
                  <View style={styles.itemGrow}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.muted}>{item.course}</Text>
                  </View>
                  <Text style={styles.due}>{formatDate(item.dueAt)}</Text>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('parent.results')}</Text>
            {child.results.length === 0 ? (
              <Text style={styles.muted}>{t('parent.noResults')}</Text>
            ) : (
              child.results.map((item) => (
                <View key={item.id} style={styles.listRow}>
                  <View style={styles.itemGrow}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    {item.submittedAt ? <Text style={styles.muted}>{formatDate(item.submittedAt)}</Text> : null}
                  </View>
                  <Badge
                    label={item.percent !== null ? `${Math.round(item.percent)}%` : item.score !== null ? String(item.score) : '—'}
                    tone={item.percent !== null && item.percent < 60 ? 'warning' : 'success'}
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      ))}

      <Text style={styles.sectionTitle}>{t('parent.notifications')}</Text>
      {data.notifications.items.length === 0 ? (
        <EmptyState title={t('parent.noNotifications')} hint={t('notifications.emptyHint')} icon="🔔" />
      ) : (
        data.notifications.items.map((item) => (
          <Card key={item.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {!item.readAt ? <Badge label={t('notifications.unread')} tone="primary" /> : null}
            </View>
            <Text style={styles.muted}>{item.body}</Text>
            <Text style={styles.time}>{formatDate(item.createdAt)}</Text>
          </Card>
        ))
      )}

      <Button title={t('profile.logout')} variant="danger" onPress={() => void logout()} style={styles.action} />
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    headerText: { flex: 1 },
    title: { fontSize: typography.title, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: 2 },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginTop: spacing.md },
    childBlock: { gap: spacing.sm, marginTop: spacing.sm },
    childTitle: { flex: 1 },
    childName: { fontSize: typography.h1, fontWeight: '800', color: c.text },
    rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    statBox: {
      flexBasis: '45%',
      flexGrow: 1,
      padding: spacing.sm,
      borderRadius: 14,
      backgroundColor: c.cardMuted,
    },
    statValue: { fontSize: 20, fontWeight: '800', color: c.primary },
    statLabel: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    cardTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginBottom: spacing.sm },
    courseRow: { gap: spacing.xs, marginBottom: spacing.sm },
    itemTitle: { flex: 1, fontSize: typography.body, fontWeight: '600', color: c.text },
    itemGrow: { flex: 1 },
    percent: { fontSize: typography.caption, fontWeight: '700', color: c.primary },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    due: { fontSize: typography.tiny, color: c.textMuted },
    time: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xs },
    action: { marginTop: spacing.sm },
  })
