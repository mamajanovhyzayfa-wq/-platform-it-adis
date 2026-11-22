import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import {
  channelsFor,
  DEFAULT_NOTIFICATION_CHANNELS,
  defaultPreferenceSettings,
  NOTIFICATION_TYPES,
} from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { NotificationPreferenceInput } from './notifications.schemas.js'

type StoredChannels = Record<string, Partial<typeof DEFAULT_NOTIFICATION_CHANNELS>>

function storedSettings(value: Prisma.JsonValue | null): StoredChannels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as StoredChannels
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, limit: number, offset: number) {
    const [items, total, unread] = await Promise.all([
      this.prisma.client.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.client.notification.count({ where: { userId } }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ])
    return { items, total, unread }
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.client.notification.findFirst({
      where: { id, userId },
    })
    if (!notification) throw notFound('Уведомление не найдено')
    return this.prisma.client.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    })
  }

  async readAll(userId: string) {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }

  async preferences(userId: string) {
    const preference = await this.prisma.client.notificationPreference.findUnique({ where: { userId } })
    const saved = storedSettings(preference?.settings ?? null)
    return {
      settings: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, channelsFor(saved, type)])),
      digest: preference?.digest ?? 'NONE',
      digestHour: preference?.digestHour ?? 9,
      channels: ['inApp', 'push', 'email', 'sms'],
      defaults: defaultPreferenceSettings(),
    }
  }

  async updatePreferences(userId: string, input: NotificationPreferenceInput) {
    const existing = await this.prisma.client.notificationPreference.findUnique({ where: { userId } })
    const current = storedSettings(existing?.settings ?? null)
    const incoming = input.settings ?? {}
    const merged: StoredChannels = { ...current }

    for (const [type, channels] of Object.entries(incoming)) {
      if (!NOTIFICATION_TYPES.includes(type as (typeof NOTIFICATION_TYPES)[number])) continue
      merged[type] = { ...current[type], ...channels }
    }

    const saved = await this.prisma.client.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        settings: merged as Prisma.InputJsonValue,
        digest: input.digest ?? 'NONE',
        digestHour: input.digestHour ?? 9,
      },
      update: {
        settings: merged as Prisma.InputJsonValue,
        ...(input.digest ? { digest: input.digest } : {}),
        ...(input.digestHour !== undefined ? { digestHour: input.digestHour } : {}),
      },
    })

    await writeAudit({
      actorId: userId,
      action: 'settings.notifications.updated',
      entity: 'notification_preference',
      entityId: saved.id,
      metadata: {
        changedTypes: Object.keys(incoming),
        digest: saved.digest,
        digestHour: saved.digestHour,
      },
    })

    return {
      settings: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, channelsFor(merged, type)])),
      digest: saved.digest,
      digestHour: saved.digestHour,
    }
  }

  async runDigest(userId: string) {
    const { sendNotificationDigests } = await import('../../jobs/notification-digest.js')
    const sent = await sendNotificationDigests()
    await writeAudit({
      actorId: userId,
      action: 'settings.notifications.digest_run',
      entity: 'notification_digest',
      metadata: { sent },
    })
    return { sent }
  }
}
