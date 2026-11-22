import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { EmptyState, ErrorState, Screen, Skeleton, Title } from '@/components/ui'
import { TeacherCourseCard } from '@/components/teacher'
import { api } from '@/api/api'
import { useI18n } from '@/i18n'
import { spacing } from '@/theme'

export default function TeacherCourses() {
  const { t } = useI18n()
  const router = useRouter()
  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['teacher-courses'],
    queryFn: api.teacherCourses,
  })

  if (isLoading) {
    return (
      <Screen>
        <Skeleton width="50%" height={28} />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={130} borderRadius={18} />
        ))}
      </Screen>
    )
  }

  if (isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => void refetch()} />
      </Screen>
    )
  }

  const items = data ?? []

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Title subtitle="Курсы, которые вы ведёте: программа, ученики и работы на проверку.">{t('teacher.coursesTitle')}</Title>
      {items.length === 0 ? (
        <EmptyState title={t('teacher.noCourses')} hint={t('teacher.noCoursesHint')} icon="📚" />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((course) => (
            <TeacherCourseCard
              key={course.id}
              course={course}
              onPress={() => router.push({ pathname: '/teacher-course/[id]', params: { id: course.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  )
}
