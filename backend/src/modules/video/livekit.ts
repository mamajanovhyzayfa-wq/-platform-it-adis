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

export type S3Config = {
  accessKey: string
  secret: string
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle: boolean
}

/** Конфигурация провайдера или null, если видео не настроено. */
export function livekitConfig(): LivekitConfig | null {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null
  return {
    url: env.LIVEKIT_URL.replace(/\/$/, ''),
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    egressUrl: env.LIVEKIT_EGRESS_URL?.replace(/\/$/, ''),
  }
}

export function isVideoConfigured(): boolean {
  return livekitConfig() !== null
}

export function requireLivekitConfig(): LivekitConfig {
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

/** Хранилище записей (S3-совместимое) или null, если запись недоступна. */
export function recordingStorage(): S3Config | null {
  const { RECORDING_S3_ACCESS_KEY, RECORDING_S3_SECRET, RECORDING_S3_BUCKET, RECORDING_S3_REGION } = env
  if (!RECORDING_S3_ACCESS_KEY || !RECORDING_S3_SECRET || !RECORDING_S3_BUCKET || !RECORDING_S3_REGION) return null
  return {
    accessKey: RECORDING_S3_ACCESS_KEY,
    secret: RECORDING_S3_SECRET,
    bucket: RECORDING_S3_BUCKET,
    region: RECORDING_S3_REGION,
    endpoint: env.RECORDING_S3_ENDPOINT,
    forcePathStyle: env.RECORDING_S3_FORCE_PATH_STYLE ?? false,
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function serverToken(config: LivekitConfig, video: Record<string, unknown>, ttlSeconds = 600): string {
  const issuedAt = nowSeconds()
  return jwt.sign(
    { iss: config.apiKey, sub: config.apiKey, nbf: issuedAt, exp: issuedAt + ttlSeconds, video },
    config.apiSecret,
    { algorithm: 'HS256' },
  )
}

export type JoinGrantOptions = {
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

type TwirpResponse = Record<string, unknown> & { info?: Record<string, unknown> }

async function callTwirp(
  config: LivekitConfig,
  path: string,
  body: Record<string, unknown>,
  grant: Record<string, unknown>,
  useEgress = false,
): Promise<TwirpResponse> {
  const base = useEgress ? (config.egressUrl ?? config.url) : config.url
  const response = await fetch(`${base}/twirp/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serverToken(config, grant)}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new AppError(502, 'VIDEO_PROVIDER_ERROR', `Видеопровайдер вернул ошибку ${response.status}: ${text.slice(0, 200)}`)
  }

  return (await response.json()) as TwirpResponse
}

/** Комната создаётся на стороне провайдера; повторное создание считается успехом. */
export async function createProviderRoom(roomName: string): Promise<void> {
  const config = requireLivekitConfig()
  try {
    await callTwirp(
      config,
      'livekit.RoomService/CreateRoom',
      { name: roomName, emptyTimeout: 300, departureTimeout: 60, maxParticipants: 50 },
      { roomCreate: true },
    )
  } catch (error) {
    if (error instanceof AppError && /already exists/i.test(error.message)) return
    throw error
  }
}

export async function deleteProviderRoom(roomName: string): Promise<void> {
  const config = livekitConfig()
  if (!config) return
  try {
    await callTwirp(config, 'livekit.RoomService/DeleteRoom', { room: roomName }, { roomAdmin: true, room: roomName })
  } catch (error) {
    if (error instanceof AppError && /not found/i.test(error.message)) return
    throw error
  }
}

/** Запись занятия: серверный egress провайдера, файл кладётся в S3-хранилище. */
export async function startRoomRecording(roomName: string): Promise<string> {
  const config = requireLivekitConfig()
  const storage = recordingStorage()
  if (!storage) {
    throw new AppError(
      503,
      'RECORDING_NOT_CONFIGURED',
      'Запись недоступна: задайте RECORDING_S3_ACCESS_KEY, RECORDING_S3_SECRET, RECORDING_S3_BUCKET и RECORDING_S3_REGION',
    )
  }

  const result = await callTwirp(
    config,
    'livekit.Egress/StartRoomCompositeEgress',
    {
      roomName,
      layout: 'grid',
      audioOnly: false,
      fileOutputs: [
        {
          fileType: 'MP4',
          filepath: `${roomName}-${Date.now()}.mp4`,
          s3: {
            accessKey: storage.accessKey,
            secret: storage.secret,
            bucket: storage.bucket,
            region: storage.region,
            ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
            forcePathStyle: storage.forcePathStyle,
          },
        },
      ],
    },
    { roomRecord: true, room: roomName },
    true,
  )

  const info = (result.info ?? result) as { egressId?: string }
  if (!info.egressId) {
    throw new AppError(502, 'VIDEO_PROVIDER_ERROR', 'Провайдер не вернул идентификатор записи')
  }
  return info.egressId
}

export async function stopRoomRecording(egressId: string): Promise<void> {
  const config = requireLivekitConfig()
  await callTwirp(config, 'livekit.Egress/StopEgress', { egressId }, { roomRecord: true }, true)
}

export type WebhookEvent = {
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
