import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../common/decorators.js'
import { zodBody } from '../../common/zod.pipe.js'
import { badRequest } from '../../../lib/errors.js'
import {
  TeacherService,
  homeworkCreateSchema,
  homeworkUpdateSchema,
  reviewSchema,
  submissionQuerySchema,
  type HomeworkCreateInput,
  type HomeworkUpdateInput,
  type ReviewInput,
  type SubmissionQuery,
} from './teacher.service.js'

/** Проверяет query-параметры и отдаёт 400 вместо 500 при мусоре. */
function parseQuery(raw: Record<string, unknown>): SubmissionQuery {
  const result = submissionQuerySchema.safeParse(raw)
  if (!result.success) {
    throw badRequest(
      'Некорректные параметры фильтра',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/** Кабинет преподавателя: сводка, свои курсы и проверка домашних работ. */
@Roles('TEACHER', 'ADMIN')
@Controller('api/teacher')
export class TeacherController {
  constructor(private readonly teacher: TeacherService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.teacher.overview(user.userId, user.role)
  }

  @Get('courses')
  courses(@CurrentUser() user: AuthUser) {
    return this.teacher.myCourses(user.userId, user.role)
  }

  @Get('courses/:id')
  course(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teacher.courseDetail(id, user.userId, user.role)
  }

  @Post('courses/:courseId/homework')
  createHomework(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Body(zodBody(homeworkCreateSchema)) body: HomeworkCreateInput,
  ) {
    return this.teacher.createHomework(courseId, body, user.userId, user.role)
  }

  @Get('homework/:id')
  homework(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teacher.homeworkDetail(id, user.userId, user.role)
  }

  @Patch('homework/:id')
  updateHomework(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(homeworkUpdateSchema)) body: HomeworkUpdateInput,
  ) {
    return this.teacher.updateHomework(id, body, user.userId, user.role)
  }

  @Get('submissions')
  submissions(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.teacher.submissions(user.userId, user.role, parseQuery(query))
  }

  @Get('submissions/:id')
  submission(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teacher.submissionDetail(id, user.userId, user.role)
  }

  @Post('submissions/:id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reviewSchema)) body: ReviewInput,
  ) {
    return this.teacher.reviewSubmission(id, body, user.userId, user.role)
  }
}
