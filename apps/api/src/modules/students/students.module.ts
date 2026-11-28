import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const studentsOptions: ReadModelOptions = {
  slug: 'students',
  model: 'student',
  entity: 'Ученик',
  roles: ['ADMIN', 'MANAGER', 'TEACHER'],
  searchFields: ['schoolName', 'notes'],
  select: {
    id: true,
    gradeLevel: true,
    schoolName: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    user: {
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        lastLoginAt: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' },
}

const StudentsService = createReadService(studentsOptions)
const StudentsController = createReadController(studentsOptions, StudentsService)

@Module({ controllers: [StudentsController], providers: [StudentsService] })
export class StudentsModule {}
