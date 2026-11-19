import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type LeadAudience, type LeadSource, type LeadStatus } from '@prisma/client'
import { z } from 'zod'
import { badRequest, notFound } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { PrismaService } from '../../prisma/prisma.service.js'

/** Телефон принимаем в привычных форматах, но храним только цифры и ведущий «+». */
const phoneSchema = z
  .string()
  .trim()
  .min(9, 'Укажите телефон')
  .max(24, 'Телефон слишком длинный')
  .transform((value) => value.replace(/[^\d+]/g, ''))
  .refine((value) => /^\+?\d{9,15}$/.test(value), 'Телефон должен содержать 9–15 цифр')

export const leadCreateSchema = z
  .object({
    name: z.string().trim().min(2, 'Минимум 2 символа').max(80, 'Не больше 80 символов'),
    phone: phoneSchema,
    email: z.union([z.string().trim().email('Некорректный email').max(160), z.literal('')]).optional(),
    audience: z.enum(['STUDENT', 'PARENT', 'PARTNER']).default('STUDENT'),
    message: z.string().trim().max(1000, 'Не больше 1000 символов').optional(),
    consent: z.boolean().refine((value) => value, 'Нужно согласие на обработку данных'),
  })
  .strict()

export const leadsQuerySchema = z
  .object({
    status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'REJECTED']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export const leadUpdateSchema = z
  .object({
    status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'REJECTED']).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Нет полей для изменения')

export type LeadCreateInput = z.infer<typeof leadCreateSchema>
export type LeadsQuery = z.infer<typeof leadsQuerySchema>
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>

export interface LeadCard {
  id: string
  name: string
  phone: string
  email: string | null
  audience: LeadAudience
  message: string | null
  status: LeadStatus
  source: LeadSource
  note: string | null
  assignedTo: { id: string; firstName: string; lastName: string } | null
  contactedAt: string | null
  closedAt: string | null
  createdAt: string
}

const leadInclude = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeadInclude

function toCard(lead: Prisma.LeadGetPayload<{ include: typeof leadInclude }>): LeadCard {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    audience: lead.audience,
    message: lead.message,
    status: lead.status,
    source: lead.source,
    note: lead.note,
    assignedTo: lead.assignedTo,
    contactedAt: lead.contactedAt?.toISOString() ?? null,
    closedAt: lead.closedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
  }
}

/**
 * CRM-заявки.
 *
 * Публичный метод создаёт заявку без авторизации: это единственная точка входа
 * с лендинга, поэтому она защищена лимитом запросов на уровне контроллера.
 * Просмотр, назначение и смена статуса доступны менеджеру и администратору;
 * каждое изменение статуса пишется в журнал аудита.
 */
@Injectable()
export class LeadsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: LeadCreateInput): Promise<{ id: string; status: LeadStatus }> {
    const lead = await this.prisma.client.lead.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        audience: input.audience,
        message: input.message?.trim() || null,
        consentAt: new Date(),
        source: 'LANDING',
      },
      select: { id: true, status: true },
    })

    await writeAudit({
      action: 'lead.created',
      entity: 'Lead',
      entityId: lead.id,
      metadata: { audience: input.audience, source: 'LANDING' },
    })

    return lead
  }

  async list(query: LeadsQuery) {
    const where: Prisma.LeadWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.client.lead.count({ where }),
      this.prisma.client.lead.findMany({
        where,
        include: leadInclude,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ])

    return {
      items: items.map(toCard),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    }
  }

  async stats() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [grouped, total, newToday] = await Promise.all([
      this.prisma.client.lead.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.client.lead.count(),
      this.prisma.client.lead.count({ where: { createdAt: { gte: today } } }),
    ])

    const byStatus: Record<LeadStatus, number> = {
      NEW: 0,
      CONTACTED: 0,
      CONVERTED: 0,
      REJECTED: 0,
    }
    for (const group of grouped) byStatus[group.status] = group._count._all

    return { total, newToday, byStatus }
  }

  async update(id: string, input: LeadUpdateInput, actorId: string): Promise<LeadCard> {
    const current = await this.prisma.client.lead.findUnique({ where: { id } })
    if (!current) throw notFound('Заявка не найдена')

    if (input.assignedToId) {
      const assignee = await this.prisma.client.user.findUnique({
        where: { id: input.assignedToId },
        select: { id: true, role: true, isActive: true },
      })
      if (!assignee || !assignee.isActive) throw badRequest('Сотрудник не найден или заблокирован')
      if (assignee.role !== 'MANAGER' && assignee.role !== 'ADMIN') {
        throw badRequest('Заявку можно назначить только менеджеру или администратору')
      }
    }

    const now = new Date()
    const status = input.status
    const timestamps: Prisma.LeadUpdateInput = {}

    if (status) {
      if (status === 'CONTACTED') {
        timestamps.contactedAt = current.contactedAt ?? now
        timestamps.closedAt = null
      }
      if (status === 'CONVERTED' || status === 'REJECTED') {
        timestamps.contactedAt = current.contactedAt ?? now
        timestamps.closedAt = now
      }
      if (status === 'NEW') {
        timestamps.closedAt = null
      }
    }

    const updated = await this.prisma.client.lead.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.assignedToId !== undefined
          ? input.assignedToId
            ? { assignedTo: { connect: { id: input.assignedToId } } }
            : { assignedTo: { disconnect: true } }
          : {}),
        ...timestamps,
      },
      include: leadInclude,
    })

    await writeAudit({
      actorId,
      action: 'lead.updated',
      entity: 'Lead',
      entityId: id,
      metadata: {
        before: { status: current.status, assignedToId: current.assignedToId },
        after: { status: updated.status, assignedToId: updated.assignedToId },
      },
    })

    return toCard(updated)
  }
}
