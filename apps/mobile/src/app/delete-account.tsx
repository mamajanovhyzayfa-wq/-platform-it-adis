import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, ConfirmationDialog, TextArea, useToast } from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const statusLabels: Record<string, string> = {
  PENDING: 'На рассмотрении',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  CANCELLED: 'Отменено',
}

/**
 * Удаление аккаунта — заявка, а не мгновенное стирание.
 * Администратор проверяет запрос; данные, которые нужно хранить по закону,
 * сохраняются, а история обработки остаётся доступной.
 */
export default function DeleteAccountScreen() {
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')

  const requests = useQuery({
    queryKey: ['account-deletion'],
    queryFn: api.deletionRequests,
  })
  const pending = (requests.data ?? []).find((request) => request.status === 'PENDING')

  const createRequest = useMutation({
    mutationFn: () => api.requestAccountDeletion(reason.trim() || undefined),
    onSuccess: () => {
      setConfirmOpen(false)
      setReason('')
      toast.success('Запрос отправлен. Администратор рассмотрит его и сохранит историю.')
      void queryClient.invalidateQueries({ queryKey: ['account-deletion'] })
    },
    onError: (error) => {
      setConfirmOpen(false)
      toast.error(describeApiError(error))
    },
  })

  const cancelRequest = useMutation({
    mutationFn: (id: string) => api.cancelAccountDeletion(id),
    onSuccess: () => {
      toast.success('Запрос отменён')
      void queryClient.invalidateQueries({ queryKey: ['account-deletion'] })
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const warnings = [
    'Будут удалены имя, email, телефон, аватар, профиль, активные сессии и устройства.',
    'Учебная статистика и материалы могут сохраниться в обезличенном виде.',
    'Расчёты, налоговые документы и журналы безопасности сохраняются в обязательном объёме.',
  ]

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Удаление аккаунта по запросу</Text>
        {warnings.map((warning) => (
          <View key={warning} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>{warning}</Text>
          </View>
        ))}
      </Card>

      {requests.isLoading ? <Text style={styles.muted}>Загрузка истории…</Text> : null}
      {requests.error ? (
        <Text style={styles.error}>{describeApiError(requests.error)}</Text>
      ) : null}

      {pending ? (
        <Card>
          <Badge label="На рассмотрении" tone="warning" />
          <Text style={styles.blockTitle}>Запрос уже отправлен</Text>
          <Text style={styles.muted}>
            {new Date(pending.requestedAt).toLocaleString('ru-RU')}. Администратор проверит запрос;
            история обработки сохранится в аккаунте.
          </Text>
          <Button
            title="Отменить запрос"
            variant="secondary"
            loading={cancelRequest.isPending}
            onPress={() => cancelRequest.mutate(pending.id)}
          />
        </Card>
      ) : (
        <Card>
          <Text style={styles.blockTitle}>Почему вы хотите удалить аккаунт?</Text>
          <TextArea
            label="Причина (необязательно)"
            value={reason}
            onChangeText={setReason}
            maxLength={2000}
            placeholder="Коротко опишите причину"
          />
          <Button
            title="Подать запрос на удаление"
            variant="danger"
            onPress={() => setConfirmOpen(true)}
          />
          <Button title="Отмена" variant="ghost" onPress={() => router.back()} />
        </Card>
      )}

      {(requests.data ?? []).length > 0 ? (
        <Card>
          <Text style={styles.blockTitle}>История запросов</Text>
          {(requests.data ?? []).map((request) => (
            <View key={request.id} style={styles.historyItem}>
              <View style={styles.historyHead}>
                <Text style={styles.historyDate}>
                  {new Date(request.requestedAt).toLocaleString('ru-RU')}
                </Text>
                <Badge
                  label={statusLabels[request.status] ?? request.status}
                  tone={
                    request.status === 'APPROVED'
                      ? 'success'
                      : request.status === 'REJECTED'
                        ? 'danger'
                        : 'neutral'
                  }
                />
              </View>
              {request.reason ? <Text style={styles.muted}>Причина: {request.reason}</Text> : null}
              {request.events.map((event) => (
                <Text key={event.id} style={styles.event}>
                  {new Date(event.createdAt).toLocaleString('ru-RU')} —{' '}
                  {statusLabels[event.status] ?? event.status}
                  {event.comment ? `: ${event.comment}` : ''}
                </Text>
              ))}
            </View>
          ))}
        </Card>
      ) : null}

      <ConfirmationDialog
        visible={confirmOpen}
        title="Отправить запрос на удаление?"
        description="Аккаунт не удалится мгновенно: администратор рассмотрит запрос. Обязательные по закону сведения сохранятся."
        confirmLabel="Отправить запрос"
        destructive
        loading={createRequest.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => createRequest.mutate()}
      />
    </ScrollView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    title: { fontSize: typography.h2, fontWeight: '800', color: c.danger, marginBottom: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    bullet: { fontSize: typography.body, color: c.danger, fontWeight: '800' },
    text: { flex: 1, fontSize: typography.body, color: c.text, lineHeight: 22 },
    blockTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginBottom: spacing.sm },
    muted: { fontSize: typography.caption, color: c.textMuted, lineHeight: 19, marginBottom: spacing.sm },
    error: { fontSize: typography.caption, color: c.danger },
    historyItem: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingVertical: spacing.sm },
    historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    historyDate: { fontSize: typography.caption, fontWeight: '700', color: c.text },
    event: { fontSize: typography.tiny, color: c.textMuted, lineHeight: 17 },
  })
