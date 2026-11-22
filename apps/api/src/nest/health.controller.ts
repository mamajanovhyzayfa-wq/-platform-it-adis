import { Controller, Get, Inject } from '@nestjs/common'
import { env } from '../config/env.js'
import { storageDriver } from '../lib/file-storage.js'
import { redisHealth } from '../lib/redis.js'
import { Public } from './common/decorators.js'
import { PrismaService } from './prisma/prisma.service.js'

/** Проверка живости сервиса и соединения с БД. */
@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get('healthz')
  async health(): Promise<{
    status: 'ok' | 'degraded'
    database: 'up' | 'down'
    redis: 'up' | 'down' | 'disabled'
    storage: 'local' | 's3'
    backups: 'enabled' | 'disabled'
    uptime: number
  }> {
    let database: 'up' | 'down' = 'up'
    try {
      await this.prisma.client.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }
    const redis = env.REDIS_URL ? await redisHealth() : 'disabled'

    return {
      // Redis в локальной разработке может быть выключен; в production REDIS_URL задан.
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      redis,
      storage: storageDriver(),
      backups: env.BACKUP_SCHEDULER_ENABLED ? 'enabled' : 'disabled',
      uptime: Math.round(process.uptime()),
    }
  }
}
