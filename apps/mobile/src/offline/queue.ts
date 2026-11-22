import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'
import { api, type ChatAttachment } from '@/api/api'
import { getAccessToken } from '@/api/session'
import type { HomeworkSubmitInput } from '@/api/api'

/**
 * Очередь действий, созданных без интернета.
 *
 * Конфликты не удаляют пользовательские данные: элемент остаётся в очереди
 * со статусом `conflict`, а серверная версия считается основной. Для домашних
 * работ idempotencyKey защищает от повторной отправки при обрыве ответа.
 */
export type QueueOperation =
  | { type: 'homework-submit'; homeworkId: string; payload: HomeworkSubmitInput }
  | { type: 'lesson-progress'; lessonId: string; positionSeconds: number }
  | { type: 'message-send'; conversationId: string; body: string; attachments?: ChatAttachment[] }

export interface QueueItem {
  id: string
  operation: QueueOperation
  createdAt: string
  attempts: number
  status: 'pending' | 'conflict'
  lastError?: string
}

const KEY = 'itadis.offline.queue'
const listeners = new Set<(items: QueueItem[]) => void>()

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function notify(items: QueueItem[]) {
  for (const listener of listeners) listener(items)
}

export function subscribeQueue(listener: (items: QueueItem[]) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function readQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as QueueItem[]) : []
  } catch {
    return []
  }
}

async function writeQueue(items: QueueItem[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items))
  notify(items)
}

function matching(a: QueueOperation, b: QueueOperation) {
  if (a.type !== b.type) return false
  if (a.type === 'homework-submit' && b.type === 'homework-submit') {
    return a.homeworkId === b.homeworkId && a.payload.idempotencyKey === b.payload.idempotencyKey
  }
  if (a.type === 'lesson-progress' && b.type === 'lesson-progress') return a.lessonId === b.lessonId
  if (a.type === 'message-send' && b.type === 'message-send') {
    return a.conversationId === b.conversationId && a.body === b.body
  }
  return false
}

export async function enqueue(operation: QueueOperation): Promise<QueueItem> {
  const current = await readQueue()
  // Повторное нажатие не должно создавать дубль; прогресс урока заменяем последней позицией.
  const existing = current.find((item) => item.status === 'pending' && matching(item.operation, operation))
  if (existing) {
    existing.operation = operation
    existing.createdAt = new Date().toISOString()
    await writeQueue([...current])
    return existing
  }
  const item: QueueItem = {
    id: uid(),
    operation,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  }
  await writeQueue([...current, item])
  return item
}

export async function clearQueue() {
  await writeQueue([])
}

export async function removeQueueItem(id: string) {
  await writeQueue((await readQueue()).filter((item) => item.id !== id))
}

export async function discardConflict(id: string) {
  await removeQueueItem(id)
}

/** Возвращает конфликт в очередь после того, как пользователь решил повторить отправку. */
export async function retryQueueItem(id: string) {
  const items = await readQueue()
  const item = items.find((entry) => entry.id === id)
  if (!item || item.status !== 'conflict') return
  item.status = 'pending'
  item.attempts = 0
  item.lastError = undefined
  await writeQueue([...items])
}

function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response
}

export interface FlushResult {
  sent: number
  conflicts: number
  remaining: number
  offline: boolean
}

/** Отправляет очередь по порядку. При обрыве сети останавливается и сохраняет всё. */
export async function flushQueue(): Promise<FlushResult> {
  if (!getAccessToken()) return { sent: 0, conflicts: 0, remaining: 0, offline: true }

  let items = await readQueue()
  let sent = 0
  let conflicts = 0
  let offline = false

  for (const item of items.filter((entry) => entry.status === 'pending')) {
    try {
      const operation = item.operation
      if (operation.type === 'homework-submit') {
        await api.submitHomework(operation.homeworkId, operation.payload)
      } else if (operation.type === 'lesson-progress') {
        await api.saveLessonProgress(operation.lessonId, operation.positionSeconds)
      } else {
        await api.sendMessage(operation.conversationId, operation.body, operation.attachments)
      }
      items = items.filter((entry) => entry.id !== item.id)
      sent += 1
      await writeQueue(items)
    } catch (error) {
      if (isNetworkError(error)) {
        offline = true
        break
      }
      // 409/422 и прочие серверные отказы: не теряем содержимое, помечаем конфликт.
      item.status = 'conflict'
      item.attempts += 1
      item.lastError =
        axios.isAxiosError(error) && error.response?.data
          ? String((error.response.data as { error?: { message?: string } }).error?.message ?? error.message)
          : error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать'
      conflicts += 1
      await writeQueue(items)
    }
  }

  return { sent, conflicts, remaining: items.length, offline }
}
