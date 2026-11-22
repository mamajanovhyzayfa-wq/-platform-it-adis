import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { AppError, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { AuthUser } from '../../nest/common/decorators.js'
import { sendAccountingEntry } from '../../integrations/adapters/accounting.adapter.js'
import { IntegrationError } from '../../integrations/core/errors.js'
import { recordIntegrationEvent } from '../../integrations/core/event-log.js'
import { integrationRegistry } from '../../integrations/index.js'
import {
  accountingEntrySchema,
  integrationEventsQuerySchema,
  integrationUpdateSchema,
  parseInput,
} from './integrations.schemas.js'

/** Строка настроек интеграции в ответе API: без значений секретов. */
interface IntegrationConfigView {
  enabled: boolean
  lastCheckedAt: string | null
  lastStatus: string | null
  lastMessage: string | null
}

/**
 * Интеграции: реестр адаптеров, проверка доступности, настройки филиала и
 * журнал событий. Секреты здесь только по именам переменных окружения.
 */
@Injectable()
export class IntegrationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Сводный статус ключевых провайдеров. Оставлен для обратной совместимости
   * с панелью администратора; новые клиенты используют GET /api/integrations.
   */
  async status() {
    const providerAccounts = await this.prisma.client.paymentProviderAccount.findMany({
      where: { enabled: true },
      select: {
        id: true,
        provider: true,
        label: true,
        merchantId: true,
        baseUrl: true,
        enabled: true,
        isDefault: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })

    const adapters = integrationRegistry.list()

    return {
      checkedAt: new Date().toISOString(),
      configuredAdapters: adapters.filter((adapter) => adapter.configured).length,
      adaptersTotal: adapters.length,
      providers: [
        {
          id: 'livedigital',
          category: 'video',
          configured: Boolean(env.LIVEDIGITAL_API_TOKEN && env.LIVEDIGITAL_SPACE_ID),
          webhookConfigured: Boolean(env.LIVEDIGITAL_WEBHOOK_SECRET),
        },
        {
          id: 'freedompay',
          category: 'payments',
          configured: Boolean(env.FREEDOMPAY_MERCHANT_ID && env.FREEDOMPAY_SECRET_KEY),
          testMode: env.FREEDOMPAY_TESTING_MODE,
        },
        {
          id: 'elsom',
          category: 'payments',
          configured: Boolean(env.ELSOM_BASE_URL && env.ELSOM_PARTNER_CODE && env.ELSOM_PASSWORD),
        },
        {
          id: 'openai',
          category: 'ai',
          configured: Boolean(env.OPENAI_API_KEY),
          model: env.OPENAI_MODEL,
        },
        {
          id: 'smtp',
          category: 'email',
          configured: Boolean(env.SMTP_HOST && env.SMTP_PORT),
        },
        {
          id: 'sms',
          category: 'sms',
          configured: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
        },
        {
          id: 's3',
          category: 'storage',
          configured: Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY),
        },
        {
          id: 'redis',
          category: 'infrastructure',
          configured: Boolean(env.REDIS_URL),
        },
        {
          id: 'expo-push',
          category: 'push',
          configured: Boolean(env.EXPO_ACCESS_TOKEN),
        },
      ],
      paymentProviderAccounts: providerAccounts,
    }
  }

  /** Все адаптеры с признаком настройки и последним результатом проверки. */
  async list() {
    const configs = await this.prisma.client.integrationConfig.findMany()
    const byProvider = new Map(configs.map((config) => [config.provider, config]))

    const adapters = integrationRegistry.list().map((adapter) => {
      const config = byProvider.get(adapter.id)
      const view: IntegrationConfigView = {
        enabled: config?.enabled ?? true,
        lastCheckedAt: config?.lastCheckedAt ? config.lastCheckedAt.toISOString() : null,
        lastStatus: config?.lastStatus ?? null,
        lastMessage: config?.lastMessage ?? null,
      }
      return { ...adapter, ...view }
    })

    return {
      checkedAt: new Date().toISOString(),
      total: adapters.length,
      configured: adapters.filter((adapter) => adapter.configured && adapter.enabled).length,
      categories: [...new Set(adapters.map((adapter) => adapter.category))],
      adapters,
    }
  }

  async check(id: string, user: AuthUser) {
    const adapter = integrationRegistry.get(id)
    if (!adapter) throw notFound(`Интеграция ${id} не найдена`)

    const config = await this.prisma.client.integrationConfig.findUnique({ where: { provider: id } })
    if (config && !config.enabled) {
      const message = 'Интеграция отключена администратором'
      await recordIntegrationEvent({
        provider: id,
        action: 'health_check',
        status: 'SKIPPED',
        message,
        actorId: user.userId,
      })
      return {
        id,
        name: adapter.descriptor.name,
        category: adapter.descriptor.category,
        configured: adapter.isConfigured(),
        status: 'not_configured',
        missingEnv: adapter.missingEnv(),
        latencyMs: null,
        message,
        checkedAt: new Date().toISOString(),
      }
    }

    const health = await integrationRegistry.check(id, user.userId)
    await this.saveHealth(health.id, health.status, health.message)
    return health
  }

  async checkAll(user: AuthUser) {
    const results = []
    for (const adapter of integrationRegistry.list()) {
      results.push(await this.check(adapter.id, user))
    }
    return {
      checkedAt: new Date().toISOString(),
      results,
      summary: {
        ok: results.filter((result) => result.status === 'ok').length,
        degraded: results.filter((result) => result.status === 'degraded').length,
        notConfigured: results.filter((result) => result.status === 'not_configured').length,
        unreachable: results.filter((result) => result.status === 'unreachable').length,
      },
    }
  }

  /** Журнал событий: только метаданные, без тел запросов и секретов. */
  async events(rawQuery: Record<string, unknown>) {
    const query = parseInput(integrationEventsQuerySchema, rawQuery)
    const where: Prisma.IntegrationEventWhereInput = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
    }
    const [items, total] = await Promise.all([
      this.prisma.client.integrationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.integrationEvent.count({ where }),
    ])
    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        action: item.action,
        status: item.status,
        attempts: item.attempts,
        durationMs: item.durationMs,
        message: item.message,
        metadata: item.metadata,
        actorId: item.actorId,
        createdAt: item.createdAt.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    }
  }

  /** Включение и выключение интеграции, настройки и имена переменных с секретами. */
  async update(id: string, body: unknown, user: AuthUser) {
    const adapter = integrationRegistry.get(id)
    if (!adapter) throw notFound(`Интеграция ${id} не найдена`)

    const input = parseInput(integrationUpdateSchema, body)
    const data = {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.settings === undefined ? {} : { settings: input.settings as Prisma.InputJsonValue }),
      ...(input.secretEnvVars === undefined ? {} : { secretEnvVars: input.secretEnvVars as Prisma.InputJsonValue }),
      updatedById: user.userId,
    }

    const saved = await this.prisma.client.integrationConfig.upsert({
      where: { provider: id },
      create: { provider: id, ...data },
      update: data,
    })

    await writeAudit({
      actorId: user.userId,
      action: 'integrations.config.updated',
      entity: 'IntegrationConfig',
      entityId: saved.id,
      metadata: {
        provider: id,
        enabled: saved.enabled,
        secretEnvVars: input.secretEnvVars ?? [],
      },
    })
    await recordIntegrationEvent({
      provider: id,
      action: 'config',
      status: 'OK',
      message: input.enabled === false ? 'Интеграция отключена' : 'Настройки интеграции обновлены',
      metadata: { enabled: saved.enabled },
      actorId: user.userId,
    })

    return {
      provider: id,
      enabled: saved.enabled,
      settings: saved.settings,
      secretEnvVars: saved.secretEnvVars,
      updatedAt: saved.updatedAt.toISOString(),
    }
  }

  /** Экспорт документа в бухгалтерскую систему: повторы и журнал — в адаптере. */
  async exportToAccounting(body: unknown, user: AuthUser) {
    const entry = parseInput(accountingEntrySchema, body)
    try {
      const result = await sendAccountingEntry({ ...entry, currency: 'KGS' }, user.userId)
      return { accepted: true, provider: env.ACCOUNTING_PROVIDER, result }
    } catch (error) {
      throw this.toApiError(error)
    }
  }

  private async saveHealth(provider: string, status: string, message: string | null): Promise<void> {
    try {
      await this.prisma.client.integrationConfig.upsert({
        where: { provider },
        create: { provider, lastCheckedAt: new Date(), lastStatus: status, lastMessage: message },
        update: { lastCheckedAt: new Date(), lastStatus: status, lastMessage: message },
      })
    } catch (error) {
      // Проверка доступности не должна падать из-за записи статистики.
      console.warn('[integrations] не удалось сохранить статус проверки', provider, error)
    }
  }

  private toApiError(error: unknown): AppError {
    if (error instanceof IntegrationError) return new AppError(error.status, error.code, error.message)
    if (error instanceof AppError) return error
    return new AppError(502, 'INTEGRATION_ERROR', 'Внешний сервис недоступен, попробуйте позже')
  }
}
