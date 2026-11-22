import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { CURRENCY } from './finance.calc.js'
import { EXPENSE_CATEGORY_LABELS, parseRange } from './finance.shared.js'
import type { ExpenseCreateInput, ExpenseQuery } from './finance.schemas.js'

/** Учёт расходов филиала: аренда, зарплаты, оборудование и прочее. */
@Injectable()
export class ExpensesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listExpenses(query: ExpenseQuery) {
    const range = query.from || query.to ? parseRange(query, 90) : null
    const where: Prisma.ExpenseWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(range ? { spentAt: { gte: range.from, lte: range.to } } : {}),
    }

    const [items, total, sum] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        include: { createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { spentAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.expense.count({ where }),
      this.prisma.client.expense.aggregate({ where, _sum: { amount: true } }),
    ])

    return {
      items: items.map((expense) => ({
        id: expense.id,
        category: expense.category,
        categoryLabel: EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category,
        amount: expense.amount,
        spentAt: expense.spentAt,
        description: expense.description,
        documentUrl: expense.documentUrl,
        documentUrls: Array.isArray(expense.documentUrls) ? expense.documentUrls : [],
        createdBy: `${expense.createdBy.firstName} ${expense.createdBy.lastName}`.trim(),
        createdAt: expense.createdAt,
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
      sum: sum._sum.amount ?? 0,
      currency: CURRENCY,
    }
  }

  async createExpense(input: ExpenseCreateInput, actorId: string) {
    const expense = await this.prisma.client.expense.create({
      data: {
        category: input.category,
        amount: input.amount,
        spentAt: input.spentAt ? new Date(input.spentAt) : new Date(),
        description: input.description,
        documentUrl: input.documentUrl ?? input.documentUrls?.[0] ?? null,
        documentUrls: (input.documentUrls ?? (input.documentUrl ? [input.documentUrl] : [])) as Prisma.InputJsonValue,
        createdById: actorId,
      },
    })
    await writeAudit({
      actorId,
      action: 'finance.expense.created',
      entity: 'expense',
      entityId: expense.id,
      metadata: { amount: expense.amount, category: expense.category },
    })
    return expense
  }

  async deleteExpense(expenseId: string, actorId: string) {
    const expense = await this.prisma.client.expense.findUnique({ where: { id: expenseId } })
    if (!expense) throw notFound('Расход не найден')
    await this.prisma.client.expense.delete({ where: { id: expenseId } })
    await writeAudit({
      actorId,
      action: 'finance.expense.deleted',
      entity: 'expense',
      entityId: expenseId,
      metadata: { amount: expense.amount, category: expense.category, description: expense.description },
    })
    return { deleted: true }
  }
}
