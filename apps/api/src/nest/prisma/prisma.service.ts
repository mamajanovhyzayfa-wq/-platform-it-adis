import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { prisma } from '../../lib/prisma.js'

/**
 * Единственный экземпляр PrismaClient на процесс.
 *
 * Клиент создаётся в lib/prisma.ts и переиспользуется Express-роутерами и
 * Nest-сервисами — второй пул соединений не нужен. Класс добавляет только
 * lifecycle-хуки Nest и доступ к клиенту через `this.prisma.client`.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  readonly client = prisma

  async onModuleInit(): Promise<void> {
    await this.client.$connect()
    this.logger.log('Подключение к PostgreSQL установлено')
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect()
  }
}
