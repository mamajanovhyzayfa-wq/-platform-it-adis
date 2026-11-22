import { useDeferredValue, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loader, ProgressBar, Screen, Title } from '@/components/ui'
import { api, type ManagerStudent } from '@/api/api'
import { useI18n } from '@/i18n'
import { formatDate } from '@/utils/format'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const PAGE_SIZE = 20

/** Справочник учеников филиала: поиск, прогресс и пагинация. */
export default function ManagerStudents() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(search.trim())

  const students = useQuery({
    queryKey: ['manager-students', deferredSearch, page],
    queryFn: () => api.managerStudents({ search: deferredSearch || undefined, page, limit: PAGE_SIZE }),
  })

  if (students.isLoading) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    )
  }

  if (students.isError) {
    return (
      <Screen refreshing={students.isRefetching} onRefresh={() => void students.refetch()}>
        <ErrorState onRetry={() => void students.refetch()} />
      </Screen>
    )
  }

  const data = students.data
  if (!data) return null

  return (
    <Screen refreshing={students.isRefetching} onRefresh={() => void students.refetch()}>
      <Title subtitle={t('manager.studentsSubtitle')}>{t('manager.studentsTitle')}</Title>

      <Input
        placeholder={t('manager.searchStudents')}
        value={search}
        onChangeText={(value) => {
          setSearch(value)
          setPage(1)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={t('manager.searchStudents')}
      />

      <View style={styles.summaryRow}>
        <Text style={styles.muted}>
          {t('manager.total')}: {data.total}
        </Text>
        <Text style={styles.muted}>
          {t('manager.page')} {data.page} / {data.pages}
        </Text>
      </View>

      {data.items.length === 0 ? (
        <EmptyState title={t('manager.noStudents')} hint={t('manager.noStudentsHint')} icon="🎓" />
      ) : (
        <View style={styles.list}>
          {data.items.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </View>
      )}

      <View style={styles.pagination}>
        <Button
          title={t('common.back')}
          variant="secondary"
          disabled={data.page <= 1 || students.isFetching}
          onPress={() => setPage((value) => Math.max(1, value - 1))}
          style={styles.pageButton}
        />
        <Button
          title={t('manager.next')}
          variant="secondary"
          disabled={data.page >= data.pages || students.isFetching}
          onPress={() => setPage((value) => Math.min(data.pages, value + 1))}
          style={styles.pageButton}
        />
      </View>
    </Screen>
  )
}

function StudentCard({ student }: { student: ManagerStudent }) {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)

  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.studentTitle}>
          <Text style={styles.name}>
            {student.firstName} {student.lastName}
          </Text>
          <Text style={styles.muted}>{student.email}</Text>
          {student.phone ? <Text style={styles.muted}>{student.phone}</Text> : null}
        </View>
        <Badge label={student.isActive ? 'ACTIVE' : 'BLOCKED'} tone={student.isActive ? 'success' : 'danger'} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {t('manager.grade')}: {student.gradeLevel ?? '—'}
        </Text>
        <Text style={styles.meta}>
          {t('parent.coins')}: {student.coinBalance}
        </Text>
        <Text style={styles.meta}>
          {student.lastLoginAt ? formatDate(student.lastLoginAt) : t('manager.neverLoggedIn')}
        </Text>
      </View>

      <Text style={styles.coursesTitle}>
        {t('manager.courses')}: {student.courses.length}
      </Text>
      {student.courses.length === 0 ? (
        <Text style={styles.muted}>{t('manager.noCourses')}</Text>
      ) : (
        student.courses.map((course) => (
          <View key={course.id} style={styles.courseRow}>
            <View style={styles.rowBetween}>
              <Text style={styles.courseName}>{course.title}</Text>
              <Text style={styles.percent}>{Math.round(course.progress)}%</Text>
            </View>
            <ProgressBar
              value={course.progress}
              showLabel={false}
              height={6}
              accessibilityLabel={`${t('manager.courseProgress')}: ${course.title}`}
            />
          </View>
        ))
      )}
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: 2 },
    list: { gap: spacing.sm },
    rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    studentTitle: { flex: 1 },
    name: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    meta: { fontSize: typography.tiny, color: c.textMuted },
    coursesTitle: { fontSize: typography.caption, fontWeight: '700', color: c.text, marginTop: spacing.md },
    courseRow: { gap: spacing.xs, marginTop: spacing.xs },
    courseName: { flex: 1, fontSize: typography.caption, color: c.text },
    percent: { fontSize: typography.tiny, fontWeight: '700', color: c.primary },
    pagination: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    pageButton: { flex: 1 },
  })
