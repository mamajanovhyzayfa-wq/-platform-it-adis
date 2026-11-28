import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { Logger } from '@nestjs/common'
import { env } from '../config/env.js'

const logger = new Logger('Redis')

/**
 * Redis используется для общего кеша между экземплярами API и распределённых
 * блокировок фоновых задач (например, backup филиала). Приложение остаётся
 * работоспособным без Redis: кеш и блокировки переходят в память процесса,
 * но в production REDIS_URL обязателен для корректной работы нескольких реплик.
 */
let client: Redis | null = null
let initialized = false
let unavailableUntil = 0

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null
  // Не пытаемся переподключаться на каждом запросе, если Redis недоступен.
  if (Date.now() < unavailableUntil) return null
  if (initialized) return client
  initialized = true
  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  })
  client.on('error', (error: Error) => {
    unavailableUntil = Date.now() + 60_000
    logger.warn(`Redis недоступен: ${error.message}`)
  })
  return client
}

export async function redisHealth(): Promise<'up' | 'down' | 'disabled'> {
  if (!env.REDIS_URL) return 'disabled'
  const redis = getRedis()
  // URL задан, но клиент временно не создаётся после сетевой ошибки — это down.
  if (!redis) return 'down'
  try {
    if (redis.status === 'wait') await redis.connect()
    const pong = await redis.ping()
    return pong === 'PONG' ? 'up' : 'down'
  } catch {
    return 'down'
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    if (redis.status === 'wait') await redis.connect()
    const value = await redis.get(key)
    return value ? (JSON.parse(value) as T) : null
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    if (redis.status === 'wait') await redis.connect()
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Кеш не должен ломать основной сценарий.
  }
}

export async function cacheDelete(key: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    if (redis.status === 'wait') await redis.connect()
    await redis.del(key)
  } catch {
    // ignore
  }
}

const localLocks = new Map<string, number>()

/**
 * Выполняет fn только если удалось взять блокировку. В Redis — SET NX PX,
 * без Redis — внутрипроцессная карта с истечением. Возвращает null, если
 * задачу уже выполняет другой экземпляр.
 */
export async function withDistributedLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `itadis:lock:${name}`
  const token = randomUUID()
  const redis = getRedis()

  if (redis) {
    try {
      if (redis.status === 'wait') await redis.connect()
      const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX')
      if (acquired !== 'OK') return null
      try {
        return await fn()
      } finally {
        await redis
          .eval(
            'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
            1,
            key,
            token,
          )
          .catch(() => undefined)
      }
    } catch {
      // Redis временно недоступен — используем локальную блокировку.
    }
  }

  const now = Date.now()
  const existing = localLocks.get(name)
  if (existing && existing > now) return null
  localLocks.set(name, now + ttlMs)
  try {
    return await fn()
  } finally {
    if (localLocks.get(name) === now + ttlMs) localLocks.delete(name)
  }
}
