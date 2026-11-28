import { Injectable } from '@nestjs/common'
import { z, ZodError } from 'zod'
import type { AuthUser } from '../../nest/common/decorators.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { AppError, notFound } from '../../lib/errors.js'
import type { ReadModelOptions } from './read-model.types.js'

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
})

/** Парсит query-строку и отдаёт 422 в общем формате API. */
function parseQuery(options: ReadModelOptions, raw: Record<string, unknown>): Record<string, unknown> {
  try {
    return pageSchema.extend(options.querySchema?.shape ?? {}).parse(raw)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `Проверьте параметры запроса ${options.entity}`,
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      )
    }
    throw error
  }
}

interface PrismaDelegate {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>
  count: (args: Record<string, unknown>) => Promise<number>
  findUnique: (args: Record<string, unknown>) => Promise<unknown | null>
}

function delegateFor(options: ReadModelOptions, prisma: PrismaService): PrismaDelegate {
  const client = options.controlPlane ? controlPrisma : prisma.client
  const delegate = (client as unknown as Record<string, PrismaDelegate | undefined>)[options.model]
  if (!delegate) {
    throw new AppError(500, 'MODULE_CONFIGURATION_ERROR', `Модель ${options.model} не найдена в Prisma`)
  }
  return delegate
}

function projection(options: ReadModelOptions): Record<string, unknown> {
  if (options.select) return { select: options.select }
  if (options.include) return { include: options.include }
  return {}
}

@Injectable()
class ReadModelService {
  constructor(protected readonly prisma: PrismaService) {}

  async list(options: ReadModelOptions, raw: Record<string, unknown>, user: AuthUser) {
    const query = parseQuery(options, raw)
    const page = Number(query.page)
    const limit = Number(query.limit)
    const where: Record<string, unknown> = { ...(options.baseWhere ?? {}) }

    if (typeof query.status === 'string' && query.status) where.status = query.status
    if (typeof query.search === 'string' && query.search && options.searchFields?.length) {
      where.OR = options.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      }))
    }
    if (options.filters) Object.assign(where, options.filters(query))
    if (options.scope) Object.assign(where, options.scope(user))

    const delegate = delegateFor(options, this.prisma)
    const [data, total] = await Promise.all([
      delegate.findMany({
        where,
        ...projection(options),
        orderBy: options.orderBy ?? { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      delegate.count({ where }),
    ])

    return { data, page, limit, total, pages: Math.ceil(total / limit) }
  }

  async one(options: ReadModelOptions, id: string) {
    if (!id || id.length > 100) throw notFound(`${options.entity} не найден`)
    const delegate = delegateFor(options, this.prisma)
    const data = await delegate.findUnique({ where: { id }, ...projection(options) })
    if (!data) throw notFound(`${options.entity} не найден`)
    return data
  }
}

/**
 * Создаёт сервис модуля с фиксированным описанием модели. Каждый модуль
 * получает собственный класс-наследник, поэтому DI и тесты остаются явными.
 */
export function createReadService(options: ReadModelOptions) {
  @Injectable()
  class DomainReadService extends ReadModelService {
    constructor(prisma: PrismaService) {
      super(prisma)
    }

    listDomain(raw: Record<string, unknown>, user: AuthUser) {
      return this.list(options, raw, user)
    }

    oneDomain(id: string) {
      return this.one(options, id)
    }
  }

  return DomainReadService
}
