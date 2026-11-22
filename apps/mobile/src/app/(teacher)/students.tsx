import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Badge, Card, EmptyState, Loader, Screen, Title } from '@/components/ui'
import { api } from '@/api/api'
import { useI18n } from '@/i18n'
import { colors, spacing, typography } from '@/theme'

export default function TeacherStudents() {
  const { t } = useI18n()
  const { data, isLoading, isRefetching, refetch } = useQuery({ queryKey: ['teacher-students'], queryFn: api.myStudents })

  if (isLoading) return <Screen><Loader /></Screen>

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Title>{t('teacher.studentsTitle')}</Title>
      {(data ?? []).length === 0 ? (
        <EmptyState title={t('teacher.studentsEmpty')} hint="Ученики появляются после записи на ваш курс." />
      ) : (
        <View style={{ gap: spacing.md }}>
          {(data ?? []).map((student) => (
            <Card key={`${student.id}-${student.courseTitle}`} style={styles.card}>
              <Avatar firstName={student.firstName} lastName={student.lastName} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {student.firstName} {student.lastName}
                </Text>
                <Text style={styles.muted}>{student.courseTitle}</Text>
              </View>
              <Badge label={`${student.progress}%`} tone={student.progress >= 60 ? 'success' : 'primary'} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typography.h2, fontWeight: '700', color: colors.text },
  muted: { fontSize: typography.caption, color: colors.textMuted, marginTop: 2 },
})
