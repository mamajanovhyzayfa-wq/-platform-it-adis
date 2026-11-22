import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../src/nest/common/decorators.js'
import type { PrismaService } from '../src/nest/prisma/prisma.service.js'
import { prisma } from '../src/lib/prisma.js'
import { getTenant, runWithTenant, type TenantContext } from '../src/lib/tenant.js'
import { SupportService } from '../src/modules/support/support.service.js'

/**
 * Изоляция данных филиалов на уровне Prisma-прокси.
 *
 * Доменные сервисы используют `prisma` из lib/prisma, а не конкретный клиент.
 * Прокси обязан выбрать клиент текущего TenantContext. Если эта логика
 * сломается, запрос филиала A молча уйдёт в БД филиала B — тест должен
 * поймать это до production.
 */

interface FakeClient {
  course?: { findFirst: ReturnType<typeof vi.fn>; findMany?: ReturnType<typeof vi.fn> }
  supportTicket?: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
}

function tenant(branchId: string, client: FakeClient): TenantContext {
  return {
    branchId,
    branchSlug: branchId,
    domain: `${branchId}.itadis.kg`,
    isPrimary: branchId === 'primary',
    prisma: client as unknown as TenantContext['prisma'],
    uploadsDir: `/tmp/${branchId}`,
  }
}

function ticket(branchId: string) {
  return {
    id: `ticket-${branchId}`,
    userId: `student-${branchId}`,
    subject: `Обращение ${branchId}`,
    message: 'Только для своего филиала',
    category: 'TECHNICAL',
    status: 'OPEN',
    priority: 'NORMAL',
    assignedToId: null,
    resolution: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    assignedTo: null,
  }
}

function supportClient(branchId: string): FakeClient {
  const own = ticket(branchId)
  return {
    supportTicket: {
      // Клиент филиала физически не знает идентификаторы другого филиала.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === own.id ? own : null,
      ),
      findMany: vi.fn(async () => [own]),
      count: vi.fn(async () => 1),
    },
  }
}

function student(branchId: string): AuthUser {
  return { userId: `student-${branchId}`, role: 'STUDENT', email: `student@${branchId}.kg` }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Prisma-прокси: физическая изоляция баз филиалов', () => {
  it('направляет запрос в клиент текущего филиала', async () => {
    const a = { course: { findFirst: vi.fn(async () => ({ branchId: 'a' })) } }
    const b = { course: { findFirst: vi.fn(async () => ({ branchId: 'b' })) } }

    const fromA = await runWithTenant(tenant('a', a), () => prisma.course.findFirst({}))
    const fromB = await runWithTenant(tenant('b', b), () => prisma.course.findFirst({}))

    expect(fromA).toEqual({ branchId: 'a' })
    expect(fromB).toEqual({ branchId: 'b' })
    expect(a.course.findFirst).toHaveBeenCalledTimes(1)
    expect(b.course.findFirst).toHaveBeenCalledTimes(1)
  })

  it('не смешивает контексты параллельных запросов разных филиалов', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const a = {
      course: {
        findFirst: vi.fn(async () => {
          await gate
          return { branchId: 'a' }
        }),
      },
    }
    const b = {
      course: {
        findFirst: vi.fn(async () => {
          await gate
          return { branchId: 'b' }
        }),
      },
    }

    const requestA = runWithTenant(tenant('a', a), () => prisma.course.findFirst({}))
    const requestB = runWithTenant(tenant('b', b), () => prisma.course.findFirst({}))
    release()
    const [fromA, fromB] = await Promise.all([requestA, requestB])

    expect(fromA).toEqual({ branchId: 'a' })
    expect(fromB).toEqual({ branchId: 'b' })
    expect(a.course.findFirst).toHaveBeenCalledTimes(1)
    expect(b.course.findFirst).toHaveBeenCalledTimes(1)
  })

  it('очищает контекст после завершения запроса', async () => {
    const a = { course: { findFirst: vi.fn(async () => ({ branchId: 'a' })) } }
    expect(getTenant()).toBeUndefined()
    await runWithTenant(tenant('a', a), () => prisma.course.findFirst({}))
    expect(getTenant()).toBeUndefined()
  })

  it('не отдаёт обращение филиала A по идентификатору на домене B', async () => {
    const clientA = supportClient('a')
    const clientB = supportClient('b')
    const service = new SupportService({ client: prisma } as unknown as PrismaService)

    const own = await runWithTenant(tenant('a', clientA), () => service.one(student('a'), 'ticket-a'))
    expect(own.id).toBe('ticket-a')

    await expect(
      runWithTenant(tenant('a', clientA), () => service.one(student('a'), 'ticket-b')),
    ).rejects.toMatchObject({ status: 404 })

    await expect(
      runWithTenant(tenant('b', clientB), () => service.one(student('b'), 'ticket-a')),
    ).rejects.toMatchObject({ status: 404 })

    // Каждый клиент получил только свои запросы, чужой клиент не участвовал.
    expect(clientA.supportTicket?.findUnique).toHaveBeenCalledTimes(2)
    expect(clientB.supportTicket?.findUnique).toHaveBeenCalledTimes(1)
  })

  it('ограничивает список обращений данными текущего филиала', async () => {
    const clientA = supportClient('a')
    const clientB = supportClient('b')
    const service = new SupportService({ client: prisma } as unknown as PrismaService)

    const pageA = await runWithTenant(tenant('a', clientA), () =>
      service.list(student('a'), { page: 1, limit: 10 }),
    )
    const pageB = await runWithTenant(tenant('b', clientB), () =>
      service.list(student('b'), { page: 1, limit: 10 }),
    )

    expect(pageA.data.map((item) => item.id)).toEqual(['ticket-a'])
    expect(pageB.data.map((item) => item.id)).toEqual(['ticket-b'])
    expect(clientA.supportTicket?.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'student-a' }) }),
    )
    expect(clientB.supportTicket?.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'student-b' }) }),
    )
  })
})
