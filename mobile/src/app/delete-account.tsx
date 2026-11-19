import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, ConfirmationDialog, useToast } from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

/**
 * Удаление аккаунта.
 *
 * Сервер обезличивает персональные данные (`DELETE /users/me`), затем приложение
 * стирает локальные токены. Учебная статистика остаётся в обезличенном виде —
 * об этом честно сказано до подтверждения.
 */
export default function DeleteAccountScreen() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const logout = useAuthStore((state) => state.logout)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: async () => {
      setConfirmOpen(false)
      toast.success(t('privacy.deleted'))
      await logout()
      router.replace('/welcome')
    },
    onError: (error) => {
      setConfirmOpen(false)
      toast.error(`${t('privacy.deleteFailed')}: ${describeApiError(error)}`)
    },
  })

  const warnings = [t('privacy.warning1'), t('privacy.warning2'), t('privacy.warning3')]

  return (
    <View style={styles.page}>
      <Card>
        <Text style={styles.title}>{t('privacy.warningTitle')}</Text>
        {warnings.map((warning) => (
          <View key={warning} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>{warning}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.confirmText}>{t('privacy.confirmText')}</Text>

      <Button title={t('privacy.confirmLabel')} variant="danger" onPress={() => setConfirmOpen(true)} />
      <Button title={t('privacy.cancel')} variant="ghost" onPress={() => router.back()} style={styles.cancel} />

      <ConfirmationDialog
        visible={confirmOpen}
        title={t('privacy.accountTitle')}
        description={t('privacy.confirmText')}
        confirmLabel={t('privacy.confirmLabel')}
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background, padding: spacing.lg, gap: spacing.md },
    title: { fontSize: typography.h2, fontWeight: '800', color: c.danger, marginBottom: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    bullet: { fontSize: typography.body, color: c.danger, fontWeight: '800' },
    text: { flex: 1, fontSize: typography.body, color: c.text, lineHeight: 22 },
    confirmText: { fontSize: typography.caption, color: c.textMuted, lineHeight: 20 },
    cancel: { marginTop: spacing.xs },
  })
