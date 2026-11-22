import { beforeEach, describe, expect, it } from 'vitest'
import { __store } from './async-storage-mock.js'
import { cacheResponse, clearOfflineCache, readCachedResponse } from '@/offline/cache'
import {
  clearHomeworkDraft,
  loadHomeworkDraft,
  saveHomeworkDraft,
} from '@/offline/drafts'

function config(url: string, method = 'get', params?: Record<string, unknown>) {
  return { url, method, params } as never
}

function response(data: unknown, status = 200) {
  return { data, status } as never
}

beforeEach(() => {
  __store.clear()
})

describe('офлайн-кэш GET-ответов', () => {
  it('сохраняет и возвращает разрешённый раздел', async () => {
    await cacheResponse(config('/courses', 'get', { page: 1 }), response({ items: [{ id: 'c-1' }] }))

    const cached = await readCachedResponse(config('/courses', 'get', { page: 1 }))
    expect(cached?.status).toBe(200)
    expect(cached?.statusText).toBe('OFFLINE CACHE')
    expect(cached?.data).toEqual({ items: [{ id: 'c-1' }] })
  })

  it('разные параметры — разные записи кэша', async () => {
    await cacheResponse(config('/courses', 'get', { page: 1 }), response({ items: [1] }))
    await cacheResponse(config('/courses', 'get', { page: 2 }), response({ items: [2] }))

    const first = await readCachedResponse(config('/courses', 'get', { page: 1 }))
    const second = await readCachedResponse(config('/courses', 'get', { page: 2 }))
    expect(first?.data).toEqual({ items: [1] })
    expect(second?.data).toEqual({ items: [2] })
  })

  it('не кэширует POST и служебные разделы', async () => {
    await cacheResponse(config('/courses', 'post'), response({ ok: true }))
    await cacheResponse(config('/payments', 'get'), response({ ok: true }))
    await cacheResponse(config('/users/me', 'get'), response({ id: 'u-1' }))

    expect(await readCachedResponse(config('/courses', 'post'))).toBeNull()
    expect(await readCachedResponse(config('/payments', 'get'))).toBeNull()
    expect(await readCachedResponse(config('/users/me', 'get'))).not.toBeNull()
  })

  it('вытесняет старые записи после лимита', async () => {
    for (let index = 0; index < 125; index += 1) {
      await cacheResponse(config(`/courses?part=${index}`), response({ index }))
    }

    const indexRaw = __store.get('itadis.cache.index')
    expect(indexRaw).toBeTruthy()
    const keys = JSON.parse(indexRaw!) as string[]
    expect(keys).toHaveLength(120)
    expect(__store.has('itadis.cache./courses?part=0?')).toBe(false)
    expect(__store.has('itadis.cache./courses?part=124?')).toBe(true)
  })

  it('очистка удаляет и записи, и индекс', async () => {
    await cacheResponse(config('/homework'), response({ items: [] }))
    await clearOfflineCache()

    expect(await readCachedResponse(config('/homework'))).toBeNull()
    expect(__store.get('itadis.cache.index')).toBeUndefined()
  })
})

describe('черновики домашних работ', () => {
  it('сохраняет черновик с отметкой времени и читает его', async () => {
    await saveHomeworkDraft('hw-1', {
      text: 'Черновик решения',
      projectUrl: 'https://github.com/student/project',
      files: [{ name: 'screenshot.png', url: 'https://cdn.example.com/a.png' }],
    })

    const draft = await loadHomeworkDraft('hw-1')
    expect(draft).toMatchObject({
      text: 'Черновик решения',
      projectUrl: 'https://github.com/student/project',
      files: [{ name: 'screenshot.png', url: 'https://cdn.example.com/a.png' }],
    })
    expect(Number.isNaN(Date.parse(draft!.updatedAt))).toBe(false)
  })

  it('черновики разных заданий независимы', async () => {
    await saveHomeworkDraft('hw-1', { text: 'Первое', projectUrl: '', files: [] })
    await saveHomeworkDraft('hw-2', { text: 'Второе', projectUrl: '', files: [] })

    expect((await loadHomeworkDraft('hw-1'))?.text).toBe('Первое')
    expect((await loadHomeworkDraft('hw-2'))?.text).toBe('Второе')
  })

  it('удаляет черновик после успешной отправки', async () => {
    await saveHomeworkDraft('hw-1', { text: 'Текст', projectUrl: '', files: [] })
    await clearHomeworkDraft('hw-1')
    expect(await loadHomeworkDraft('hw-1')).toBeNull()
  })

  it('повреждённые данные не роняют экран', async () => {
    __store.set('itadis.draft.homework.hw-1', '{не json')
    expect(await loadHomeworkDraft('hw-1')).toBeNull()
  })
})
