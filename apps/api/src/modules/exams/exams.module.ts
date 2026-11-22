import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'
import { TestsModule } from '../tests/tests.module.js'
import { ExamAssessmentController } from './exam-assessment.controller.js'
import { ExamService } from './exam.service.js'
import { GradingService } from './grading.service.js'

export const examsOptions: ReadModelOptions = {
  slug: 'exams',
  model: 'exam',
  entity: 'Экзамен',
  roles: ['ADMIN', 'MANAGER', 'TEACHER'],
  searchFields: ['title', 'description'],
  querySchema: z.object({
    courseId: z.string().uuid().optional(),
    published: z.enum(['true', 'false']).optional(),
  }),
  filters: (query) => ({
    ...(query.courseId ? { courseId: query.courseId } : {}),
    ...(query.published ? { isPublished: query.published === 'true' } : {}),
  }),
  select: {
    id: true,
    courseId: true,
    testId: true,
    title: true,
    description: true,
    startsAt: true,
    endsAt: true,
    durationMinutes: true,
    maxAttempts: true,
    passingScore: true,
    isPublished: true,
    createdById: true,
    createdAt: true,
    course: { select: { id: true, title: true } },
    _count: { select: { registrations: true, attempts: true } },
  },
  orderBy: { startsAt: 'desc' },
}

const ExamsReadService = createReadService(examsOptions)
const ExamsReadController = createReadController(examsOptions, ExamsReadService)

@Module({
  imports: [TestsModule],
  controllers: [ExamsReadController, ExamAssessmentController],
  providers: [ExamsReadService, ExamService, GradingService],
  exports: [ExamsReadService, ExamService, GradingService],
})
export class ExamsModule {}
