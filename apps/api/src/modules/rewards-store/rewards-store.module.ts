import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const rewardsStoreOptions: ReadModelOptions = {
  slug: 'rewards-store',
  model: 'shopProduct',
  entity: 'Награда магазина',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'],
  searchFields: ['title', 'description', 'category'],
  querySchema: z.object({
    active: z.enum(['true', 'false']).optional(),
    category: z.string().trim().max(60).optional(),
  }),
  filters: (query) => ({
    ...(query.active ? { isActive: query.active === 'true' } : {}),
    ...(query.category ? { category: query.category } : {}),
  }),
  select: {
    id: true,
    title: true,
    description: true,
    imageUrl: true,
    category: true,
    priceCoins: true,
    stock: true,
    unlimitedStock: true,
    isActive: true,
    kind: true,
    fulfillment: true,
    terms: true,
    createdAt: true,
  },
  orderBy: { priceCoins: 'asc' },
}

const RewardsStoreService = createReadService(rewardsStoreOptions)
const RewardsStoreController = createReadController(rewardsStoreOptions, RewardsStoreService)

@Module({ controllers: [RewardsStoreController], providers: [RewardsStoreService] })
export class RewardsStoreModule {}
