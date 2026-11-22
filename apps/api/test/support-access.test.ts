import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleName } from '@prisma/client'
import type { AuthUser } from '../src/nest/common/decorators.js'
import type { PrismaService } from '../src/nest/prisma/prisma.service.js'
import { writeAudit } from '../src/lib/audit.js'
import { SupportService } from '../src/modules/support/support.service.js'

vi.mock('../src/lib/audit.js', () => ({ writeAudit: vi.fn(async () => undefined) }))

const ownTicket = {
  id: 'ticket-own',
  userId: 'student-1',
  subject: 'Не открывается урок',
  message: 'При переходе в урок появляется ошибка 500, помогите пожалуйста.',
  category: 'TECHNICAL',
  status: 'OPEN',
  priority: 'NORMAL',
  assignedToId: null,
  resolution: null,
  createdAt: new Date('2026-11-20T08:00:00.000Z'),
  updatedAt: new Date('2026-11-20T08:00:00.000Z'),
  assignedTo: null,
}

const otherTicket = { ...ownTicket, id: 'ticket-other', userId: 'student-2' }

const restrictedRoles: RoleName[] = ['STUDENT', 'PARENT', 'TEACHER']
const staffRoles: RoleName[] = ['ADMIN', 'MANAGER']

function user(role: RoleName, userId = `${role.toLowerCase()}-1`): AuthUser {
  return { userId, role, email: `${userId}@itadis.kg` }
}

type ListArgs = {
  where: { userId?: string; status?: string; OR?: unknown[] }
  skip?: number
  take?: number
}

function makeService() {
  const findMany = vi.fn(async (_args: ListArgs) => [ownTicket])
  const count = vi.fn(async (_args: { where: ListArgs['where'] }) => 1)
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    if (where.id === ownTicket.id) return ownTicket
    if (where.id === otherTicket.id) return otherTicket
    return null
  })
  const create = vi.fn(async ({ data }: { data: { userId: string; subject: string; category: string } }) => ({
    ...ownTicket,
    ...data,
  }))
  const update = vi.fn(async ({ data }: { data: { status?: string; priority?: string } }) => ({
    ...ownTicket,
    ...data,
  }))

  const service = new SupportService({
    client: { supportTicket: { findMany, count, findUnique, create, update } },
  } as unknown as PrismaService)

  return { service, findMany, count, create, update }
}

let support: ReturnType<typeof makeService>

beforeEach(() => {
  vi.clearAllMocks()
  support = makeService()
})

function listWhere(): ListArgs['where'] {
  const args = support.findMany.mock.calls[0]?.[0]
  if (!args) throw new Error('Ожидался вызов supportTicket.findMany')
  return args.where
}

describe('поддержка: список', () => {
  it.each(restrictedRoles)('%s видит только свои обращения', async (role) => {
    const current = user(role, `${role.toLowerCase()}-9`)
    await support.service.list(current, {})
    const where = listWhere()

    expect(where.userId).toBe(current.userId)
    expect(support.count).toHaveBeenCalledWith({ where })
  })

  it.each(staffRoles)('%s видит обращения всего филиала', async (role) => {
    await support.service.list(user(role), {})
    expect(listWhere().userId).toBeUndefined()
  })

  it('фильтры и пагинация не расширяют область данных', async () => {
    const result = await support.service.list(user('STUDENT'), {
      status: 'OPEN',
      search: 'урок',
      page: '2',
      limit: '10',
    })

    const args = support.findMany.mock.calls[0]?.[0]
    if (!args) throw new Error('Ожидался вызов supportTicket.findMany')
    expect(args.where.userId).toBe('student-1')
    expect(args.where.status).toBe('OPEN')
    expect(args.where.OR).toHaveLength(2)
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
    expect(result).toMatchObject({ page: 2, limit: 10, total: 1, pages: 1 })
  })

  it('некорректный статус отклоняется с 422', async () => {
    await expect(support.service.list(user('ADMIN'), { status: 'DONE' })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    })
    expect(support.findMany).not.toHaveBeenCalled()
  })
})

describe('поддержка: доступ к одному обращению', () => {
  it('своё обращение доступно, чужое — 403', async () => {
    await expect(support.service.one(user('STUDENT'), ownTicket.id)).resolves.toMatchObject({
      id: ownTicket.id,
    })
    await expect(support.service.one(user('STUDENT'), otherTicket.id)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('сотрудник видит любое обращение, отсутствующее — 404', async () => {
    await expect(support.service.one(user('ADMIN'), otherTicket.id)).resolves.toMatchObject({
      id: otherTicket.id,
    })
    await expect(support.service.one(user('ADMIN'), 'missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('поддержка: изменение и создание', () => {
  it('ученик не может менять обращение', async () => {
    await expect(
      support.service.update(user('STUDENT'), ownTicket.id, { status: 'CLOSED' }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(support.update).not.toHaveBeenCalled()
  })

  it('менеджер меняет обращение и пишет аудит', async () => {
    const updated = await support.service.update(user('MANAGER'), ownTicket.id, {
      status: 'IN_PROGRESS',
      priority: 'HIGH',
    })

    expect(updated).toMatchObject({ id: ownTicket.id, status: 'IN_PROGRESS', priority: 'HIGH' })
    expect(support.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ownTicket.id },
        data: { status: 'IN_PROGRESS', priority: 'HIGH' },
      }),
    )
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'manager-1',
        action: 'SUPPORT_TICKET_UPDATE',
        entity: 'SupportTicket',
        entityId: ownTicket.id,
      }),
    )
  })

  it('создание привязывает обращение к текущему пользователю и пишет аудит', async () => {
    const created = await support.service.create(user('PARENT', 'parent-5'), {
      subject: 'Не приходит счёт',
      message: 'Оплатили обучение, но счёт в кабинете не появился.',
      category: 'PAYMENT',
      priority: 'NORMAL',
    })

    expect(created).toMatchObject({ userId: 'parent-5', subject: 'Не приходит счёт', category: 'PAYMENT' })
    expect(support.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'parent-5',
        subject: 'Не приходит счёт',
        category: 'PAYMENT',
      }),
      select: expect.any(Object),
    })
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'parent-5',
        action: 'SUPPORT_TICKET_CREATE',
        entity: 'SupportTicket',
      }),
    )
  })
})
