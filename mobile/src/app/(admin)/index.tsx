import { Linking, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Loader, Screen } from '@/components/ui'
import { api } from '@/api/api'
import { API_URL } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import { colors, spacing, typography } from '@/theme'

export default function AdminHome() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.catalogCourses({ limit: 50 }) })

  if (courses.isLoading) return <Screen><Loader /></Screen>

  const docsUrl = API_URL.replace(/\/api$/, '/docs')

  return (
    <Screen>
      <Text style={styles.hi}>
        {user?.firstName} {user?.lastName}
      </Text>
      <Text style={styles.muted}>Администратор платформы</Text>

      <View style={styles.row}>
        <Card style={styles.stat}>
          <Text style={styles.statValue}>{courses.data?.total ?? 0}</Text>
          <Text style={styles.muted}>Активных курсов</Text>
        </Card>
      </View>

      <Card>
        <Text style={styles.cardTitle}>Документация API</Text>
        <Text style={styles.muted}>Swagger со всеми реализованными маршрутами.</Text>
        <Button title="Открыть Swagger" variant="secondary" style={{ marginTop: spacing.md }} onPress={() => void Linking.openURL(docsUrl)} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Веб-панель</Text>
        <Text style={styles.muted}>
          Полная административная панель (роли, аудит, аналитика) — следующий этап. Сейчас в API доступны журнал аудита и
          управление монетами на серверной стороне.
        </Text>
      </Card>

      <Button title="Выйти" variant="danger" onPress={() => void logout()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  hi: { fontSize: typography.title, fontWeight: '800', color: colors.text },
  muted: { fontSize: typography.caption, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1 },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.primary },
  cardTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text },
})
