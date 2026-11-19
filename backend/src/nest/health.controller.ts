import { Controller, Get, Inject } from '@nestjs/common'
import { Public } from './common/decorators.js'
import { PrismaService } from './prisma/prisma.service.js'

/** Проверка живости сервиса и соединения с БД. */
@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get('healthz')
  async health(): Promise<{ status: 'ok' | 'degraded'; database: 'up' | 'down'; uptime: number }> {
    let database: 'up' | 'down' = 'up'
    try {
      await this.prisma.client.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptime: Math.round(process.uptime()),
    }
  }
}
