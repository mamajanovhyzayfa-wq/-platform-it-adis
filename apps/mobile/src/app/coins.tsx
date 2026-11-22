import { Alert, StyleSheet, Text, View } from 'react-native'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, ErrorState, ListScreen, Screen, Skeleton } from '@/components/ui'
import { api, type CoinSource, type CoinTransactionItem } from '@/api/api'
import { describeApiError } from '@/api/client'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

const SOURCE_META: Record<CoinSource, { icon: string; label: string }> = {
  HOMEWORK: { icon: '📘', label: 'Домашнее задание' },
  TEST: { icon: '🧠', label: 'Тест' },
  ATTENDANCE: { icon: '🎥', label: 'Посещение' },
  ACHIEVEMENT: { icon: '🏆', label: 'Достижение' },
  COURSE: { icon: '🎓', label: 'Завершение курса' },
  SHOP: { icon: '🛍', label: 'Магазин' },
  MANUAL: { icon: '✨', label: 'Начисление' },
  QUEST: { icon: '🎯', label: 'Задание' },
  STREAK: { icon: '🔥', label: 'Серия активности' },
  SEASON: { icon: '🗓', label: 'Сезон' },
  EVENT: { icon: '🎪', label: 'Мероприятие' },
  PENALTY: { icon: '⚠️', label: 'Списание' },
  REFUND: { icon: '↩️', label: 'Возврат' },
  REVERSAL: { icon: '↩️', label: 'Отмена операции' },
  LEVEL: { icon: '⬆️', label: 'Уровень' },
  ADJUSTMENT: { icon: '⚙️', label: 'Корректировка' },
}

const PAGE_SIZE = 30

/** Баланс и история движений IT Coins с постраничной загрузкой. */
export default function CoinsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['coin-overview'], queryFn: api.coinOverview })

  const claim = useMutation({
    mutationFn: (id: string) => api.claimCoinQuest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['coin-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['coins'] })
      void queryClient.invalidateQueries({ queryKey: ['coin-balance'] })
    },
    onError: (error) => Alert.alert('Не удалось получить награду', describeApiError(error)),
  })

  const coins = useInfiniteQuery({
    queryKey: ['coins'],
    queryFn: ({ pageParam }) => api.coinHistory({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  })

  if (coins.isLoading) {
    return (
      <Screen>
        <Skeleton height={150} borderRadius={18} />
        <Skeleton height={72} borderRadius={14} />
        <Skeleton height={72} borderRadius={14} />
        <Skeleton height={72} borderRadius={14} />
      </Screen>
    )
  }

  const summary = coins.data?.pages[0]

  if (coins.isError || !summary) {
    return (
      <Screen refreshing={coins.isRefetching} onRefresh={() => void coins.refetch()}>
        <ErrorState
          title="Не удалось загрузить историю"
          message={coins.error ? describeApiError(coins.error) : undefined}
          onRetry={() => void coins.refetch()}
        />
      </Screen>
    )
  }

  const items = coins.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <ListScreen<CoinTransactionItem>
      data={items}
      keyExtractor={(item) => item.id}
      refreshing={coins.isRefetching}
      onRefresh={() => void coins.refetch()}
      onEndReached={() => {
        if (coins.hasNextPage && !coins.isFetchingNextPage) void coins.fetchNextPage()
      }}
      loadingMore={coins.isFetchingNextPage}
      header={
        <>
          <Card style={{ backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentSoft }}>
            <Text style={styles.heroLabel}>Ваш баланс</Text>
            <Text style={[styles.heroValue, { color: theme.colors.success }]}>{summary.balance}</Text>
            <Text style={styles.heroUnit}>IT Coins</Text>
            <View style={styles.totals}>
              <View style={styles.totalCell}>
                <Text style={styles.totalValue}>+{summary.totals.earned}</Text>
                <Text style={styles.totalLabel}>получено</Text>
              </View>
              <View style={styles.totalDivider} />
              <View style={styles.totalCell}>
                <Text style={[styles.totalValue, { color: theme.colors.danger }]}>−{summary.totals.spent}</Text>
                <Text style={styles.totalLabel}>потрачено</Text>
              </View>
            </View>
          </Card>

          {overview.data ? (
            <Card>
              <View style={styles.levelRow}>
                <View>
                  <Text style={styles.blockTitle}>{overview.data.level} · {overview.data.levelTitle}</Text>
                  <Text style={styles.rowMeta}>{overview.data.xp} XP · серия {overview.data.streak.current} дн. (лучшая {overview.data.streak.best})</Text>
                </View>
                {overview.data.nextLevel ? <Badge label={`до «${overview.data.nextLevel.title}»`} tone="neutral" /> : null}
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${overview.data.levelProgress}%` }]} />
              </View>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.blockTitle}>Как заработать</Text>
            <Text style={styles.rule}>📘 Проверенное домашнее задание — от 10 монет</Text>
            <Text style={styles.rule}>🧠 Пройденный тест — от 10 монет</Text>
            <Text style={styles.rule}>🎥 Присутствие на занятии — 3 монеты</Text>
            <Text style={styles.rule}>🎓 Завершение курса — 100 монет</Text>
          </Card>

          {overview.data?.quests.length ? (
            <Card>
              <Text style={styles.blockTitle}>Задания</Text>
              {overview.data.quests.filter((quest) => !quest.claimedAt).slice(0, 4).map((quest) => (
                <View key={`${quest.id}:${quest.periodKey}`} style={styles.questRow}>
                  <View style={styles.questBody}>
                    <Text style={styles.rowTitle}>{quest.title}</Text>
                    <Text style={styles.rowMeta}>{quest.progress} из {quest.target} · +{quest.rewardCoins} монет</Text>
                  </View>
                  <Button
                    title={quest.completed ? 'Забрать' : 'В процессе'}
                    disabled={!quest.completed || claim.isPending}
                    onPress={() => claim.mutate(quest.id)}
                    variant="secondary"
                  />
                </View>
              ))}
            </Card>
          ) : null}

          {overview.data?.season ? (
            <Card>
              <Text style={styles.blockTitle}>{overview.data.season.title}</Text>
              <Text style={styles.rowMeta}>{overview.data.season.theme} · сезонные очки: {overview.data.season.points} · осталось {overview.data.season.daysLeft} дн.</Text>
            </Card>
          ) : null}

          <View style={styles.listHead}>
            <Text style={styles.blockTitle}>История</Text>
            <Badge label={`${summary.total}`} tone="neutral" />
          </View>
        </>
      }
      empty={
        <EmptyState
          title="Движений пока нет"
          hint="Монеты начисляются автоматически за учёбу — начните с задания или теста."
          icon="🪙"
        />
      }
      renderItem={({ item }) => {
        const meta = item.sourceType ? SOURCE_META[item.sourceType] : SOURCE_META.MANUAL
        const positive = item.amount > 0
        return (
          <Card style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: theme.colors.cardMuted }]}>
              <Text style={styles.icon}>{meta.icon}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.reason}
              </Text>
              <Text style={styles.rowMeta}>
                {meta.label} · {formatFullDate(item.createdAt)}, {formatTime(item.createdAt)}
                {item.awardedBy ? ` · ${item.awardedBy.firstName} ${item.awardedBy.lastName}` : ''}
              </Text>
              <Text style={styles.rowMeta}>
                {item.balanceAfter !== null ? `Итог: ${item.balanceAfter}` : ''}
                {item.status !== 'POSTED' ? ` · ${item.status === 'PENDING' ? 'на подтверждении' : item.status === 'REJECTED' ? 'отклонено' : item.status === 'REVERSED' ? 'отменено' : 'обжаловано'}` : ''}
              </Text>
            </View>
            <Text style={[styles.amount, { color: positive ? theme.colors.success : theme.colors.danger }]}>
              {positive ? '+' : '−'}
              {Math.abs(item.amount)}
            </Text>
          </Card>
        )
      }}
    />
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    heroLabel: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' },
    heroValue: { fontSize: 44, fontWeight: '800', marginTop: spacing.xs, letterSpacing: -1 },
    heroUnit: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted },
    totals: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
    totalCell: { flex: 1 },
    totalDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: c.border, marginHorizontal: spacing.md },
    totalValue: { fontSize: typography.h2, fontWeight: '800', color: c.success },
    totalLabel: { fontSize: typography.tiny, color: c.textMuted, marginTop: 2 },
    blockTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    rule: { fontSize: typography.caption, color: c.text, marginTop: spacing.sm, lineHeight: 19 },
    listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
    levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    progressTrack: { height: 8, borderRadius: 999, backgroundColor: c.border, overflow: 'hidden', marginTop: spacing.sm },
    progressFill: { height: 8, backgroundColor: c.primary },
    questRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    questBody: { flex: 1, gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: { fontSize: 17 },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontSize: typography.body, fontWeight: '600', color: c.text },
    rowMeta: { fontSize: typography.tiny, color: c.textMuted },
    amount: { fontSize: typography.h2, fontWeight: '800' },
  })
