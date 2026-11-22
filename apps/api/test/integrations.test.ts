import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const configs = new Map<string, Record<string, unknown>>()
  const events: Record<string, unknown>[] = []
  const providerAccounts: Record<string, unknown>[] = []

  const matches = (row: Record<string, unknown>, where?: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([key, value]) => row[key] === value)

  const eventCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `evt-${events.length + 1}`, createdAt: new Date(), attempts: 1, ...data }
    events.push(row)
    return row
  })
  const eventFindMany = vi.fn(
    async ({ where, skip = 0, take = 25 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      events.filter((row) => matches(row, where)).slice(skip, skip + take),
  )
  const eventCount = vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    events.filter((row) => matches(row, where)).length,
  )
  const configUpsert = vi.fn(
    async ({
      where,
      create,
      update,
    }: {
      where: { provider: string }
      create?: Record<string, unknown>
      update?: Record<string, unknown>
    }) => {
      const now = new Date()
      const existing = configs.get(where.provider)
      const row = existing
        ? { ...existing, ...update, updatedAt: now }
        : {
            id: `cfg-${where.provider}`,
            provider: where.provider,
            enabled: true,
            settings: null,
            secretEnvVars: null,
            lastCheckedAt: null,
            lastStatus: null,
            lastMessage: null,
            updatedById: null,
            createdAt: now,
            updatedAt: now,
            ...create,
          }
      configs.set(where.provider, row)
      return row
    },
  )

  return {
    configs,
    events,
    providerAccounts,
    eventCreate,
    eventFindMany,
    eventCount,
    configUpsert,
    configFindMany: vi.fn(async () => [...configs.values()]),
    configFindUnique: vi.fn(async ({ where }: { where: { provider: string } }) => configs.get(where.provider) ?? null),
    auditCreate: vi.fn(async (_input: { data: Record<string, unknown> }) => ({})),
    providerAccountFindMany: vi.fn(async () => providerAccounts),
  }
})

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    integrationEvent: { create: db.eventCreate, findMany: db.eventFindMany, count: db.eventCount },
    integrationConfig: {
      findMany: db.configFindMany,
      findUnique: db.configFindUnique,
      upsert: db.configUpsert,
    },
    auditLog: { create: db.auditCreate },
    paymentProviderAccount: { findMany: db.providerAccountFindMany },
  },
  defaultPrisma: {},
}))

import type { AuthUser } from '../src/nest/common/decorators.js'
import { prisma } from '../src/lib/prisma.js'
import { IntegrationRegistry, integrationRegistry } from '../src/integrations/index.js'
import { IntegrationError } from '../src/integrations/core/errors.js'
import { isSecretName, maskTail, redact } from '../src/integrations/core/secrets.js'
import type { IntegrationAdapter } from '../src/integrations/core/types.js'
import { IntegrationsService } from '../src/modules/integrations/integrations.service.js'
import { integrationUpdateSchema, parseInput } from '../src/modules/integrations/integrations.schemas.js'
import type { PrismaService } from '../src/nest/prisma/prisma.service.js'

const user: AuthUser = { userId: 'admin-1', role: 'ADMIN', email: 'admin@itadis.kg' }

function capture(action: () => unknown): { status?: number; message?: string } {
  try {
    action()
  } catch (error) {
    return error as { status?: number; message?: string }
  }
  throw new Error('Ожидалась ошибка, но вызов прошёл')
}

function demoAdapter(overrides: Partial<IntegrationAdapter> = {}): IntegrationAdapter {
  return {
    descriptor: {
      id: 'demo',
      name: 'Demo',
      category: 'ai',
      description: 'Тестовый провайдер',
      docsUrl: 'https://example.com/docs',
      envVars: ['DEMO_TOKEN'],
    },
    missingEnv: () => [],
    isConfigured: () => true,
    probe: async () => ({ ok: true }),
    ...overrides,
  }
}

beforeEach(() => {
  db.configs.clear()
  db.events.length = 0
  vi.clearAllMocks()
})

describe('адаптеры внешних сервисов', () => {
  it('покрывают все категории интеграций из требований', () => {
    const adapters = integrationRegistry.list()
    expect(adapters.map((adapter) => adapter.id)).toEqual(
      expect.arrayContaining([
        'livedigital',
        'google',
        'apple',
        'email',
        'sms',
        'expo-push',
        'google-calendar',
        'apple-calendar',
        'outlook',
        'freedompay',
        'elsom',
        'accounting',
        'openai',
        's3',
      ]),
    )
    expect(new Set(adapters.map((adapter) => adapter.category))).toEqual(
      new Set(['video', 'identity', 'email', 'sms', 'push', 'calendar', 'payments', 'accounting', 'ai', 'storage']),
    )
  })

  it('не раскрывает значения переменных окружения', () => {
    process.env.OPENAI_API_KEY = 'sk-super-secret-value'
    process.env.TWILIO_AUTH_TOKEN = 'twilio-secret-token'
    try {
      const payload = JSON.stringify(integrationRegistry.list())
      expect(payload).not.toContain('sk-super-secret-value')
      expect(payload).not.toContain('twilio-secret-token')
    } finally {
      delete process.env.OPENAI_API_KEY
      delete process.env.TWILIO_AUTH_TOKEN
    }
  })

  it('сообщает имена отсутствующих переменных, а не их значения', () => {
    const email = integrationRegistry.list().find((adapter) => adapter.id === 'email')
    expect(email).toBeDefined()
    expect(Array.isArray(email?.missingEnv)).toBe(true)
    expect(JSON.stringify(email)).not.toContain('password')
  })

  it('неизвестный адаптер возвращает 404', async () => {
    await expect(integrationRegistry.check('no-such-provider')).rejects.toMatchObject({ status: 404 })
  })
})

describe('проверка доступности интеграции', () => {
  it('успешная проверка попадает в журнал', async () => {
    const registry = new IntegrationRegistry([demoAdapter()])
    const health = await registry.check('demo')

    expect(health.status).toBe('ok')
    expect(health.configured).toBe(true)
    expect(typeof health.latencyMs).toBe('number')
    expect(db.events[db.events.length - 1]).toMatchObject({
      provider: 'demo',
      action: 'health_check',
      status: 'OK',
    })
  })

  it('ошибка адаптера → unreachable, запись FAILED и очистка токена', async () => {
    const registry = new IntegrationRegistry([
      demoAdapter({
        probe: async () => {
          throw new Error('провайдер ответил Bad Bearer abc123secret')
        },
      }),
    ])
    const health = await registry.check('demo')

    expect(health.status).toBe('unreachable')
    expect(health.message).toContain('[redacted]')
    expect(health.message).not.toContain('abc123secret')
    expect(db.events[db.events.length - 1]).toMatchObject({ status: 'FAILED' })
  })

  it('ненастроенная интеграция не делает сетевых вызовов', async () => {
    const probe = vi.fn(async () => ({ ok: true }))
    const registry = new IntegrationRegistry([
      demoAdapter({ isConfigured: () => false, missingEnv: () => ['DEMO_TOKEN'], probe }),
    ])
    const health = await registry.check('demo')

    expect(health.status).toBe('not_configured')
    expect(health.latencyMs).toBeNull()
    expect(health.missingEnv).toEqual(['DEMO_TOKEN'])
    expect(probe).not.toHaveBeenCalled()
    expect(db.events[db.events.length - 1]).toMatchObject({ status: 'SKIPPED' })
  })

  it('connect повторяется при временной ошибке', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(undefined)
    const registry = new IntegrationRegistry([demoAdapter({ connect })])

    const health = await registry.check('demo')
    expect(connect).toHaveBeenCalledTimes(2)
    expect(health.status).toBe('ok')
    expect(db.events.some((event) => event.action === 'connect' && event.status === 'OK')).toBe(true)
  })

  it('неверный ключ при connect не повторяется', async () => {
    const unauthorized = new IntegrationError('demo', 'HTTP_ERROR', 'demo: HTTP 401', { retryable: false })
    const connect = vi.fn().mockRejectedValue(unauthorized)
    const probe = vi.fn(async () => ({ ok: true }))
    const registry = new IntegrationRegistry([demoAdapter({ connect, probe })])

    const health = await registry.check('demo')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(probe).not.toHaveBeenCalled()
    expect(health.status).toBe('unreachable')
  })
})

describe('секреты интеграций', () => {
  it('распознаёт секретные поля по имени', () => {
    expect(isSecretName('refresh_token')).toBe(true)
    expect(isSecretName('SMTP_PASSWORD')).toBe(true)
    expect(isSecretName('OPENAI_API_KEY')).toBe(true)
    expect(isSecretName('PUBLIC_HOST')).toBe(false)
  })

  it('редактирует вложенные секреты и сохраняет остальные поля', () => {
    expect(
      redact({ provider: 'google', apiKey: 'secret', nested: { refreshToken: 'token', label: 'филиал' } }),
    ).toEqual({ provider: 'google', apiKey: '[redacted]', nested: { refreshToken: '[redacted]', label: 'филиал' } })
  })

  it('маскирует хвост значения для диагностики', () => {
    expect(maskTail('abcdefgh')).toBe('***efgh')
    expect(maskTail('abc')).toBe('[redacted]')
    expect(maskTail('')).toBeNull()
  })

  it('не принимает значение секрета вместо имени переменной', () => {
    expect(capture(() => parseInput(integrationUpdateSchema, { secretEnvVars: ['sk-live-value'] })).status).toBe(422)
  })
})

describe('сервис интеграций', () => {
  const service = new IntegrationsService({ client: prisma } as unknown as PrismaService)

  it('объединяет адаптеры с настройками филиала', async () => {
    db.configs.set('openai', {
      id: 'cfg-openai',
      provider: 'openai',
      enabled: false,
      settings: null,
      secretEnvVars: null,
      lastCheckedAt: null,
      lastStatus: null,
      lastMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await service.list()
    expect(result.total).toBe(integrationRegistry.list().length)
    expect(result.adapters.find((adapter) => adapter.id === 'openai')?.enabled).toBe(false)
  })

  it('отключённая интеграция не проверяется', async () => {
    db.configs.set('openai', {
      id: 'cfg-openai',
      provider: 'openai',
      enabled: false,
      settings: null,
      secretEnvVars: null,
      lastCheckedAt: null,
      lastStatus: null,
      lastMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const health = await service.check('openai', user)
    expect(health.status).toBe('not_configured')
    expect(health.message).toContain('отключена')
    expect(db.events[db.events.length - 1]).toMatchObject({ action: 'health_check', status: 'SKIPPED' })
  })

  it('неизвестная интеграция → 404', async () => {
    await expect(service.check('nope', user)).rejects.toMatchObject({ status: 404 })
  })

  it('включает интеграцию, пишет аудит и журнал без значения секрета', async () => {
    const result = await service.update('openai', { enabled: true, secretEnvVars: ['OPENAI_API_KEY'] }, user)

    expect(result.enabled).toBe(true)
    expect(result.secretEnvVars).toEqual(['OPENAI_API_KEY'])
    expect(db.auditCreate).toHaveBeenCalled()
    const auditCall = db.auditCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined
    expect(JSON.stringify(auditCall?.data)).not.toContain('sk-')
    expect(db.events[db.events.length - 1]).toMatchObject({ action: 'config', status: 'OK' })
  })

  it('отклоняет значение секрета в настройках', async () => {
    await expect(service.update('openai', { settings: { apiKey: 'sk-live-value' } }, user)).rejects.toMatchObject({
      status: 422,
    })
    await expect(service.update('openai', { token: 'sk-live-value' }, user)).rejects.toMatchObject({ status: 422 })
  })

  it('отдаёт журнал с фильтром и пагинацией', async () => {
    await db.eventCreate({
      data: {
        provider: 'openai',
        action: 'health_check',
        status: 'OK',
        attempts: 1,
        durationMs: 12,
        message: null,
        metadata: null,
        actorId: null,
      },
    })

    const result = await service.events({ provider: 'openai', limit: '10' })
    expect(result.page).toBe(1)
    expect(result.limit).toBe(10)
    expect(result.items[0]).toMatchObject({ provider: 'openai', status: 'OK' })
  })

  it('экспорт в бухгалтерию без настроек → 503', async () => {
    await expect(
      service.exportToAccounting(
        { type: 'invoice', number: 'INV-1', amount: 1000, occurredAt: new Date().toISOString() },
        user,
      ),
    ).rejects.toMatchObject({ status: 503, code: 'NOT_CONFIGURED' })
  })
})
