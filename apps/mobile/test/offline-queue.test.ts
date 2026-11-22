import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __store } from './async-storage-mock.js'

const mocks = vi.hoisted(() => ({
  submitHomework: vi.fn(),
  saveLessonProgress: vi.fn(),
  sendMessage: vi.fn(),
  token: { value: 'access-token' as string | null },
}))

vi.mock('@/api/api', () => ({
  api: {
    submitHomework: mocks.submitHomework,
    saveLessonProgress: mocks.saveLessonProgress,
    sendMessage: mocks.sendMessage,
  },
}))

vi.mock('@/api/session', () => ({
  getAccessToken: () => mocks.token.value,
}))

import {
  clearQueue,
  enqueue,
  flushQueue,
  readQueue,
  retryQueueItem,
  subscribeQueue,
} from '@/offline/queue'

const homework = (idempotencyKey: string, text = 'Решение') => ({
  type: 'homework-submit' as const,
  homeworkId: 'hw-1',
  payload: { text, idempotencyKey },
})

beforeEach(async () => {
  __store.clear()
  mocks.submitHomework.mockReset()
  mocks.saveLessonProgress.mockReset()
  mocks.sendMessage.mockReset()
  mocks.token.value = 'access-token'
  await clearQueue()
})

describe('офлайн-очередь: добавление', () => {
  it('не создаёт дубль при повторной отправке той же работы', async () => {
    const first = await enqueue(homework('key-1', 'Первая версия'))
    const second = await enqueue(homework('key-1', 'Исправленная версия'))

    const items = await readQueue()
    expect(items).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(items[0]?.operation).toMatchObject({
      type: 'homework-submit',
      payload: { text: 'Исправленная версия' },
    })
  })

  it('разные ключи идемпотентности — разные элементы', async () => {
    await enqueue(homework('key-1'))
    await enqueue(homework('key-2'))
    expect(await readQueue()).toHaveLength(2)
  })

  it('заменяет прогресс урока последней позицией', async () => {
    await enqueue({ type: 'lesson-progress', lessonId: 'lesson-1', positionSeconds: 10 })
    await enqueue({ type: 'lesson-progress', lessonId: 'lesson-1', positionSeconds: 95 })

    const items = await readQueue()
    expect(items).toHaveLength(1)
    expect(items[0]?.operation).toEqual({
      type: 'lesson-progress',
      lessonId: 'lesson-1',
      positionSeconds: 95,
    })
  })

  it('дедуплицирует одинаковые сообщения, но не разные', async () => {
    await enqueue({ type: 'message-send', conversationId: 'c-1', body: 'Привет' })
    await enqueue({ type: 'message-send', conversationId: 'c-1', body: 'Привет' })
    await enqueue({ type: 'message-send', conversationId: 'c-1', body: 'Другое' })

    expect(await readQueue()).toHaveLength(2)
  })

  it('уведомляет подписчиков и отписывает их', async () => {
    const seen: number[] = []
    const unsubscribe = subscribeQueue((items) => seen.push(items.length))

    await enqueue(homework('key-1'))
    await enqueue(homework('key-2'))
    unsubscribe()
    await enqueue(homework('key-3'))

    expect(seen).toEqual([1, 2])
  })
})

describe('офлайн-очередь: синхронизация', () => {
  it('без токена не отправляет и сообщает об офлайне', async () => {
    mocks.token.value = null
    await enqueue(homework('key-1'))

    const result = await flushQueue()
    expect(result).toEqual({ sent: 0, conflicts: 0, remaining: 0, offline: true })
    expect(mocks.submitHomework).not.toHaveBeenCalled()
    expect(await readQueue()).toHaveLength(1)
  })

  it('успешная отправка удаляет элемент из очереди', async () => {
    mocks.submitHomework.mockResolvedValue({ id: 'submission-1' })
    await enqueue(homework('key-1'))
    await enqueue({ type: 'lesson-progress', lessonId: 'lesson-1', positionSeconds: 42 })

    const result = await flushQueue()
    expect(result).toEqual({ sent: 2, conflicts: 0, remaining: 0, offline: false })
    expect(await readQueue()).toEqual([])
    expect(mocks.submitHomework).toHaveBeenCalledWith('hw-1', {
      text: 'Решение',
      idempotencyKey: 'key-1',
    })
    expect(mocks.saveLessonProgress).toHaveBeenCalledWith('lesson-1', 42)
  })

  it('серверный отказ сохраняет данные как конфликт и не теряет элемент', async () => {
    mocks.submitHomework.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 422',
      response: { status: 422, data: { error: { message: 'Срок сдачи задания истёк' } } },
    })
    await enqueue(homework('key-1'))

    const result = await flushQueue()
    expect(result).toEqual({ sent: 0, conflicts: 1, remaining: 1, offline: false })

    const items = await readQueue()
    expect(items[0]).toMatchObject({
      status: 'conflict',
      attempts: 1,
      lastError: 'Срок сдачи задания истёк',
    })

    // Конфликт не отправляется повторно автоматически.
    const again = await flushQueue()
    expect(again).toEqual({ sent: 0, conflicts: 0, remaining: 1, offline: false })
    expect(mocks.submitHomework).toHaveBeenCalledTimes(1)
  })

  it('разбор конфликта возвращает действие в очередь и отправляет его повторно', async () => {
    mocks.submitHomework.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 422',
      response: { status: 422, data: { error: { message: 'Работа уже принята' } } },
    })
    await enqueue(homework('key-1'))
    await flushQueue()

    const conflicted = (await readQueue())[0]
    expect(conflicted?.status).toBe('conflict')

    mocks.submitHomework.mockResolvedValue({ id: 'submission-2' })
    await retryQueueItem(conflicted!.id)
    expect((await readQueue())[0]?.status).toBe('pending')

    const result = await flushQueue()
    expect(result).toEqual({ sent: 1, conflicts: 0, remaining: 0, offline: false })
    expect(await readQueue()).toEqual([])
  })

  it('обрыв сети останавливает очередь и сохраняет оставшиеся действия', async () => {
    mocks.submitHomework.mockResolvedValue({ id: 'submission-1' })
    mocks.saveLessonProgress.mockRejectedValue({
      isAxiosError: true,
      message: 'Network Error',
    })
    await enqueue(homework('key-1'))
    await enqueue({ type: 'lesson-progress', lessonId: 'lesson-1', positionSeconds: 42 })

    const result = await flushQueue()
    expect(result).toEqual({ sent: 1, conflicts: 0, remaining: 1, offline: true })

    const items = await readQueue()
    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe('pending')
    expect(items[0]?.attempts).toBe(0)
  })

  it('сетевая ошибка не помечает действие конфликтом', async () => {
    mocks.sendMessage.mockRejectedValue({ isAxiosError: true, message: 'timeout of 15000ms exceeded' })
    await enqueue({ type: 'message-send', conversationId: 'c-1', body: 'Текст' })

    const result = await flushQueue()
    expect(result.offline).toBe(true)
    expect((await readQueue())[0]?.status).toBe('pending')
  })
})
