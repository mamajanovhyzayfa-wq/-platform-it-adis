import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/config/env.js'
import type { PrismaService } from '../src/nest/prisma/prisma.service.js'
import type { User } from '@prisma/client'

const mail = vi.hoisted(() => ({ sendMail: vi.fn() }))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('../src/lib/mailer.js', () => ({ sendMail: mail.sendMail }))
vi.mock('../src/lib/audit.js', () => ({ writeAudit: audit.writeAudit }))

import { AuthService } from '../src/modules/auth/auth.service.js'
import { verifyPassword } from '../src/lib/security.js'

/**
 * Восстановление пароля: неизвестный адрес не создаёт токен и не отправляет
 * письмо; известный получает одноразовую ссылку на 30 минут, а успешный сброс
 * меняет хэш пароля и отзывает все refresh-сессии пользователя.
 */
const user = {
  id: 'user-1',
  email: 'student@itadis.kg',
  phone: null,
  firstName: 'Ученик',
  lastName: 'Тестов',
  role: 'STUDENT',
  avatarUrl: null,
  locale: 'ru',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as User

interface ResetRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
}

function setup() {
  let reset: ResetRecord | null = null
  const updatePassword = vi.fn(async (_input: { where: { id: string }; data: { passwordHash: string } }) => ({}))
  const markUsed = vi.fn(async ({ data }: { data: { usedAt: Date } }) => {
    if (reset) reset.usedAt = data.usedAt
    return reset
  })
  const revokeSessions = vi.fn(async () => ({ count: 2 }))
  const client = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string } }) =>
        where.email === user.email ? user : null,
      ),
      update: updatePassword,
    },
    passwordResetToken: {
      create: vi.fn(async ({ data }: { data: Omit<ResetRecord, 'id' | 'usedAt'> }) => {
        reset = { id: 'reset-1', usedAt: null, ...data }
        return reset
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
        reset && reset.tokenHash === where.tokenHash ? reset : null,
      ),
      update: markUsed,
    },
    refreshSession: { updateMany: revokeSessions },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  }
  const service = new AuthService(
    { client } as unknown as PrismaService,
    { APP_ORIGIN: 'https://app.itadis.kg', ACCESS_TOKEN_TTL: '15m' } as Env,
  )
  return { service, client, updatePassword, revokeSessions, getReset: () => reset }
}

beforeEach(() => {
  mail.sendMail.mockReset()
  audit.writeAudit.mockReset()
})

describe('восстановление пароля', () => {
  it('не раскрывает существование аккаунта и не создаёт токен для неизвестного адреса', async () => {
    const { service, client } = setup()
    await service.forgotPassword('no-such-user@itadis.kg')

    expect(client.passwordResetToken.create).not.toHaveBeenCalled()
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('отправляет одноразовую ссылку и сбрасывает пароль, отзывая сессии', async () => {
    const { service, client, updatePassword, revokeSessions, getReset } = setup()
    await service.forgotPassword(user.email)

    expect(mail.sendMail).toHaveBeenCalledTimes(1)
    const message = mail.sendMail.mock.calls[0]?.[0] as { to: string; text: string }
    expect(message.to).toBe(user.email)
    const token = /token=([A-Za-z0-9_-]+)/.exec(message.text)?.[1]
    expect(token).toBeTruthy()
    expect(getReset()?.tokenHash).not.toBe(token)

    await service.resetPassword(token!, 'NewPassword2026')

    const passwordHash = (updatePassword.mock.calls[0]?.[0] as unknown as { data: { passwordHash: string } })
      .data.passwordHash
    expect(passwordHash).not.toContain('NewPassword2026')
    expect(await verifyPassword('NewPassword2026', passwordHash)).toBe(true)
    expect(revokeSessions).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(getReset()?.usedAt).toBeInstanceOf(Date)
  })

  it('не принимает просроченную или уже использованную ссылку', async () => {
    const { service, getReset } = setup()
    await service.forgotPassword(user.email)

    const message = mail.sendMail.mock.calls[0]?.[0] as { text: string }
    const token = /token=([A-Za-z0-9_-]+)/.exec(message.text)![1]
    const reset = getReset()!
    reset.usedAt = new Date()

    await expect(service.resetPassword(token!, 'NewPassword2026')).rejects.toMatchObject({ status: 401 })
    reset.usedAt = null
    reset.expiresAt = new Date(Date.now() - 1_000)
    await expect(service.resetPassword(token!, 'NewPassword2026')).rejects.toMatchObject({ status: 401 })
  })
})
