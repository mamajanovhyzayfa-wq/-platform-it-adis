import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../src/lib/security.js'
import { writeAudit } from '../src/lib/audit.js'
import { AllExceptionsFilter } from '../src/nest/common/all-exceptions.filter.js'
import { JwtAuthGuard } from '../src/nest/common/guards/jwt-auth.guard.js'
import { RolesGuard } from '../src/nest/common/guards/roles.guard.js'
import { PrismaService } from '../src/nest/prisma/prisma.service.js'
import { AiCenterService } from '../src/modules/ai-center/ai-center.service.js'
import { LeadsController } from '../src/modules/leads/leads.controller.js'
import { LeadsService } from '../src/modules/leads/leads.service.js'

/**
 * Заявки с лендинга через настоящий HTTP-стек.
 *
 * Поднимается реальный Nest-модуль: настоящий контроллер, настоящий
 * LeadsService, настоящие guard'ы (JWT, роли, ThrottlerGuard) и настоящий
 * фильтр ошибок. Заменены только внешние зависимости — Prisma и AI-центр, —
 * поэтому проверяются коды ответов, схема валидации, лимит запросов и то,
 * что созданная заявка действительно видна менеджеру в CRM.
 */

vi.mock('../src/lib/audit.js', () => ({ writeAudit: vi.fn(async () => undefined) }))

interface LeadRow {
  id: string
  name: string
  phone: string
  email: string | null
  audience: string
  message: string | null
  status: string
  source: string
  note: string | null
  consentAt: Date
  createdAt: Date
  contactedAt: Date | null
  closedAt: Date | null
  assignedToId: string | null
}

const rows: LeadRow[] = []

interface LeadWhere {
  status?: string
  OR?: Array<Record<string, { contains: string; mode?: string }>>
}

function matchesWhere(row: LeadRow, where: LeadWhere | undefined): boolean {
  if (!where) return true
  if (where.status && row.status !== where.status) return false
  if (!where.OR) return true
  return where.OR.some((condition) =>
    Object.entries(condition).every(([field, filter]) => {
      const value = row[field as keyof LeadRow]
      if (typeof value !== 'string') return false
      return value.toLowerCase().includes(filter.contains.toLowerCase())
    }),
  )
}

/** Минимальный in-memory двойник Prisma-клиента для таблицы Lead. */
const prismaFake = {
  client: {
    lead: {
      create: async (args: { data: Partial<LeadRow> }) => {
        const row: LeadRow = {
          id: `lead-${rows.length + 1}`,
          name: '',
          phone: '',
          email: null,
          audience: 'STUDENT',
          message: null,
          status: 'NEW',
          source: 'LANDING',
          note: null,
          consentAt: new Date(),
          createdAt: new Date(),
          contactedAt: null,
          closedAt: null,
          assignedToId: null,
          ...args.data,
        }
        rows.push(row)
        return { id: row.id, status: row.status }
      },
      findMany: async (args: { where?: LeadWhere; skip?: number; take?: number }) => {
        const filtered = rows.filter((row) => matchesWhere(row, args.where))
        const start = args.skip ?? 0
        return filtered.slice(start, start + (args.take ?? filtered.length)).map((row) => ({
          ...row,
          assignedTo: null,
        }))
      },
      count: async (args: { where?: LeadWhere }) => rows.filter((row) => matchesWhere(row, args.where)).length,
    },
  },
}

const aiFake = { triggerEvent: vi.fn(async () => ({ triggered: 0 })) }

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }])],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    { provide: PrismaService, useValue: prismaFake },
    { provide: AiCenterService, useValue: aiFake },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class LeadsTestModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(LeadsTestModule, { logger: false })
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.init()
  return app
}

const managerToken = signAccessToken({ sub: 'manager-1', role: 'MANAGER', email: 'manager@itadis.kg' })
const studentToken = signAccessToken({ sub: 'student-1', role: 'STUDENT', email: 'student@itadis.kg' })

const validLead = {
  name: 'Айгуль Тестова',
  phone: '+996 700 123 456',
  email: 'lead@example.com',
  audience: 'PARENT',
  message: 'Нужна консультация',
  consent: true,
}

beforeAll(() => {
  // Без токена ApyHub проверка email пропускается, тест не ходит в сеть.
  vi.stubEnv('APY_TOKEN', '')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/leads: создание и CRM', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    rows.length = 0
    vi.clearAllMocks()
  })

  it('создаёт заявку с лендинга и возвращает 201 с идентификатором', async () => {
    const response = await request(app.getHttpServer()).post('/api/leads').send(validLead)

    expect(response.status).toBe(201)
    expect(typeof response.body.id).toBe('string')
    expect(response.body.status).toBe('NEW')

    // Заявка сохранена с нормализованным телефоном, аудиторией и источником LANDING.
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      phone: '+996700123456',
      audience: 'PARENT',
      source: 'LANDING',
      email: 'lead@example.com',
    })
    expect(rows[0]?.consentAt).toBeInstanceOf(Date)

    // Создание пишется в журнал аудита, AI-сценарий получает событие.
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.created', entity: 'Lead' }))
    expect(aiFake.triggerEvent).toHaveBeenCalledWith('LEAD_CREATED', expect.objectContaining({ leadStatus: 'NEW' }))
  })

  it('созданная заявка появляется в списке CRM менеджера', async () => {
    const created = await request(app.getHttpServer()).post('/api/leads').send(validLead)
    expect(created.status).toBe(201)

    const list = await request(app.getHttpServer())
      .get('/api/leads')
      .set('Authorization', `Bearer ${managerToken}`)

    expect(list.status).toBe(200)
    expect(list.body.total).toBe(1)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({
      id: created.body.id,
      name: validLead.name,
      status: 'NEW',
      source: 'LANDING',
      assignedTo: null,
    })
  })

  it('заявка находится в CRM по поиску и фильтру статуса', async () => {
    await request(app.getHttpServer()).post('/api/leads').send(validLead)

    const bySearch = await request(app.getHttpServer())
      .get('/api/leads')
      .query({ search: 'Айгуль' })
      .set('Authorization', `Bearer ${managerToken}`)
    expect(bySearch.status).toBe(200)
    expect(bySearch.body.total).toBe(1)

    const byStatus = await request(app.getHttpServer())
      .get('/api/leads')
      .query({ status: 'CONVERTED' })
      .set('Authorization', `Bearer ${managerToken}`)
    expect(byStatus.status).toBe(200)
    expect(byStatus.body.total).toBe(0)
  })

  it('CRM закрыта для ученика', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/leads')
      .set('Authorization', `Bearer ${studentToken}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })
})

describe('POST /api/leads: валидация', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    rows.length = 0
  })

  const invalidCases: Array<{ title: string; body: Record<string, unknown>; path: string }> = [
    { title: 'без согласия на обработку данных', body: { ...validLead, consent: false }, path: 'consent' },
    { title: 'со слишком коротким именем', body: { ...validLead, name: 'A' }, path: 'name' },
    { title: 'с телефоном из букв', body: { ...validLead, phone: 'позвоните мне' }, path: 'phone' },
    { title: 'с некорректным email', body: { ...validLead, email: 'not-an-email' }, path: 'email' },
  ]

  for (const { title, body, path } of invalidCases) {
    it(`отклоняет заявку ${title} и не создаёт запись`, async () => {
      const response = await request(app.getHttpServer()).post('/api/leads').send(body)

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.details.map((issue: { path: string }) => issue.path)).toContain(path)
      expect(rows).toHaveLength(0)
    })
  }

  it('отклоняет неизвестные поля формы', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/leads')
      .send({ ...validLead, role: 'ADMIN' })

    expect(response.status).toBe(422)
    expect(rows).toHaveLength(0)
  })
})

describe('POST /api/leads: лимит запросов', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('пропускает 5 заявок за 10 минут и отвечает 429 на шестую', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app.getHttpServer()).post('/api/leads').send(validLead)
      expect(response.status, `запрос ${attempt}`).toBe(201)
    }

    const limited = await request(app.getHttpServer()).post('/api/leads').send(validLead)

    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS')
    // Лимит не должен пропускать запись в базу: шестая заявка не сохранена.
    expect(rows).toHaveLength(5)
  })
})
