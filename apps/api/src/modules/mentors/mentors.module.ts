import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const mentorsOptions: ReadModelOptions = {
  slug: 'mentors',
  model: 'teacher',
  entity: 'Наставник',
  roles: ['ADMIN', 'MANAGER', 'STUDENT', 'PARENT'],
  searchFields: ['specialization', 'headline'],
  select: {
    id: true,
    specialization: true,
    headline: true,
    experienceYears: true,
    lessonRateKgs: true,
    createdAt: true,
    user: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
      },
    },
  },
  orderBy: { createdAt: 'asc' },
}

const MentorsService = createReadService(mentorsOptions)
const MentorsController = createReadController(mentorsOptions, MentorsService)

@Module({ controllers: [MentorsController], providers: [MentorsService] })
export class MentorsModule {}
