import { Linking, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, ErrorState, Loader, Screen } from '@/components/ui'
import { api } from '@/api/api'
import { API_URL } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import { formatDate } from '@/utils/format'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

/**
 * Мобильная сводка администратора.
 *
 * Полная панель управления остаётся веб-приложением: на телефоне показываем
 * ключевые показатели филиала и даём переход в /admin. Данные берутся из того же
 * API, что и веб-панель, поэтому цифры не дублируются и не расходятся.
 */
export default function AdminHome() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const styles = useThemedStyles(makeStyles)
  const dashboard = useQuery({ queryKey: ['admin-dashboard'], queryFn: api.adminDashboard })

  const docsUrl = API_URL.replace(/\/api\/?$/, '/docs')
  const webBase = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/+$/, '')
  const webAdminUrl = webBase ? `${webBase}/admin` : null

  if (dashboard.isLoading) {
    return (
      <Screen>
        <Loader />
      </Screen>
    )
  }

  if (dashboard.isError) {
    return (
      <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
        <ErrorState onRetry={() => void dashboard.refetch()} />
      </Screen>
    )
  }

  const data = dashboard.data
  if (!data) return null

  const stats = [
    { label: 'Всего пользователей', value: data.users.total },
    { label: 'Учеников', value: data.users.students },
    { label: 'Родителей', value: data.users.parents },
    { label: 'Менеджеров', value: data.users.managers },
    { label: 'Преподавателей', value: data.users.teachers },
    { label: 'Активных курсов', value: data.courses.active },
    { label: 'Занятий впереди', value: data.upcomingLessons },
    { label: 'Новых за 7 дней', value: data.activity.newUsers },
  ]

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {user?.firstName} {user?.lastName}
          </Text>
          <Text style={styles.muted}>Администратор платформы</Text>
        </View>
        <Badge label="ADMIN" tone="primary" />
      </View>

      <View style={styles.statsGrid}>
        {stats.map((item) => (
          <Card key={item.label} style={styles.stat} padded={false}>
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </Card>
        ))}
      </View>

      <Card>
        <Text style={styles.cardTitle}>Состояние филиала</Text>
        <View style={styles.healthRow}>
          <Text style={styles.muted}>Черновиков курсов</Text>
          <Text style={styles.healthValue}>{data.courses.draft}</Text>
        </View>
        <View style={styles.healthRow}>
          <Text style={styles.muted}>Завершённых зачислений</Text>
          <Text style={styles.healthValue}>{data.courses.completedEnrollments}</Text>
        </View>
        <View style={styles.healthRow}>
          <Text style={styles.muted}>Домашних заданий</Text>
          <Text style={styles.healthValue}>{data.homeworkTotal}</Text>
        </View>
        <View style={styles.healthRow}>
          <Text style={styles.muted}>Активны за 7 дней</Text>
          <Text style={styles.healthValue}>{data.activity.activeLastWeek}</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Последние действия</Text>
        {data.recentAudit.length === 0 ? (
          <Text style={styles.muted}>Журнал пока пуст.</Text>
        ) : (
          data.recentAudit.map((item) => (
            <View key={item.id} style={styles.auditRow}>
              <View style={styles.auditText}>
                <Text style={styles.auditAction}>{item.action}</Text>
                <Text style={styles.muted}>
                  {item.actor} · {item.entity}
                </Text>
              </View>
              <Text style={styles.auditDate}>{formatDate(item.createdAt)}</Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Полная панель</Text>
        <Text style={styles.muted}>
          Пользователи и роли, курсы, расписание, финансы, аналитика, интеграции, резервные копии и аудит доступны в
          веб-панели. Мобильный экран показывает оперативную сводку и не заменяет рабочие места администратора.
        </Text>
        {webAdminUrl ? (
          <Button
            title="Открыть веб-панель"
            variant="secondary"
            style={styles.action}
            onPress={() => void Linking.openURL(webAdminUrl)}
          />
        ) : (
          <Text style={[styles.muted, styles.action]}>
            Задайте `EXPO_PUBLIC_WEB_URL`, чтобы открывать веб-панель с телефона.
          </Text>
        )}
        <Button title="Открыть Swagger" variant="secondary" style={styles.action} onPress={() => void Linking.openURL(docsUrl)} />
      </Card>

      <Button title="Выйти" variant="danger" onPress={() => void logout()} style={styles.action} />
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
    stat: { flexBasis: '45%', flexGrow: 1, padding: spacing.md },
    statValue: { fontSize: 24, fontWeight: '800', color: c.primary },
    statLabel: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    cardTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginBottom: spacing.sm },
    healthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    healthValue: { fontSize: typography.body, fontWeight: '700', color: c.text },
    auditRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    auditText: { flex: 1 },
    auditAction: { fontSize: typography.body, fontWeight: '600', color: c.text },
    auditDate: { fontSize: typography.tiny, color: c.textMuted },
    action: { marginTop: spacing.sm },
  })
