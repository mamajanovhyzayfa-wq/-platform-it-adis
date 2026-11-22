import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../src/lib/errors.js'
import { signAccessToken } from '../src/lib/security.js'
import { AllExceptionsFilter } from '../src/nest/common/all-exceptions.filter.js'
import { JwtAuthGuard } from '../src/nest/common/guards/jwt-auth.guard.js'
import { RolesGuard } from '../src/nest/common/guards/roles.guard.js'
import { IntegrationsController } from '../src/modules/integrations/integrations.controller.js'
import { IntegrationsService } from '../src/modules/integrations/integrations.service.js'

/**
 * Проверка HTTP-контракта новых маршрутов интеграций без базы данных:
 * настоящие guard'ы, настоящий контроллер и фильтр ошибок, сервис заменён
 * заглушкой. Так проверяются коды 401/403/404/201 и форма ответа API.
 */
const fakeService = {
  list: vi.fn(async () => ({
    checkedAt: '2026-11-20T00:00:00.000Z',
    total: 14,
    configured: 0,
    categories: ['ai'],
    adapters: [],
  })),
  status: vi.fn(async () => ({ checkedAt: '2026-11-20T00:00:00.000Z', providers: [], paymentProviderAccounts: [] })),
  events: vi.fn(async () => ({ items: [], page: 1, limit: 25, total: 0, pages: 0 })),
  check: vi.fn(async (id: string) => ({ id, status: 'ok' })),
  checkAll: vi.fn(async () => ({ checkedAt: '2026-11-20T00:00:00.000Z', results: [], summary: {} })),
  update: vi.fn(async (id: string) => ({ provider: id, enabled: false })),
  exportToAccounting: vi.fn(async () => ({ accepted: true, provider: 'generic' })),
}

@Module({
  controllers: [IntegrationsController],
  providers: [
    { provide: IntegrationsService, useValue: fakeService },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class IntegrationsSurfaceModule {}

const adminToken = signAccessToken({ sub: 'admin-1', role: 'ADMIN', email: 'admin@itadis.kg' })
const studentToken = signAccessToken({ sub: 'student-1', role: 'STUDENT', email: 'student@itadis.kg' })

describe('HTTP-контракт /api/integrations', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await NestFactory.create(IntegrationsSurfaceModule, { logger: false })
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    fakeService.check.mockImplementation(async (id: string) => ({ id, status: 'ok' }))
  })

  it('без токена отвечает 401 в едином формате ошибки', async () => {
    const response = await request(app.getHttpServer()).get('/api/integrations')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('ученику админский раздел запрещён', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/integrations')
      .set('Authorization', `Bearer ${studentToken}`)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('администратор получает список адаптеров', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/integrations')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(200)
    expect(response.body.total).toBe(14)
    expect(fakeService.list).toHaveBeenCalledTimes(1)
  })

  it('проверка интеграции вызывается с идентификатором адаптера', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/integrations/livedigital/check')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ id: 'livedigital', status: 'ok' })
    expect(fakeService.check).toHaveBeenCalledWith('livedigital', expect.objectContaining({ userId: 'admin-1' }))
  })

  it('настройка интеграции обновляется через PATCH', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/integrations/openai')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false })
    expect(response.status).toBe(200)
    expect(fakeService.update).toHaveBeenCalledWith('openai', { enabled: false }, expect.objectContaining({ userId: 'admin-1' }))
  })

  it('журнал событий доступен только администратору', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/integrations/events?provider=openai&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(200)
    expect(fakeService.events).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', limit: '10' }))
  })

  it('экспорт в бухгалтерию идёт через отдельный маршрут', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/integrations/accounting/entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'invoice', number: 'INV-1', amount: 1000, occurredAt: '2026-11-20T10:00:00.000Z' })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ accepted: true })
  })

  it('ошибка сервиса превращается в код API', async () => {
    fakeService.check.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'Интеграция не найдена'))
    const response = await request(app.getHttpServer())
      .post('/api/integrations/unknown/check')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('проверка всех интеграций доступна администратору', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/integrations/check-all')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(201)
    expect(fakeService.checkAll).toHaveBeenCalledTimes(1)
  })
})
