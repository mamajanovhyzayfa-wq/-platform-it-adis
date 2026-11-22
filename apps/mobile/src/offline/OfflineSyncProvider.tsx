import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { router } from 'expo-router'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useQueryClient } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { spacing, typography, useTheme } from '@/theme'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui'
import { flushQueue, readQueue, subscribeQueue, type QueueItem } from './queue'

interface OfflineState {
  online: boolean | null
  pending: number
  conflicts: number
  syncing: boolean
  items: QueueItem[]
  syncNow: () => Promise<void>
}

const OfflineContext = createContext<OfflineState>({
  online: null,
  pending: 0,
  conflicts: 0,
  syncing: false,
  items: [],
  syncNow: async () => undefined,
})

export function useOffline() {
  return useContext(OfflineContext)
}

/**
 * Следит за сетью и отправляет очередь после восстановления соединения.
 * Ошибка синхронизации не удаляет очередь: элемент остаётся с пометкой конфликта.
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const status = useAuthStore((state) => state.status)
  const [online, setOnline] = useState<boolean | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)

  useEffect(() => {
    void readQueue().then(setItems)
    return subscribeQueue(setItems)
  }, [])

  const syncNow = useCallback(async () => {
    if (syncingRef.current || status !== 'authenticated') return
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await flushQueue()
      if (result.sent > 0) {
        toast.success(`Синхронизировано действий: ${result.sent}`)
        await queryClient.invalidateQueries()
      }
      if (result.conflicts > 0) {
        toast.show({
          message: `Не удалось синхронизировать ${result.conflicts} действий. Данные сохранены — проверьте конфликт.`,
          tone: 'warning',
          duration: 5000,
        })
      }
      if (!result.offline && result.remaining > 0 && result.conflicts > 0) {
        // Конфликты остаются видимыми в баннере до ручного разбора.
      }
    } catch {
      toast.error('Не удалось синхронизировать. Данные останутся на устройстве.')
    } finally {
      syncingRef.current = false
      setSyncing(false)
      setItems(await readQueue())
    }
  }, [queryClient, status, toast])

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false)
      setOnline(connected)
      if (connected) void syncNow()
    })
    void NetInfo.fetch().then((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false)
      setOnline(connected)
      if (connected) void syncNow()
    })
    return unsubscribe
  }, [syncNow])

  const pending = items.filter((item) => item.status === 'pending').length
  const conflicts = items.filter((item) => item.status === 'conflict').length
  const visible = online === false || pending > 0 || conflicts > 0

  const openConflicts = () => {
    if (conflicts === 0) return
    Alert.alert(
      'Конфликты синхронизации',
      `Сервер отклонил ${conflicts} изменений. Локальные копии сохранены на устройстве.\n\nОткройте очередь, чтобы перенести текст в черновик, повторить отправку или удалить копию.`,
      [
        { text: 'Позже', style: 'cancel' },
        { text: 'Открыть очередь', onPress: () => router.push('/offline-queue') },
      ],
    )
  }

  return (
    <OfflineContext.Provider value={{ online, pending, conflicts, syncing, items, syncNow }}>
      {children}
      {visible ? (
        <View
          pointerEvents="box-none"
          style={[styles.wrap, { top: insets.top + 4 }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Состояние офлайн-синхронизации"
            onPress={() => (conflicts > 0 ? openConflicts() : void syncNow())}
            style={[
              styles.banner,
              {
                backgroundColor: online === false ? theme.colors.warning : theme.colors.backgroundAlt,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text style={[styles.icon, { color: theme.colors.text }]}>
              {online === false ? '⚡' : conflicts > 0 ? '⚠️' : '↻'}
            </Text>
            <Text style={[styles.text, { color: theme.colors.text }]}>
              {online === false
                ? `Нет сети. Сохранённые данные доступны${pending ? `, в очереди ${pending}` : ''}.`
                : conflicts > 0
                  ? `Конфликтов: ${conflicts}. Данные сохранены на устройстве.`
                  : syncing
                    ? `Синхронизация… (${pending})`
                    : `В очереди ${pending}. Нажмите для синхронизации.`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </OfflineContext.Provider>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 500,
    elevation: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { fontSize: typography.caption, fontWeight: '800' },
  text: { flex: 1, fontSize: typography.caption, lineHeight: 17, fontWeight: '600' },
})
