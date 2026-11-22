import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { spacing, useTheme } from '@/theme'

export interface ListScreenProps<T> {
  data: T[]
  renderItem: ListRenderItem<T>
  keyExtractor: (item: T, index: number) => string
  /** Верхняя часть экрана: заголовок, поиск, фильтры. Прокручивается вместе со списком. */
  header?: ReactNode
  /** Показывается, когда данных нет. */
  empty?: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  /** Догрузка следующей страницы. */
  onEndReached?: () => void
  loadingMore?: boolean
  footer?: ReactNode
}

/**
 * Экран со списком на FlatList: виртуализация, pull-to-refresh и догрузка страниц.
 * Заголовок уходит в ListHeaderComponent, поэтому внутри ScrollView нет вложенных списков.
 */
export function ListScreen<T>({
  data,
  renderItem,
  keyExtractor,
  header,
  empty,
  refreshing = false,
  onRefresh,
  onEndReached,
  loadingMore = false,
  footer,
}: ListScreenProps<T>) {
  const theme = useTheme()

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header ? <View style={styles.header}>{header}</View> : undefined}
        ListEmptyComponent={empty ? <View style={styles.empty}>{empty}</View> : undefined}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : footer ? (
            <View style={styles.footer}>{footer}</View>
          ) : undefined
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  header: { gap: spacing.md },
  empty: { paddingTop: spacing.lg },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
})
