import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const expensesOptions: ReadModelOptions = {
  slug: 'expenses',
  model: 'expense',
  entity: 'Расход',
  roles: ['ADMIN', 'MANAGER'],
  searchFields: ['description'],
  querySchema: z.object({
    category: z.string().max(40).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
  filters: (query) => ({
    ...(query.category ? { category: query.category } : {}),
    ...(query.from || query.to
      ? { spentAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  }),
  select: {
    id: true,
    category: true,
    amount: true,
    spentAt: true,
    description: true,
    documentUrl: true,
    documentUrls: true,
    createdById: true,
    createdAt: true,
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  },
  orderBy: { spentAt: 'desc' },
}

const ExpensesService = createReadService(expensesOptions)
const ExpensesController = createReadController(expensesOptions, ExpensesService)

@Module({ controllers: [ExpensesController], providers: [ExpensesService] })
export class ExpensesModule {}
