import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'

/**
 * Адаптер видеопровайдера. Все обращения к LiveKit изолированы в этом файле,
 * поэтому заменить провайдера можно, не меняя маршруты и мобильное приложение.
 */
export type LivekitConfig = {
  url: string
  apiKey: string
  apiSecret: string
  egressUrl?: string
}

/** Конфигурация провайдера или null, если видео не настроено. */
function livekitConfig(): LivekitConfig | null {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null
  return {
    url: env.LIVEKIT_URL.replace(/\/$/, ''),
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    egressUrl: env.LIVEKIT_EGRESS_URL?.replace(/\/$/, ''),
  }
}

function requireLivekitConfig(): LivekitConfig {
  const config = livekitConfig()
  if (!config) {
    throw new AppError(
      503,
      'VIDEO_NOT_CONFIGURED',
      'Видеозанятия не настроены: задайте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET на сервере',
    )
  }
  return config
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

type JoinGrantOptions = {
  identity: string
  name: string
  roomName: string
  canPublish?: boolean
  roomAdmin?: boolean
  ttlSeconds?: number
  metadata?: Record<string, unknown>
}

/**
 * Токен участника: срок ограничен сервером, права выдаются по роли.
 * Секрет провайдера в приложение не попадает.
 */
export function buildJoinToken(
  options: JoinGrantOptions,
  config: LivekitConfig = requireLivekitConfig(),
): { token: string; expiresAt: Date } {
  const ttl = Math.max(60, Math.min(options.ttlSeconds ?? 60 * 60, 6 * 60 * 60))
  const issuedAt = nowSeconds()
  const expiresAt = new Date((issuedAt + ttl) * 1000)
  const token = jwt.sign(
    {
      iss: config.apiKey,
      sub: options.identity,
      name: options.name,
      nbf: issuedAt,
      exp: issuedAt + ttl,
      ...(options.metadata ? { metadata: JSON.stringify(options.metadata) } : {}),
      video: {
        roomJoin: true,
        room: options.roomName,
        canPublish: options.canPublish ?? true,
        canSubscribe: true,
        canPublishData: true,
        roomAdmin: options.roomAdmin ?? false,
      },
    },
    config.apiSecret,
    { algorithm: 'HS256' },
  )
  return { token, expiresAt }
}

type WebhookEvent = {
  event: string
  room?: { name?: string; sid?: string }
  participant?: { identity?: string; name?: string }
  egressInfo?: {
    egressId?: string
    status?: string
    file?: { location?: string }
    fileResults?: Array<{ location?: string }>
  }
}

/**
 * LiveKit подписывает вебхуки JWT-токеном с хешем тела в claim `sha256`.
 * Проверяем подпись и совпадение хеша, чтобы события нельзя было подделать.
 */
export function verifyWebhook(rawBody: Buffer, authorization: string | undefined, config: LivekitConfig): WebhookEvent {
  if (!authorization) throw new AppError(401, 'INVALID_WEBHOOK', 'Не передан заголовок Authorization')

  const token = authorization.replace(/^Bearer\s+/i, '')
  let payload: { sha256?: string }
  try {
    payload = jwt.verify(token, config.apiSecret, { algorithms: ['HS256'], issuer: config.apiKey }) as { sha256?: string }
  } catch {
    throw new AppError(401, 'INVALID_WEBHOOK', 'Подпись вебхука недействительна')
  }

  const expected = crypto.createHash('sha256').update(rawBody).digest('base64')
  const actual = payload.sha256 ?? ''
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new AppError(401, 'INVALID_WEBHOOK', 'Хеш тела вебхука не совпадает')
  }

  try {
    return JSON.parse(rawBody.toString('utf8')) as WebhookEvent
  } catch {
    throw new AppError(400, 'INVALID_WEBHOOK', 'Тело вебхука не является JSON')
  }
}
