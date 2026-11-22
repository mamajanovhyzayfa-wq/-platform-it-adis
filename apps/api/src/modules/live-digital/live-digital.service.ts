import { Injectable } from '@nestjs/common'
import { env } from '../../config/env.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

/** Статус провайдера без раскрытия токена и webhook-секрета. */
@Injectable()
export class LiveDigitalService {
  constructor(private readonly prisma: PrismaService) {}

  status() {
    return {
      provider: 'livedigital',
      configured: Boolean(env.LIVEDIGITAL_API_TOKEN && env.LIVEDIGITAL_SPACE_ID),
      apiUrl: env.LIVEDIGITAL_API_URL,
      spaceConfigured: Boolean(env.LIVEDIGITAL_SPACE_ID),
      webhookConfigured: Boolean(env.LIVEDIGITAL_WEBHOOK_SECRET),
      // Записи переносятся в файловое хранилище ITadis, отдельный S3 не нужен.
      recordingStorageConfigured: true,
      recordingStorage: 'itadis',
    }
  }

  async rooms(query: { page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
    const [data, total] = await Promise.all([
      this.prisma.client.videoRoom.findMany({
        select: {
          id: true,
          scheduleId: true,
          provider: true,
          roomName: true,
          status: true,
          startedAt: true,
          endedAt: true,
          recordingUrl: true,
          createdAt: true,
          schedule: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              course: { select: { id: true, title: true } },
            },
          },
          _count: { select: { recordings: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.videoRoom.count(),
    ])
    return { data, page, limit, total, pages: Math.ceil(total / limit) }
  }
}
