import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const paymentsOptions: ReadModelOptions = {
  slug: 'payments',
  model: 'payment',
  entity: 'Платёж',
  roles: ['ADMIN', 'MANAGER'],
  searchFields: ['provider', 'externalId', 'note'],
  querySchema: z.object({ invoiceId: z.string().uuid().optional() }),
  filters: (query) => (query.invoiceId ? { invoiceId: query.invoiceId } : {}),
  select: {
    id: true,
    invoiceId: true,
    amount: true,
    method: true,
    status: true,
    provider: true,
    externalId: true,
    note: true,
    paidAt: true,
    confirmedAt: true,
    createdAt: true,
    invoice: {
      select: {
        id: true,
        number: true,
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    },
  },
  orderBy: { paidAt: 'desc' },
}

const PaymentsService = createReadService(paymentsOptions)
const PaymentsController = createReadController(paymentsOptions, PaymentsService)

@Module({ controllers: [PaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
