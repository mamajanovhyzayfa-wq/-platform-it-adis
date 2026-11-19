import { StyleSheet, Text, View } from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Badge, Card, EmptyState, ErrorState, ListScreen, Screen, Skeleton } from '@/components/ui'
import { api, type CoinSource, type CoinTransactionItem } from '@/api/api'
import { describeApiError } from '@/api/client'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

const SOURCE_META: Record<CoinSource, { icon: string; label: string }> = {
  HOMEWORK: { icon: '📘', label: 'Домашнее задание' },
  TEST: { icon: '🧠', label: 'Тест' },
  ATTENDANCE: { icon: '🎥', label: 'Посещение' },
  ACHIEVEMENT: { icon: '🏆', label: 'Достижение' },
  SHOP: { icon: '🛍', label: 'Магазин' },
  MANUAL: { icon: '✨', label: 'Начисление' },
}

const PAGE_SIZE = 30

/** Баланс и история движений IT Coins с постраничной загрузкой. */
export default function CoinsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

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

          <Card>
            <Text style={styles.blockTitle}>Как заработать</Text>
            <Text style={styles.rule}>📘 Проверенное домашнее задание — до 20 монет</Text>
            <Text style={styles.rule}>🧠 Пройденный тест — 10–20 монет</Text>
            <Text style={styles.rule}>🎥 Присутствие на занятии — 3 монеты</Text>
          </Card>

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
