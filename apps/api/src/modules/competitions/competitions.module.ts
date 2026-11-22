import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const competitionsOptions: ReadModelOptions = {
  slug: 'competitions',
  model: 'communityEvent',
  entity: 'Соревнование',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'],
  baseWhere: { type: 'COMPETITION' },
  searchFields: ['title', 'description'],
  querySchema: z.object({
    status: z.string().max(30).optional(),
    courseId: z.string().uuid().optional(),
  }),
  filters: (query) => (query.courseId ? { courseId: query.courseId } : {}),
  select: {
    id: true,
    title: true,
    description: true,
    rules: true,
    startsAt: true,
    endsAt: true,
    registrationDeadline: true,
    location: true,
    onlineUrl: true,
    capacity: true,
    status: true,
    visibility: true,
    courseId: true,
    createdById: true,
    createdAt: true,
    _count: { select: { registrations: true, results: true, awards: true } },
  },
  orderBy: { startsAt: 'desc' },
}

const CompetitionsService = createReadService(competitionsOptions)
const CompetitionsController = createReadController(competitionsOptions, CompetitionsService)

@Module({ controllers: [CompetitionsController], providers: [CompetitionsService] })
export class CompetitionsModule {}
