import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'
import { IconButton } from './IconButton'

interface ModalProps {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** Закрытие по нажатию на затемнённый фон. */
  closeOnBackdrop?: boolean
  /** Показать крестик в шапке. */
  showClose?: boolean
}

export function Modal({
  visible,
  onClose,
  title,
  children,
  footer,
  closeOnBackdrop = true,
  showClose = true,
}: ModalProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Закрыть"
          onPress={closeOnBackdrop ? onClose : undefined}
        />
        <View style={styles.center} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            style={[styles.dialog, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          >
            {title || showClose ? (
              <View style={styles.header}>
                <Text style={styles.title} accessibilityRole="header">
                  {title ?? ''}
                </Text>
                {showClose ? <IconButton icon="✕" onPress={onClose} accessibilityLabel="Закрыть окно" /> : null}
              </View>
            ) : null}
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'center', padding: spacing.lg },
    center: { width: '100%', maxWidth: 520, alignSelf: 'center' },
    dialog: {
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      padding: spacing.lg,
      gap: spacing.sm,
      maxHeight: '85%',
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    title: { flex: 1, fontSize: typography.h2, fontWeight: '800', color: c.text },
    body: { gap: spacing.sm },
    footer: { marginTop: spacing.sm, gap: spacing.sm },
  })
