import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const classroomsOptions: ReadModelOptions = {
  slug: 'classrooms',
  model: 'classroom',
  entity: 'Аудитория',
  roles: ['ADMIN', 'MANAGER', 'TEACHER'],
  searchFields: ['name', 'location'],
  querySchema: z.object({ active: z.enum(['true', 'false']).optional() }),
  filters: (query) => (query.active ? { isActive: query.active === 'true' } : {}),
  select: {
    id: true,
    name: true,
    capacity: true,
    equipment: true,
    location: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  },
  orderBy: { name: 'asc' },
}

const ClassroomsService = createReadService(classroomsOptions)
const ClassroomsController = createReadController(classroomsOptions, ClassroomsService)

@Module({ controllers: [ClassroomsController], providers: [ClassroomsService] })
export class ClassroomsModule {}
