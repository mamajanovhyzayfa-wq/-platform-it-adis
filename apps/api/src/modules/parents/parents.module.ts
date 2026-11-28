import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const parentsOptions: ReadModelOptions = {
  slug: 'parents',
  model: 'parent',
  entity: 'Родитель',
  roles: ['ADMIN', 'MANAGER'],
  select: {
    id: true,
    workplace: true,
    createdAt: true,
    user: {
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        isActive: true,
      },
    },
    childLinks: {
      select: {
        id: true,
        relation: true,
        isPrimary: true,
        verifiedAt: true,
        student: {
          select: {
            id: true,
            gradeLevel: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    },
  },
  orderBy: { createdAt: 'desc' },
}

const ParentsService = createReadService(parentsOptions)
const ParentsController = createReadController(parentsOptions, ParentsService)

@Module({ controllers: [ParentsController], providers: [ParentsService] })
export class ParentsModule {}
