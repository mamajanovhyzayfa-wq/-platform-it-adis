import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const itCoinsOptions: ReadModelOptions = {
  slug: 'it-coins',
  model: 'coinTransaction',
  entity: 'IT-монета',
  roles: ['ADMIN', 'MANAGER', 'STUDENT'],
  scope: (user) => (user.role === 'STUDENT' ? { userId: user.userId } : {}),
  searchFields: ['reason', 'sourceType'],
  querySchema: z.object({
    userId: z.string().uuid().optional(),
    status: z.string().max(30).optional(),
  }),
  filters: (query) => (query.userId ? { userId: query.userId } : {}),
  select: {
    id: true,
    userId: true,
    amount: true,
    reason: true,
    sourceType: true,
    sourceId: true,
    balanceAfter: true,
    status: true,
    createdAt: true,
    user: { select: { id: true, firstName: true, lastName: true, email: true } },
  },
  orderBy: { createdAt: 'desc' },
}

const ItCoinsService = createReadService(itCoinsOptions)
const ItCoinsController = createReadController(itCoinsOptions, ItCoinsService)

@Module({ controllers: [ItCoinsController], providers: [ItCoinsService] })
export class ITCoinsModule {}

/** Публичное имя домена из ТЗ; класс остаётся прежним для обратной совместимости. */
export { ITCoinsModule as ItCoinsModule }
