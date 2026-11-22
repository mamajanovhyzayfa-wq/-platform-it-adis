import { useState } from 'react'
import { View } from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { EmptyState, ErrorState, ListScreen, Skeleton, Tabs, Title, type TabItem } from '@/components/ui'
import { SubmissionRow } from '@/components/teacher'
import { api, type TeacherSubmission } from '@/api/api'
import { useI18n } from '@/i18n'
import { spacing } from '@/theme'

type Filter = 'PENDING' | 'REVIEWED' | 'RETURNED'

const PAGE_SIZE = 20

export default function TeacherHomework() {
  const { t } = useI18n()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('PENDING')

  const submissions = useInfiniteQuery({
    queryKey: ['teacher-submissions', filter],
    queryFn: ({ pageParam }) =>
      api.teacherSubmissions({ status: filter, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  })

  const tabs: TabItem<Filter>[] = [
    { key: 'PENDING', label: t('teacher.pending') },
    { key: 'REVIEWED', label: t('teacher.reviewed') },
    { key: 'RETURNED', label: t('teacher.returned') },
  ]

  const items = submissions.data?.pages.flatMap((page) => page.items) ?? []
  const emptyTitle =
    filter === 'PENDING'
      ? t('teacher.pendingEmpty')
      : filter === 'REVIEWED'
        ? 'Проверенных работ пока нет'
        : 'Возвращённых работ пока нет'

  return (
    <ListScreen<TeacherSubmission>
      data={items}
      keyExtractor={(item) => item.id}
      refreshing={submissions.isRefetching}
      onRefresh={() => void submissions.refetch()}
      onEndReached={() => {
        if (submissions.hasNextPage && !submissions.isFetchingNextPage) void submissions.fetchNextPage()
      }}
      loadingMore={submissions.isFetchingNextPage}
      header={
        <>
          <Title subtitle="Решения учеников по вашим заданиям: оценка и комментарий.">{t('teacher.reviewTitle')}</Title>
          <Tabs items={tabs} value={filter} onChange={setFilter} />
        </>
      }
      empty={
        submissions.isLoading ? (
          <View style={{ gap: spacing.md }}>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} height={76} borderRadius={18} />
            ))}
          </View>
        ) : submissions.isError ? (
          <ErrorState onRetry={() => void submissions.refetch()} />
        ) : (
          <EmptyState
            title={emptyTitle}
            hint={filter === 'PENDING' ? t('teacher.pendingHint') : undefined}
            icon={filter === 'PENDING' ? '✅' : '📄'}
          />
        )
      }
      renderItem={({ item }) => (
        <SubmissionRow
          item={item}
          onPress={() => router.push({ pathname: '/teacher-submission/[id]', params: { id: item.id } })}
        />
      )}
    />
  )
}
