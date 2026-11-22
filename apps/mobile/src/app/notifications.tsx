import { StyleSheet, Text, View } from 'react-native'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, EmptyState, ListScreen } from '@/components/ui'
import { api, type NotificationItem } from '@/api/api'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const PAGE_SIZE = 30

/** Центр уведомлений: виртуальный список с догрузкой и отметками о прочтении. */
export default function NotificationsScreen() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const queryClient = useQueryClient()

  const notifications = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.notifications({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  })

  const markRead = useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAll = useMutation({
    mutationFn: api.markAllRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const items = notifications.data?.pages.flatMap((page) => page.items) ?? []
  const unread = notifications.data?.pages[0]?.unread ?? 0

  return (
    <ListScreen<NotificationItem>
      data={items}
      keyExtractor={(item) => item.id}
      refreshing={notifications.isRefetching}
      onRefresh={() => void notifications.refetch()}
      onEndReached={() => {
        if (notifications.hasNextPage && !notifications.isFetchingNextPage) void notifications.fetchNextPage()
      }}
      loadingMore={notifications.isFetchingNextPage}
      header={
        unread > 0 ? (
          <View style={styles.headerRow}>
            <Badge label={`${unread} ${t('notifications.unread').toLowerCase()}`} tone="primary" />
            <Button
              title={t('notifications.markAll')}
              variant="secondary"
              size="sm"
              fullWidth={false}
              loading={markAll.isPending}
              onPress={() => markAll.mutate()}
            />
          </View>
        ) : null
      }
      empty={<EmptyState title={t('notifications.empty')} hint={t('notifications.emptyHint')} />}
      renderItem={({ item }) => (
        <Card style={!item.readAt ? styles.unread : undefined}>
          <View style={styles.rowBetween}>
            <Text style={styles.title}>{item.title}</Text>
            {!item.readAt ? <Badge label={t('notifications.unread')} tone="primary" /> : null}
          </View>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
          {!item.readAt ? (
            <Button
              title={t('notifications.markRead')}
              variant="ghost"
              style={styles.markOne}
              loading={markRead.isPending && markRead.variables === item.id}
              onPress={() => markRead.mutate(item.id)}
            />
          ) : null}
        </Card>
      )}
    />
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    title: { flex: 1, fontSize: typography.h2, fontWeight: '700', color: c.text },
    body: { fontSize: typography.body, color: c.text, marginTop: spacing.xs },
    date: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.sm },
    unread: { borderWidth: 1, borderColor: c.primarySoft },
    markOne: { marginTop: spacing.sm },
  })
