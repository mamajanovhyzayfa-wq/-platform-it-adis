import { Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { ZodError } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { AppError, forbidden, notFound } from '../../lib/errors.js'
import type { AuthUser } from '../../nest/common/decorators.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import {
  supportCreateSchema,
  supportQuerySchema,
  supportUpdateSchema,
  type SupportCreateInput,
  type SupportUpdateInput,
} from './support.dto.js'

const staff: RoleName[] = ['ADMIN', 'MANAGER']

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, input: SupportCreateInput) {
    const ticket = await this.prisma.client.supportTicket.create({
      data: { ...input, userId: user.userId },
      select: this.publicSelect(),
    })
    await writeAudit({
      actorId: user.userId,
      action: 'SUPPORT_TICKET_CREATE',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: { category: input.category, priority: input.priority },
    })
    return ticket
  }

  async list(user: AuthUser, raw: Record<string, unknown>) {
    const query = this.parseQuery(raw)
    const where = {
      ...(staff.includes(user.role) ? {} : { userId: user.userId }),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' as const } },
              { message: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const [data, total] = await Promise.all([
      this.prisma.client.supportTicket.findMany({
        where,
        select: this.publicSelect(),
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.supportTicket.count({ where }),
    ])
    return { data, page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) }
  }

  async one(user: AuthUser, id: string) {
    const ticket = await this.prisma.client.supportTicket.findUnique({
      where: { id },
      select: this.publicSelect(),
    })
    if (!ticket) throw notFound('Обращение не найдено')
    if (!staff.includes(user.role) && ticket.userId !== user.userId) throw forbidden()
    return ticket
  }

  async update(user: AuthUser, id: string, raw: SupportUpdateInput) {
    if (!staff.includes(user.role)) throw forbidden('Обращения обрабатывают администратор или менеджер')
    const input = this.parseUpdate(raw)
    const existing = await this.prisma.client.supportTicket.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw notFound('Обращение не найдено')
    const ticket = await this.prisma.client.supportTicket.update({
      where: { id },
      data: input,
      select: this.publicSelect(),
    })
    await writeAudit({
      actorId: user.userId,
      action: 'SUPPORT_TICKET_UPDATE',
      entity: 'SupportTicket',
      entityId: id,
      metadata: { status: input.status, priority: input.priority, assignedToId: input.assignedToId },
    })
    return ticket
  }

  private parseQuery(raw: Record<string, unknown>) {
    try {
      return supportQuerySchema.parse(raw)
    } catch (error) {
      throw this.validation(error)
    }
  }

  private parseUpdate(raw: SupportUpdateInput) {
    try {
      return supportUpdateSchema.parse(raw)
    } catch (error) {
      throw this.validation(error)
    }
  }

  private validation(error: unknown) {
    if (error instanceof ZodError) {
      return new AppError(
        422,
        'VALIDATION_ERROR',
        'Проверьте обращение',
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      )
    }
    return error
  }

  private publicSelect() {
    return {
      id: true,
      userId: true,
      subject: true,
      message: true,
      category: true,
      status: true,
      priority: true,
      assignedToId: true,
      resolution: true,
      createdAt: true,
      updatedAt: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
    }
  }
}
