import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Loader, Screen } from '@/components/ui'
import { api, type LeadItem } from '@/api/api'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { formatDate, formatTime } from '@/utils/format'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const statusLabels = (t: ReturnType<typeof useI18n>['t']): Record<LeadItem['status'], string> => ({
  NEW: t('manager.status.NEW'),
  CONTACTED: t('manager.status.CONTACTED'),
  CONVERTED: t('manager.status.CONVERTED'),
  REJECTED: t('manager.status.REJECTED'),
})

const audienceLabels = (t: ReturnType<typeof useI18n>['t']): Record<LeadItem['audience'], string> => ({
  STUDENT: t('manager.audience.STUDENT'),
  PARENT: t('manager.audience.PARENT'),
  PARTNER: t('manager.audience.PARTNER'),
})

/** Кабинет менеджера: сводка филиала, ближайшие занятия и новые заявки. */
export default function ManagerHome() {
  const { t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)

  const overview = useQuery({ queryKey: ['manager-overview'], queryFn: api.managerOverview })
  const leads = useQuery({ queryKey: ['manager-recent-leads'], queryFn: () => api.leads({ limit: 5 }) })

  if (overview.isLoading) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    )
  }

  if (overview.isError) {
    return (
      <Screen refreshing={overview.isRefetching} onRefresh={() => void overview.refetch()}>
        <ErrorState onRetry={() => void overview.refetch()} />
      </Screen>
    )
  }

  const data = overview.data
  if (!data) return null

  const stats = [
    { label: t('manager.students'), value: data.stats.students },
    { label: t('manager.teachers'), value: data.stats.teachers },
    { label: t('manager.activeCourses'), value: data.stats.activeCourses },
    { label: t('manager.newLeads'), value: data.stats.newLeads },
    { label: t('manager.lessonsToday'), value: data.stats.lessonsToday },
    { label: t('manager.attendanceToday'), value: data.stats.attendanceToday },
  ]
  const statusLabel = statusLabels(t)
  const audienceLabel = audienceLabels(t)

  return (
    <Screen
      refreshing={overview.isRefetching || leads.isRefetching}
      onRefresh={() => {
        void overview.refetch()
        void leads.refetch()
      }}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('manager.dashboardTitle')}</Text>
          <Text style={styles.muted}>
            {user?.firstName} {user?.lastName} · {t('manager.dashboardSubtitle')}
          </Text>
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

      <Text style={styles.sectionTitle}>{t('manager.upcoming')}</Text>
      {data.upcoming.length === 0 ? (
        <EmptyState title={t('home.noLessons')} hint={t('schedule.empty')} icon="📅" />
      ) : (
        data.upcoming.slice(0, 5).map((lesson) => (
          <Card key={lesson.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{lesson.title}</Text>
              <Text style={styles.time}>{formatTime(lesson.startsAt)}</Text>
            </View>
            <Text style={styles.muted}>{lesson.course.title}</Text>
            <Text style={styles.muted}>{formatDate(lesson.startsAt)}</Text>
          </Card>
        ))
      )}

      <Text style={styles.sectionTitle}>{t('manager.recentLeads')}</Text>
      {leads.isLoading ? <Loader label={t('common.loading')} /> : null}
      {leads.isError ? (
        <ErrorState message={t('manager.noLeadsHint')} onRetry={() => void leads.refetch()} />
      ) : null}
      {!leads.isLoading && !leads.isError && (leads.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('manager.noLeads')} hint={t('manager.noLeadsHint')} icon="📝" />
      ) : null}
      {(leads.data?.items ?? []).map((lead) => (
        <Card key={lead.id}>
          <View style={styles.rowBetween}>
            <View style={styles.leadTitle}>
              <Text style={styles.cardTitle}>{lead.name}</Text>
              <Text style={styles.muted}>{lead.phone}</Text>
            </View>
            <Badge label={statusLabel[lead.status]} tone={lead.status === 'NEW' ? 'warning' : lead.status === 'CONVERTED' ? 'success' : 'neutral'} />
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>{audienceLabel[lead.audience]}</Text>
            <Text style={styles.muted}>{formatDate(lead.createdAt)}</Text>
          </View>
        </Card>
      ))}

      <Button
        title={t('manager.studentsTitle')}
        variant="secondary"
        onPress={() => router.push('/(manager)/students')}
        style={styles.action}
      />
      <Button
        title={t('home.notifications')}
        variant="secondary"
        onPress={() => router.push('/notifications')}
        style={styles.action}
      />
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
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    statCard: { flexBasis: '30%', flexGrow: 1, padding: spacing.md },
    statValue: { fontSize: 24, fontWeight: '800', color: c.primary },
    statLabel: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginTop: spacing.md },
    cardTitle: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
    rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    time: { fontSize: typography.body, fontWeight: '700', color: c.primary },
    leadTitle: { flex: 1 },
    action: { marginTop: spacing.sm },
  })
