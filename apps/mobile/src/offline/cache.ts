import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'

/**
 * Офлайн-кэш GET-ответов. Кэшируются только учебные разделы и собственный
 * профиль, без токенов, платёжных реквизитов и служебных ответов.
 */
const PREFIX = 'itadis.cache.'
const INDEX_KEY = 'itadis.cache.index'
const MAX_ENTRIES = 120

const CACHEABLE = [
  '/users/me',
  '/users/me/courses',
  '/courses',
  '/lessons/',
  '/homework',
  '/tests',
  '/schedule',
  '/notifications',
  '/coins',
  '/shop',
  '/messages/',
  '/knowledge',
  '/achievements',
  '/ai/status',
]

interface CacheEntry {
  savedAt: number
  data: unknown
  status: number
  url: string
}

function isCacheable(config?: InternalAxiosRequestConfig): boolean {
  if (!config || (config.method ?? 'get').toLowerCase() !== 'get') return false
  const url = config.url ?? ''
  return CACHEABLE.some((prefix) => url.startsWith(prefix))
}

function keyFor(config: InternalAxiosRequestConfig): string {
  const params = config.params ? JSON.stringify(config.params) : ''
  return `${PREFIX}${config.url ?? ''}?${params}`
}

async function trimIndex(keys: string[]) {
  if (keys.length <= MAX_ENTRIES) return keys
  const remove = keys.slice(0, keys.length - MAX_ENTRIES)
  await AsyncStorage.multiRemove(remove)
  return keys.slice(remove.length)
}

export async function cacheResponse(config: InternalAxiosRequestConfig, response: AxiosResponse) {
  if (!isCacheable(config)) return
  try {
    const key = keyFor(config)
    const entry: CacheEntry = {
      savedAt: Date.now(),
      data: response.data,
      status: response.status,
      url: config.url ?? '',
    }
    await AsyncStorage.setItem(key, JSON.stringify(entry))
    const raw = await AsyncStorage.getItem(INDEX_KEY)
    const keys = raw ? (JSON.parse(raw) as string[]) : []
    const next = await trimIndex([...keys.filter((item) => item !== key), key])
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next))
  } catch {
    // Кэш не должен влиять на успешный сетевой запрос.
  }
}

/** Возвращает сохранённый ответ в форме AxiosResponse или null. */
export async function readCachedResponse(
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse | null> {
  if (!isCacheable(config)) return null
  try {
    const raw = await AsyncStorage.getItem(keyFor(config))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    return {
      data: entry.data,
      status: entry.status,
      statusText: 'OFFLINE CACHE',
      headers: {},
      config,
      request: undefined,
    }
  } catch {
    return null
  }
}

export async function clearOfflineCache() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY)
    const keys = raw ? (JSON.parse(raw) as string[]) : []
    await AsyncStorage.multiRemove([...keys, INDEX_KEY])
  } catch {
    // ignore
  }
}
