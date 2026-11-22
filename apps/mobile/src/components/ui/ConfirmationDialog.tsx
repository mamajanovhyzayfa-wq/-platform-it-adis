import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Modal } from './Modal'
import { Button } from './Button'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

export interface ConfirmationDialogProps {
  visible: boolean
  title: string
  description?: string
  /** Дополнительный контент под описанием (например, поле ввода причины). */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Опасное действие: кнопка подтверждения красная. */
  destructive?: boolean
  /** Показывать индикатор на кнопке подтверждения. */
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  testID?: string
}

/**
 * Подтверждение критичного действия (выход, удаление, отмена занятия).
 *
 * Построен на общем Modal, поэтому наследует тему, анимацию и обработку
 * аппаратной кнопки «назад» на Android.
 */
export function ConfirmationDialog({
  visible,
  title,
  description,
  children,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmationDialogProps) {
  const styles = useThemedStyles(makeStyles)

  return (
    <Modal
      visible={visible}
      onClose={loading ? () => undefined : onCancel}
      title={title}
      showClose={false}
      closeOnBackdrop={!loading}
      footer={
        <View style={styles.actions}>
          <View style={styles.actionItem}>
            <Button title={cancelLabel} variant="ghost" onPress={onCancel} disabled={loading} />
          </View>
          <View style={styles.actionItem}>
            <Button
              title={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
              loading={loading}
              testID={testID}
            />
          </View>
        </View>
      }
    >
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </Modal>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    description: { fontSize: typography.body, color: c.textMuted, lineHeight: 21 },
    actions: { flexDirection: 'row', gap: spacing.sm },
    actionItem: { flex: 1 },
  })
