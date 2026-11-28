import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

type ToastTone = 'info' | 'success' | 'error' | 'warning'

interface ToastOptions {
  message: string
  tone?: ToastTone
  /** Время показа в миллисекундах. */
  duration?: number
  /** Действие по тапу на toast (например, «Повторить»). */
  actionLabel?: string
  onAction?: () => void
}

interface ToastState extends ToastOptions {
  id: number
}

interface ToastContextValue {
  show: (options: ToastOptions | string) => void
  success: (message: string) => void
  error: (message: string) => void
  hide: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * Глобальные всплывающие сообщения.
 *
 * Провайдер монтируется один раз в корневом layout, поэтому toast переживает
 * переходы между экранами и не привязан к конкретному компоненту.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const counter = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setToast(null)
  }, [])

  const show = useCallback(
    (options: ToastOptions | string) => {
      const next: ToastOptions = typeof options === 'string' ? { message: options } : options
      counter.current += 1
      if (timer.current) clearTimeout(timer.current)
      setToast({ ...next, id: counter.current })
      timer.current = setTimeout(hide, next.duration ?? 3200)
    },
    [hide],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      hide,
      success: (message: string) => show({ message, tone: 'success' }),
      error: (message: string) => show({ message, tone: 'error' }),
    }),
    [show, hide],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView toast={toast} onHide={hide} /> : null}
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onHide }: { toast: ToastState; onHide: () => void }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()

  const toneColor: Record<ToastTone, string> = {
    info: theme.colors.primary,
    success: theme.colors.success,
    error: theme.colors.danger,
    warning: theme.colors.warning,
  }
  const tone: ToastTone = toast.tone ?? 'info'

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutUp.duration(160)}
      style={[styles.wrap, { bottom: insets.bottom + spacing.lg }]}
      pointerEvents="box-none"
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={toast.onAction ?? onHide}
        style={[styles.toast, { borderLeftColor: toneColor[tone] }]}
      >
        <View style={styles.textWrap}>
          <Text style={styles.message}>{toast.message}</Text>
        </View>
        {toast.actionLabel ? (
          <Text onPress={toast.onAction} style={[styles.action, { color: theme.colors.primary }]}>
            {toast.actionLabel}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  )
}

/** Хук доступа к toast. Без провайдера вызовы безопасно игнорируются. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context) return context
  return {
    show: () => undefined,
    hide: () => undefined,
    success: () => undefined,
    error: () => undefined,
  }
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: c.card,
      borderRadius: radius.md,
      borderLeftWidth: 4,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      shadowColor: c.black,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    textWrap: { flex: 1 },
    message: { fontSize: typography.body, color: c.text, fontWeight: '500' },
    action: { fontSize: typography.caption, fontWeight: '700' },
  })
