import { prisma } from './prisma.js'

/**
 * Push-уведомления через Expo Push API.
 *
 * В базе хранятся только строки уведомлений и токены устройств: мобильное приложение
 * получает токен от expo-notifications и присылает его нам. Отправка выполняется
 * отдельно от записи в БД, поэтому недоступность Expo не ломает бизнес-операцию.
 *
 * Ключи Expo не нужны, но для проекта можно задать EXPO_ACCESS_TOKEN — он уходит
 * в заголовке Authorization и повышает лимиты.
 */

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
const CHUNK_SIZE = 100

export interface PushPayload {
  title: string
  body: string
  /** Данные для перехода в нужный экран приложения. */
  data?: Record<string, unknown>
  /** Звук и приоритет: сообщения важнее служебных уведомлений. */
  channelId?: 'default' | 'messages'
}

interface ExpoMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound: 'default'
  channelId: string
  priority: 'high' | 'default'
}

function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token) || /^[A-Za-z0-9_-]{20,}$/.test(token)
}

/**
 * Отправляет push на все активные устройства пользователей.
 * Ошибки логируются и не пробрасываются: уведомление уже сохранено в БД.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return 0

  const devices = await prisma.userDevice.findMany({
    where: { userId: { in: unique }, pushToken: { not: null } },
    select: { pushToken: true, platform: true },
    take: 5000,
  })

  const tokens = [...new Set(devices.map((device) => device.pushToken).filter((token): token is string => Boolean(token)))]
    .filter(isExpoToken)

  if (tokens.length === 0) return 0

  const messages: ExpoMessage[] = tokens.map((token) => ({
    to: token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: 'default',
    channelId: payload.channelId ?? 'default',
    priority: payload.channelId === 'messages' ? 'high' : 'default',
  }))

  let delivered = 0

  for (let index = 0; index < messages.length; index += CHUNK_SIZE) {
    const chunk = messages.slice(index, index + CHUNK_SIZE)
    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) {
        console.warn(`[push] Expo ответил ${response.status}`)
        continue
      }

      const result = (await response.json()) as {
        data?: Array<{ status?: string; details?: { error?: string }; message?: string }>
      }
      const tickets = result.data ?? []
      delivered += tickets.filter((ticket) => ticket.status === 'ok').length

      // Токен, который Expo считает недействительным, удаляем, чтобы не копить мусор.
      const invalidTokens = tickets
        .map((ticket, ticketIndex) =>
          ticket.details?.error === 'DeviceNotRegistered' ? chunk[ticketIndex]?.to : undefined,
        )
        .filter((token): token is string => Boolean(token))

      if (invalidTokens.length > 0) {
        await prisma.userDevice.deleteMany({ where: { pushToken: { in: invalidTokens } } })
      }
    } catch (error) {
      console.warn('[push] не удалось отправить уведомление', error instanceof Error ? error.message : error)
    }
  }

  return delivered
}

/** Один получатель — короткая обёртка для обычных сценариев. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  return sendPushToUsers([userId], payload)
}

/** Регистрирует push-токен устройства; повторный вызов обновляет запись. */
export async function registerDeviceToken(input: {
  userId: string
  deviceId: string
  platform: string
  pushToken: string
}): Promise<void> {
  await prisma.userDevice.upsert({
    where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
    update: { platform: input.platform, pushToken: input.pushToken, lastSeenAt: new Date() },
    create: {
      userId: input.userId,
      deviceId: input.deviceId,
      platform: input.platform,
      pushToken: input.pushToken,
    },
  })

  // Один токен не должен висеть на нескольких аккаунтах (например, после смены пользователя).
  await prisma.userDevice.updateMany({
    where: { pushToken: input.pushToken, userId: { not: input.userId } },
    data: { pushToken: null },
  })
}

/** Снимает токен при выходе из аккаунта, чтобы устройство не получало чужие пуши. */
export async function unregisterDeviceToken(userId: string, deviceId: string): Promise<void> {
  await prisma.userDevice.updateMany({
    where: { userId, deviceId },
    data: { pushToken: null },
  })
}
