import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { BackHandler, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

interface BottomSheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  /** Пояснение под заголовком. */
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Закрытие по тапу на затемнённый фон. */
  closeOnBackdrop?: boolean
  /** Показывать «ручку» для закрытия. */
  showHandle?: boolean
  testID?: string
}

/**
 * Нижняя панель (bottom sheet).
 *
 * Нативный Modal гарантирует корректную работу кнопки «назад» на Android и
 * перекрытие таб-бара; анимация — Reanimated, чтобы не блокировать JS-поток.
 * Нажатие на фон и на ручку закрывает панель.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
  showHandle = true,
  testID,
}: BottomSheetProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()

  // Android: аппаратная кнопка «назад» должна закрывать панель, а не экран.
  useEffect(() => {
    if (!visible) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => subscription.remove()
  }, [visible, onClose])

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть панель"
          style={StyleSheet.absoluteFill}
          onPress={closeOnBackdrop ? onClose : undefined}
        />
        <Animated.View
          testID={testID}
          entering={SlideInDown.duration(220)}
          exiting={SlideOutDown.duration(180)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          {showHandle ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Свернуть" onPress={onClose} style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
            </Pressable>
          ) : null}

          {title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              {description ? <Text style={styles.description}>{description}</Text> : null}
            </View>
          ) : null}

          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.backgroundAlt,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      maxHeight: '85%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    handleWrap: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
    handle: { width: 44, height: 5, borderRadius: radius.pill },
    header: { gap: spacing.xs, marginBottom: spacing.md },
    title: { fontSize: typography.h1, fontWeight: '700', color: c.text },
    description: { fontSize: typography.body, color: c.textMuted, lineHeight: 20 },
    body: { gap: spacing.sm },
    footer: { marginTop: spacing.lg, gap: spacing.sm },
  })
