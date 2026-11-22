import crypto from 'node:crypto'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'

/**
 * LiveDigital — единственный видеопровайдер платформы.
 *
 * Интеграция построена по официальной документации Moodhood API:
 * https://docs.livedigital.space/docs/moodhood-api/v1/livedigital-api
 *
 * Используются документированные вызовы:
 * - POST /spaces/:spaceId/rooms — создание комнаты (`CreateRoomParams`);
 * - POST /spaces/:spaceId/participants — участник (`name`, `roomId`, `role`, `clientUniqueId`);
 * - POST /spaces/:spaceId/participants/:participantId/signaling-token — токен входа;
 * - POST /spaces/:spaceId/rooms/:roomId/records/start|stop — облачная запись;
 * - GET  /spaces/:spaceId/rooms/:roomId/records — записи комнаты;
 * - GET  /spaces/:spaceId/rooms/:roomId/records/download/:recordId — ссылка на файл;
 * - GET  /spaces/:spaceId/analytics/calls и /analytics/report — аналитика;
 * - GET  /plans/current — фактический тариф пространства;
 * - POST /spaces/:spaceId/rooms/:roomId/finish-call — завершение звонка для всех.
 *
 * В документации уже есть `POST /calls/join-credentials`, который заменяет
 * цепочку participant + signaling-token. У этого метода пока не опубликована
 * схема тела запроса, поэтому используется документированный резервный поток.
 * Роль `audience` в LiveDigital не может публиковать камеру и микрофон, поэтому
 * участники занятия входят как `host`; права наставника проверяются на backend.
 *
 * Вебхуки подписываются HMAC-SHA256 по `JSON.stringify(body)` секретом space.
 */

export type LiveDigitalConfig = {
  apiUrl: string
  spaceId: string
  token: string
  webhookSecret?: string
}

export type LiveDigitalRoom = {
  id: string
  alias?: string
  name: string
  spaceId?: string
  isRecordAllowed?: boolean
  isAutoRecordingAllowed?: boolean
}

export type LiveDigitalParticipant = {
  id: string
  name?: string
  roomId?: string
  role?: 'host' | 'audience'
}

export type LiveDigitalRecord = {
  id: string
  name?: string
  roomId?: string
  spaceId?: string
  callId?: string
  state?: string
  fileSize?: number
  /** Длительность в миллисекундах — так её возвращает Moodhood API. */
  duration?: number
  startedAt?: string
  stoppedAt?: string
  finishedAt?: string
  createdAt?: string
  publicationStatus?: string
}

export type LiveDigitalWebhookPayload = {
  eventName?: string
  roomId?: string
  spaceId?: string
  recordId?: string
  callId?: string
}

export type LiveDigitalPlan = {
  id: string
  name: string
  alias: string
  features?: {
    cloudRecording?: boolean
    chat?: boolean
    callsAnalytics?: boolean
    extendedAnalytics?: boolean
    transcribationTranscribeAudioTracks?: boolean
    transcribationMakeSummary?: boolean
  }
  restrictions?: Record<string, { enabled: boolean; value: number } | undefined>
}

export function liveDigitalConfig(): LiveDigitalConfig | null {
  if (!env.LIVEDIGITAL_API_TOKEN || !env.LIVEDIGITAL_SPACE_ID) return null
  return {
    apiUrl: env.LIVEDIGITAL_API_URL.replace(/\/$/, ''),
    spaceId: env.LIVEDIGITAL_SPACE_ID,
    token: env.LIVEDIGITAL_API_TOKEN,
    webhookSecret: env.LIVEDIGITAL_WEBHOOK_SECRET,
  }
}

export function isLiveDigitalConfigured(): boolean {
  return liveDigitalConfig() !== null
}

export function requireLiveDigitalConfig(): LiveDigitalConfig {
  const config = liveDigitalConfig()
  if (!config) {
    throw new AppError(
      503,
      'LIVEDIGITAL_NOT_CONFIGURED',
      'Видеосвязь не настроена: задайте LIVEDIGITAL_API_TOKEN и LIVEDIGITAL_SPACE_ID на сервере',
    )
  }
  return config
}

let planCache: { key: string; at: number; value: LiveDigitalPlan | null } | null = null
const PLAN_CACHE_MS = 5 * 60_000

/** Тариф пространства. Ошибка провайдера не должна ломать статус видеосвязи. */
async function currentPlan(config: LiveDigitalConfig): Promise<LiveDigitalPlan | null> {
  const key = `${config.apiUrl}:${config.spaceId}`
  if (planCache?.key === key && Date.now() - planCache.at < PLAN_CACHE_MS) return planCache.value

  try {
    const query = new URLSearchParams({ spaceId: config.spaceId })
    const value = await request<LiveDigitalPlan>(`/plans/current?${query.toString()}`)
    planCache = { key, at: Date.now(), value: value ?? null }
    return planCache.value
  } catch (error) {
    console.warn('[livedigital] не удалось получить тариф пространства', error)
    planCache = { key, at: Date.now(), value: null }
    return null
  }
}

function planLimit(plan: LiveDigitalPlan | null, name: string): number | null {
  const limit = plan?.restrictions?.[name]
  if (!limit?.enabled || limit.value < 0) return null
  return limit.value
}

/** Возможности, которые зависят от тарифа LiveDigital. */
export async function liveDigitalStatus() {
  const config = liveDigitalConfig()
  if (!config) {
    return {
      provider: 'livedigital' as const,
      configured: false,
      recordingAvailable: false,
      transcriptionAvailable: false,
      maxConferenceParticipants: null,
      maxWebinarParticipants: null,
      plan: null,
      browsers: { chrome: '90+', safari: '15+' },
      sdk: '@livedigital/client',
      note: 'Видеосвязь не настроена: задайте LIVEDIGITAL_API_TOKEN и LIVEDIGITAL_SPACE_ID на сервере.',
    }
  }

  const plan = await currentPlan(config)
  const conferenceLimit = planLimit(plan, 'maxParticipantsInPracticeRoom')
  const webinarLimit = planLimit(plan, 'maxParticipantsInWebinarRoom')

  return {
    provider: 'livedigital' as const,
    configured: true,
    // null означает, что тариф определить не удалось; это не подтверждение доступности.
    recordingAvailable: plan ? plan.features?.cloudRecording === true : null,
    transcriptionAvailable: plan ? plan.features?.transcribationTranscribeAudioTracks === true : null,
    maxConferenceParticipants: conferenceLimit,
    maxWebinarParticipants: webinarLimit,
    plan: plan ? { name: plan.name, alias: plan.alias } : null,
    browsers: { chrome: '90+', safari: '15+' },
    sdk: '@livedigital/client',
    note: plan
      ? 'Лимиты и запись взяты из текущего тарифа LiveDigital.'
      : 'Тариф LiveDigital не удалось определить. Запись и лимиты проверяются провайдером при вызове.',
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requireLiveDigitalConfig()
  let response: Response
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'x-public': 'true',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new AppError(
      502,
      'LIVEDIGITAL_UNAVAILABLE',
      `LiveDigital недоступен: ${error instanceof Error ? error.message : 'сетевая ошибка'}`,
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const message = `LiveDigital вернул ${response.status}: ${text.slice(0, 300)}`
    if (response.status === 401 || response.status === 403) {
      throw new AppError(502, 'LIVEDIGITAL_AUTH', `Ключ LiveDigital отклонён. ${message}`)
    }
    if (response.status === 409) throw new AppError(409, 'LIVEDIGITAL_CONFLICT', message)
    throw new AppError(502, 'LIVEDIGITAL_ERROR', message)
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    // Некоторые методы (download) возвращают строку URL, а не JSON.
    return text as T
  }
}

function collection<T>(data: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(data)) return data
  return data?.items ?? []
}

export async function createRoom(input: {
  name: string
  recordingEnabled: boolean
  autoRecord: boolean
}): Promise<LiveDigitalRoom> {
  const config = requireLiveDigitalConfig()
  return request<LiveDigitalRoom>(`/spaces/${config.spaceId}/rooms`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.slice(0, 255),
      isPublic: false,
      isChatAllowed: true,
      isRecordAllowed: input.recordingEnabled,
      isAutoRecordingAllowed: input.recordingEnabled && input.autoRecord,
      isMicrophonePublishingAllowed: true,
      isCameraPublishingAllowed: true,
      isScreenMediaPublishingAllowed: true,
      isCustomMediaPublishingAllowed: true,
      isScreensharingAllowed: true,
      isSelfRenamingAllowed: true,
      type: 'lesson',
      waitingRoomAudience: 'nobody',
    }),
  })
}

/** Обновляет флаги записи существующей комнаты (уровень занятия/группы/филиала). */
export async function updateRoomRecording(
  providerRoomId: string,
  input: { recordingEnabled: boolean; autoRecord: boolean },
): Promise<void> {
  const config = requireLiveDigitalConfig()
  await request(`/spaces/${config.spaceId}/rooms/${providerRoomId}`, {
    method: 'PUT',
    body: JSON.stringify({
      isRecordAllowed: input.recordingEnabled,
      isAutoRecordingAllowed: input.recordingEnabled && input.autoRecord,
    }),
  })
}

export async function deleteRoom(providerRoomId: string): Promise<void> {
  const config = requireLiveDigitalConfig()
  try {
    await request(`/spaces/${config.spaceId}/rooms/${providerRoomId}`, { method: 'DELETE' })
  } catch (error) {
    if (error instanceof AppError && /404/.test(error.message)) return
    throw error
  }
}

/**
 * Создаёт участника и выпускает signaling-токен.
 *
 * `role: 'host'` нужен и наставнику, и ученику: роль `audience` в LiveDigital
 * не может публиковать камеру, микрофон и экран. Модераторские действия в
 * ITadis всё равно проверяются сервером, а не ролью участника в канале.
 */
export async function createJoinCredentials(input: {
  providerRoomId: string
  name: string
  role?: 'host' | 'audience'
  clientUniqueId?: string
}): Promise<{ participantId: string; signalingToken: string }> {
  const config = requireLiveDigitalConfig()
  const participant = await request<LiveDigitalParticipant>(`/spaces/${config.spaceId}/participants`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.slice(0, 100),
      roomId: input.providerRoomId,
      role: input.role ?? 'host',
      clientUniqueId: (input.clientUniqueId ?? `itadis-${crypto.randomUUID()}`).slice(0, 64),
    }),
  })
  if (!participant?.id) {
    throw new AppError(502, 'LIVEDIGITAL_PARTICIPANT', 'LiveDigital не вернул идентификатор участника')
  }

  const token = await request<{ signalingToken?: string }>(
    `/spaces/${config.spaceId}/participants/${participant.id}/signaling-token`,
    { method: 'POST', body: '{}' },
  )
  if (!token?.signalingToken) {
    throw new AppError(502, 'LIVEDIGITAL_TOKEN', 'LiveDigital не вернул signaling-токен')
  }
  return { participantId: participant.id, signalingToken: token.signalingToken }
}

/** Старт записи. API возвращает созданную запись, если она уже инициализирована. */
export async function startRecording(providerRoomId: string): Promise<LiveDigitalRecord | null> {
  const config = requireLiveDigitalConfig()
  const data = await request<LiveDigitalRecord | undefined>(
    `/spaces/${config.spaceId}/rooms/${providerRoomId}/records/start`,
    { method: 'POST', body: '{}' },
  )
  return data && typeof data === 'object' && data.id ? data : null
}

export async function stopRecording(providerRoomId: string): Promise<void> {
  const config = requireLiveDigitalConfig()
  await request(`/spaces/${config.spaceId}/rooms/${providerRoomId}/records/stop`, {
    method: 'POST',
    body: '{}',
  })
}

export async function listRecords(providerRoomId: string): Promise<LiveDigitalRecord[]> {
  const config = requireLiveDigitalConfig()
  const data = await request<LiveDigitalRecord[] | { items?: LiveDigitalRecord[] }>(
    `/spaces/${config.spaceId}/rooms/${providerRoomId}/records`,
  )
  return collection(data)
}

/**
 * Ссылка на запись. Метод может ответить редиректом (тогда нужен Location)
 * либо JSON/строкой с URL. Обычный fetch следует за редиректом и вернул бы
 * бинарный файл, поэтому здесь redirect намеренно отключён.
 */
export async function recordDownloadUrl(providerRoomId: string, providerRecordId: string): Promise<string> {
  const config = requireLiveDigitalConfig()
  let response: Response
  try {
    response = await fetch(
      `${config.apiUrl}/spaces/${config.spaceId}/rooms/${providerRoomId}/records/download/${providerRecordId}`,
      {
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'x-public': 'true',
        },
        signal: AbortSignal.timeout(20_000),
      },
    )
  } catch (error) {
    throw new AppError(
      502,
      'LIVEDIGITAL_RECORD_URL',
      `LiveDigital не вернул ссылку на запись: ${error instanceof Error ? error.message : 'сетевая ошибка'}`,
    )
  }

  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location) {
    return new URL(location, `${config.apiUrl}/`).toString()
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    throw new AppError(502, 'LIVEDIGITAL_RECORD_URL', `LiveDigital вернул ${response.status} при выдаче записи`)
  }

  let url = text.trim()
  try {
    const parsed = JSON.parse(text) as { url?: string } | string
    url = typeof parsed === 'string' ? parsed : (parsed.url ?? '')
  } catch {
    // Ответ уже является строкой URL.
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new AppError(502, 'LIVEDIGITAL_RECORD_URL', 'LiveDigital не вернул ссылку на запись')
  }
  return url
}

/** Удаление записи у провайдера после окончания срока хранения. */
export async function deleteRecord(providerRoomId: string, providerRecordId: string): Promise<void> {
  const config = requireLiveDigitalConfig()
  try {
    await request(`/spaces/${config.spaceId}/rooms/${providerRoomId}/records/${providerRecordId}`, {
      method: 'DELETE',
    })
  } catch (error) {
    if (error instanceof AppError && /404/.test(error.message)) return
    throw error
  }
}

export async function finishCall(providerRoomId: string): Promise<void> {
  const config = requireLiveDigitalConfig()
  await request(`/spaces/${config.spaceId}/rooms/${providerRoomId}/finish-call`, {
    method: 'POST',
    body: '{}',
  })
}

export type LiveDigitalCall = {
  id: string
  roomId?: string
  startedAt?: string
  finishedAt?: string
  participantsCount?: number
  totalParticipantsCount?: number
  uniqueParticipantsCount?: number
}

export async function analyticsCalls(providerRoomId: string, date: string): Promise<LiveDigitalCall[]> {
  const config = requireLiveDigitalConfig()
  const query = new URLSearchParams({ roomId: providerRoomId, date })
  const data = await request<LiveDigitalCall[] | { items?: LiveDigitalCall[] }>(
    `/spaces/${config.spaceId}/analytics/calls?${query.toString()}`,
  )
  return collection(data)
}

export async function analyticsReport(input: {
  providerRoomId: string
  callId: string
}): Promise<unknown> {
  const config = requireLiveDigitalConfig()
  const query = new URLSearchParams({
    roomId: input.providerRoomId,
    callId: input.callId,
    format: 'json',
    withDetailedIntervals: 'true',
  })
  return request(`/spaces/${config.spaceId}/analytics/report?${query.toString()}`)
}

/** Проверка подписи вебхука: HMAC-SHA256 по JSON.stringify(body). */
export function verifyWebhook(rawBody: Buffer, payload: { signature?: string; body?: LiveDigitalWebhookPayload }) {
  const config = liveDigitalConfig()
  const secret = config?.webhookSecret
  if (!secret) {
    throw new AppError(503, 'LIVEDIGITAL_WEBHOOK_NOT_CONFIGURED', 'Вебхуки LiveDigital не настроены')
  }
  if (!payload?.signature || !payload.body) {
    throw new AppError(400, 'INVALID_WEBHOOK', 'Вебхук LiveDigital без подписи или тела')
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody.toString('utf8')) as { body?: unknown }
  } catch {
    throw new AppError(400, 'INVALID_WEBHOOK', 'Тело вебхука не является JSON')
  }

  const candidates = [
    JSON.stringify((parsedBody as { body?: unknown }).body),
    JSON.stringify(payload.body),
    rawBody.toString('utf8'),
  ]
  const signature = payload.signature.replace(/^sha256=/i, '').trim().toLowerCase()
  const valid = candidates.some((value) => {
    const expected = crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex')
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })
  if (!valid) throw new AppError(401, 'INVALID_WEBHOOK', 'Подпись вебхука LiveDigital не совпадает')
  return payload.body
}
