import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { examCreateSchema, examUpdateSchema, gradingScaleSchema } from '../assessment/assessment.schemas.js'
import { ExamService } from './exam.service.js'
import { GradingService } from './grading.service.js'

const publishSchema = z.object({ published: z.boolean() })

@Controller('api/assessment')
export class ExamAssessmentController {
  constructor(
    @Inject(ExamService) private readonly exams: ExamService,
    @Inject(GradingService) private readonly grading: GradingService,
  ) {}

  // ---------- экзамены ----------

  @Get('exams')
  examsList(@CurrentUser() user: AuthUser) {
    return this.exams.list(user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('exams')
  createExam(@CurrentUser() user: AuthUser, @Body(zodBody(examCreateSchema)) body: z.infer<typeof examCreateSchema>) {
    return this.exams.create(body, user.userId, user.role)
  }

  @Get('exams/:id')
  examDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.detail(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('exams/:id')
  updateExam(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(examUpdateSchema)) body: z.infer<typeof examUpdateSchema>,
  ) {
    return this.exams.update(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('exams/:id/publish')
  publishExam(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(zodBody(publishSchema)) body: { published: boolean }) {
    return this.exams.publish(id, user.userId, user.role, body.published)
  }

  @Roles('STUDENT')
  @Post('exams/:id/register')
  registerExam(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.register(id, user.userId)
  }

  @Roles('STUDENT')
  @HttpCode(204)
  @Delete('exams/:id/register')
  async cancelExamRegistration(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.exams.cancelRegistration(id, user.userId)
  }

  @Roles('STUDENT')
  @Post('exams/:id/start')
  startExam(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.start(id, user.userId)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('exams/:id/results')
  examResults(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.results(id, user.userId, user.role)
  }

  // ---------- академические шкалы ----------

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('grading/scales')
  scales() {
    return this.grading.list()
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('grading/scales')
  createScale(@CurrentUser() user: AuthUser, @Body(zodBody(gradingScaleSchema)) body: z.infer<typeof gradingScaleSchema>) {
    return this.grading.create(body, user.userId)
  }

  @Roles('ADMIN', 'MANAGER')
  @Patch('grading/scales/:id')
  updateScale(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(gradingScaleSchema)) body: z.infer<typeof gradingScaleSchema>,
  ) {
    return this.grading.update(id, body, user.userId)
  }

  @Roles('ADMIN', 'MANAGER')
  @HttpCode(204)
  @Delete('grading/scales/:id')
  async removeScale(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.grading.remove(id, user.userId)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('grading/scales/:id/default')
  async defaultScale(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.grading.setDefault(id, user.userId)
    return { ok: true }
  }
}
