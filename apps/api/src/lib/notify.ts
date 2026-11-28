import { Prisma, type NotificationType } from '@prisma/client'
import { prisma } from './prisma.js'
import { sendPushToUsers } from './push.js'
import { sendMail } from './mailer.js'
import { sendSms } from './sms.js'

interface NotificationChannels {
  inApp: boolean
  push: boolean
  email: boolean
  sms: boolean
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  'LESSON_PUBLISHED',
  'SCHEDULE_CHANGED',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_DUE_SOON',
  'HOMEWORK_REVIEWED',
  'GRADE_RECEIVED',
  'TEST_ASSIGNED',
  'EXAM_PUBLISHED',
  'EXAM_REGISTERED',
  'EXAM_RESULT',
  'TEST_RESULT',
  'LESSON_CANCELLED',
  'LESSON_RESCHEDULED',
  'EVENT_CANCELLED',
  'SUSPICIOUS_LOGIN',
  'MESSAGE_RECEIVED',
  'PAYMENT_RECEIVED',
  'PAYMENT_DUE',
  'INVOICE_ISSUED',
  'REFUND_PROCESSED',
  'COINS_AWARDED',
  'ACHIEVEMENT_UNLOCKED',
  'SHOP_ORDER',
  'CERTIFICATE_ISSUED',
  'CERTIFICATE_REVOKED',
  'ANNOUNCEMENT',
  'EVENT',
  'CONTEST',
  'MEETING_REQUEST',
  'MEETING_RESPONSE',
  'ATTENDANCE_ABSENCE',
  'LESSON_STARTING',
  'DIGEST',
  'SYSTEM',
]

/** По умолчанию внутренние и push включены; email/SMS пользователь включает сам. */
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannels = {
  inApp: true,
  push: true,
  email: false,
  sms: false,
}

/** Вход с нового устройства дополнительно дублируется письмом по умолчанию. */
const SECURITY_CHANNELS: NotificationChannels = { ...DEFAULT_NOTIFICATION_CHANNELS, email: true }

function defaultChannels(type: NotificationType): NotificationChannels {
  return type === 'SUSPICIOUS_LOGIN' ? SECURITY_CHANNELS : DEFAULT_NOTIFICATION_CHANNELS
}

interface NotificationPayload {
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  email?: { subject: string; text: string }
  sms?: string
}

function asSettings(value: Prisma.JsonValue | null): Record<string, Partial<NotificationChannels>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, Partial<NotificationChannels>>
}

export function channelsFor(settings: Record<string, Partial<NotificationChannels>>, type: NotificationType): NotificationChannels {
  return { ...defaultChannels(type), ...(settings[type] ?? {}) }
}

/**
 * Единая точка доставки: внутреннее уведомление, push, email и SMS.
 * Пользовательские настройки проверяются для каждого получателя отдельно.
 * Внешние каналы не пробрасывают ошибки в бизнес-операцию.
 */
export async function notifyUsers(userIds: string[], payload: NotificationPayload): Promise<{ internal: number; push: number }> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return { internal: 0, push: 0 }

  const [users, preferences] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, email: true, phone: true },
    }),
    prisma.notificationPreference.findMany({ where: { userId: { in: unique } } }),
  ])
  const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]))
  const internal: Array<{ userId: string; type: NotificationType; title: string; body: string; data?: Prisma.InputJsonValue }> = []
  const pushTargets: string[] = []

  for (const user of users) {
    const preference = preferenceByUser.get(user.id)
    const channels = channelsFor(asSettings(preference?.settings ?? null), payload.type)
    if (channels.inApp) {
      internal.push({
        userId: user.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        ...(payload.data ? { data: payload.data as Prisma.InputJsonValue } : {}),
      })
    }
    if (channels.push) pushTargets.push(user.id)
    if (channels.email && user.email) {
      const email = payload.email ?? { subject: payload.title, text: payload.body }
      void sendMail({ to: user.email, subject: email.subject, text: email.text }).catch((error) =>
        console.warn('[notify] email не отправлен', error instanceof Error ? error.message : error),
      )
    }
    if (channels.sms && user.phone) {
      const sms = payload.sms ?? `${payload.title}: ${payload.body}`.slice(0, 160)
      void sendSms({ to: user.phone, text: sms }).catch((error) =>
        console.warn('[notify] SMS не отправлено', error instanceof Error ? error.message : error),
      )
    }
  }

  if (internal.length > 0) {
    await prisma.notification.createMany({ data: internal })
  }
  const pushed = pushTargets.length
    ? await sendPushToUsers(pushTargets, {
        title: payload.title,
        body: payload.body,
        data: payload.data,
        channelId: payload.type === 'MESSAGE_RECEIVED' ? 'messages' : 'default',
      }).catch((error) => {
        console.warn('[notify] push не отправлен', error instanceof Error ? error.message : error)
        return 0
      })
    : 0

  return { internal: internal.length, push: pushed }
}

export async function notifyUser(userId: string, payload: NotificationPayload) {
  return notifyUsers([userId], payload)
}

export function defaultPreferenceSettings(): Record<string, NotificationChannels> {
  return Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, { ...defaultChannels(type) }]))
}
