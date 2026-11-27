import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { AccessService } from '../src/modules/access/access.service.js'
import type { RegistrationApplyInput } from '../src/modules/access/access.schemas.js'

/**
 * Гонка регистрации (D-1): вторая одновременная заявка с тем же email
 * нарушает частичный уникальный индекс и должна давать 409, а не 500 и не
 * вторую запись PENDING.
 */

const input: RegistrationApplyInput = {
  firstName: 'Айгуль',
  lastName: 'Тестова',
  email: 'race@example.com',
  password: 'ITadis2026',
  passwordRepeat: 'ITadis2026',
  role: 'STUDENT',
  birthDate: new Date('2000-01-01'),
  guardianConsent: false,
  locale: 'ru',
  acceptTerms: true,
  acceptPrivacy: true,
  acceptDataProcessing: true,
  acceptMarketing: false,
}

function buildService(create: () => Promise<never>) {
  const prisma = {
    client: {
      user: { findFirst: vi.fn(async () => null) },
      registrationRequest: { findFirst: vi.fn(async () => null), create: vi.fn(create) },
    },
  }
  const env = { APP_ORIGIN: 'http://localhost:3000' }
  const auth = { issueTokens: vi.fn() }
  const service = new AccessService(prisma as never, env as never, auth as never)
  return { service, prisma }
}

describe('POST /api/access/registration: одновременные заявки', () => {
  it('превращает нарушение уникального индекса в 409 Conflict', async () => {
    const { service } = buildService(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    })

    await expect(service.apply(input, { ip: '127.0.0.1' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Заявка с таким email уже отправлена и ждёт рассмотрения администратором',
    })
  })

  it('не подменяет другие ошибки БД на 409', async () => {
    const { service } = buildService(async () => {
      throw new Error('database is down')
    })

    await expect(service.apply(input, { ip: '127.0.0.1' })).rejects.toThrow('database is down')
  })
})
