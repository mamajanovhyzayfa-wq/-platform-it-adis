import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const managersOptions: ReadModelOptions = {
  slug: 'managers',
  model: 'user',
  entity: 'Менеджер',
  roles: ['ADMIN', 'MANAGER'],
  baseWhere: { role: 'MANAGER', deletedAt: null },
  searchFields: ['firstName', 'lastName', 'email', 'phone'],
  select: {
    id: true,
    email: true,
    phone: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    isActive: true,
    lastLoginAt: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'asc' },
}

const ManagersService = createReadService(managersOptions)
const ManagersController = createReadController(managersOptions, ManagersService)

@Module({ controllers: [ManagersController], providers: [ManagersService] })
export class ManagersModule {}
