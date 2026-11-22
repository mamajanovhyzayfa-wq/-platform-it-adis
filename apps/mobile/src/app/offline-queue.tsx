import { useState } from 'react'
import { Alert, Share, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Badge, Button, Card, EmptyState, Screen, useToast } from '@/components/ui'
import { useOffline } from '@/offline/OfflineSyncProvider'
import { discardConflict, retryQueueItem, type QueueItem } from '@/offline/queue'
import { saveHomeworkDraft } from '@/offline/drafts'
import { radius, spacing, typography, useThemedStyles, type Palette } from '@/theme'
import { formatFullDate, formatTime } from '@/utils/format'

function operationLabel(item: QueueItem): string {
  if (item.operation.type === 'homework-submit') return 'Решение задания'
  if (item.operation.type === 'lesson-progress') return 'Прогресс урока'
  return 'Сообщение'
}

function operationPreview(item: QueueItem): string {
  const operation = item.operation
  if (operation.type === 'homework-submit') {
    const parts = [
      operation.payload.text?.trim(),
      operation.payload.projectUrl?.trim(),
      ...(operation.payload.files ?? []).map((file) => `📎 ${file.name}: ${file.url}`),
    ].filter(Boolean)
    return parts.join('\n\n') || 'Решение без текста и ссылок'
  }
  if (operation.type === 'lesson-progress') {
    const seconds = Math.max(0, Math.round(operation.positionSeconds))
    return `Позиция просмотра: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  const attachments = operation.attachments?.length
    ? `\n\nВложения: ${operation.attachments.map((file) => file.name).join(', ')}`
    : ''
  return `${operation.body}${attachments}`
}

/**
 * Очередь офлайн-действий. Конфликт не удаляет локальную копию: решение можно
 * вернуть в черновик и отправить заново, сообщение — передать в другое приложение,
 * а прогресс или запрос — повторить после устранения причины отказа.
 */
export default function OfflineQueueScreen() {
  const router = useRouter()
  const toast = useToast()
  const styles = useThemedStyles(makeStyles)
  const offline = useOffline()
  const [busyId, setBusyId] = useState<string | null>(null)

  const retry = async (item: QueueItem) => {
    setBusyId(item.id)
    try {
      await retryQueueItem(item.id)
      if (offline.online === false) {
        toast.show({
          message: 'Нет сети. Действие останется в очереди и отправится после подключения.',
          tone: 'warning',
        })
        return
      }
      await offline.syncNow()
    } finally {
      setBusyId(null)
    }
  }

  const recoverHomework = async (item: QueueItem) => {
    if (item.operation.type !== 'homework-submit') return
    const { homeworkId, payload } = item.operation
    setBusyId(item.id)
    try {
      await saveHomeworkDraft(homeworkId, {
        text: payload.text ?? '',
        projectUrl: payload.projectUrl ?? '',
        files: payload.files ?? [],
      })
      await discardConflict(item.id)
      toast.success('Текст решения перенесён в черновик задания')
      router.push({ pathname: '/homework/[id]', params: { id: homeworkId } })
    } finally {
      setBusyId(null)
    }
  }

  const shareMessage = async (item: QueueItem) => {
    if (item.operation.type !== 'message-send') return
    const attachments = item.operation.attachments?.length
      ? `\n\nВложения:\n${item.operation.attachments
          .map((file) => `${file.name}: ${file.url}`)
          .join('\n')}`
      : ''
    try {
      await Share.share({
        title: 'Сообщение из IT Adis',
        message: `${item.operation.body}${attachments}`,
      })
    } catch {
      toast.error('Не удалось открыть меню «Поделиться»')
    }
  }

  const remove = (item: QueueItem) => {
    Alert.alert(
      'Удалить локальную копию?',
      'Копия исчезнет с устройства. Сначала перенесите нужный текст в черновик или другое приложение.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void discardConflict(item.id)
          },
        },
      ],
    )
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Офлайн-очередь' }} />

      <Card>
        <Text style={styles.lead}>
          Здесь хранятся действия, созданные без интернета. После восстановления связи они отправляются
          автоматически. Если сервер отклонил изменение, локальная копия остаётся — её можно разобрать вручную.
        </Text>
        <View style={styles.summary}>
          <Badge label={`В очереди: ${offline.pending}`} tone="primary" />
          <Badge label={`Конфликтов: ${offline.conflicts}`} tone={offline.conflicts > 0 ? 'danger' : 'neutral'} />
          <Badge
            label={offline.online === false ? 'Нет сети' : offline.syncing ? 'Синхронизация' : 'Сеть есть'}
            tone={offline.online === false ? 'warning' : 'success'}
          />
        </View>
        {offline.pending > 0 ? (
          <Button
            title="Синхронизировать сейчас"
            variant="secondary"
            loading={offline.syncing}
            onPress={() => void offline.syncNow()}
            style={styles.syncButton}
          />
        ) : null}
      </Card>

      {offline.items.length === 0 ? (
        <EmptyState
          icon="✓"
          title="Очередь пуста"
          hint="Неотправленных решений, сообщений и изменений прогресса нет."
        />
      ) : (
        offline.items.map((item) => {
          const isConflict = item.status === 'conflict'
          return (
            <Card key={item.id}>
              <View style={styles.row}>
                <Text style={styles.title}>{operationLabel(item)}</Text>
                <Badge
                  label={isConflict ? 'Конфликт' : 'Ждёт отправки'}
                  tone={isConflict ? 'danger' : 'warning'}
                />
              </View>
              <Text style={styles.meta}>
                Создано {formatFullDate(item.createdAt)}, {formatTime(item.createdAt)}
                {item.attempts > 0 ? ` · попыток: ${item.attempts}` : ''}
              </Text>

              <View style={styles.preview}>
                <Text style={styles.previewText} selectable>
                  {operationPreview(item)}
                </Text>
              </View>

              {isConflict ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Причина отказа</Text>
                  <Text style={styles.errorText}>{item.lastError ?? 'Сервер отклонил изменение'}</Text>
                  <Text style={styles.errorHint}>
                    Основной считается серверная версия. Локальная копия сохранена и не удаляется автоматически.
                  </Text>
                </View>
              ) : null}

              {isConflict && item.operation.type === 'homework-submit' ? (
                <Button
                  title="Перенести в черновик"
                  variant="secondary"
                  loading={busyId === item.id}
                  onPress={() => void recoverHomework(item)}
                  style={styles.action}
                />
              ) : null}

              {isConflict && item.operation.type === 'message-send' ? (
                <Button
                  title="Поделиться текстом"
                  variant="secondary"
                  onPress={() => void shareMessage(item)}
                  style={styles.action}
                />
              ) : null}

              {isConflict ? (
                <Button
                  title="Повторить отправку"
                  loading={busyId === item.id}
                  onPress={() => void retry(item)}
                  style={styles.action}
                />
              ) : null}

              <Button
                title="Удалить копию"
                variant="ghost"
                onPress={() => remove(item)}
                style={styles.action}
              />
            </Card>
          )
        })
      )}
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    lead: { fontSize: typography.body, color: c.textMuted, lineHeight: 21 },
    summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
    syncButton: { marginTop: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    title: { flex: 1, fontSize: typography.h2, fontWeight: '800', color: c.text },
    meta: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xs },
    preview: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.cardMuted,
    },
    previewText: { fontSize: typography.body, color: c.text, lineHeight: 21 },
    errorBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.dangerSoft,
      gap: 2,
    },
    errorTitle: { fontSize: typography.tiny, fontWeight: '800', color: c.danger, textTransform: 'uppercase' },
    errorText: { fontSize: typography.caption, color: c.text, lineHeight: 19 },
    errorHint: { fontSize: typography.tiny, color: c.textMuted, lineHeight: 17, marginTop: spacing.xs },
    action: { marginTop: spacing.sm },
  })
