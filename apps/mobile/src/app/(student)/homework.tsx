import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ErrorState, Screen, Skeleton, Title } from '@/components/ui'
import { HomeworkList } from '@/components/lists'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { spacing } from '@/theme'

export default function StudentHomework() {
  const { t } = useI18n()
  const router = useRouter()
  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ['homework'],
    queryFn: api.homework,
  })

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Title subtitle="Откройте задание, чтобы отправить решение или посмотреть оценку.">{t('homework.title')}</Title>

      {isLoading ? (
        <View style={{ gap: spacing.md }}>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} height={120} borderRadius={18} />
          ))}
        </View>
      ) : isError ? (
        <ErrorState
          title="Не удалось загрузить задания"
          message={describeApiError(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <HomeworkList
          items={data ?? []}
          onPress={(item) => router.push({ pathname: '/homework/[id]', params: { id: item.id } })}
        />
      )}
    </Screen>
  )
}
