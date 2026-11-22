import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  aiReviewSchema,
  homeworkCreateSchema,
  homeworkReviewSchema,
  homeworkSubmitSchema,
  homeworkUpdateSchema,
} from '../assessment/assessment.schemas.js'
import { HomeworkService } from './homework.service.js'

@Controller('api/assessment')
export class HomeworkController {
  constructor(@Inject(HomeworkService) private readonly homework: HomeworkService) {}

  // ---------- домашние задания ----------

  @Get('homework')
  homeworkList(@CurrentUser() user: AuthUser) {
    return this.homework.list(user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('homework')
  homeworkCreate(@CurrentUser() user: AuthUser, @Body(zodBody(homeworkCreateSchema)) body: z.infer<typeof homeworkCreateSchema>) {
    return this.homework.create(body, user.userId, user.role)
  }

  @Get('homework/:id')
  homeworkDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.homework.detail(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('homework/:id')
  homeworkUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(homeworkUpdateSchema)) body: z.infer<typeof homeworkUpdateSchema>,
  ) {
    return this.homework.update(id, body, user.userId, user.role)
  }

  @Roles('STUDENT')
  @Post('homework/:id/submit')
  homeworkSubmit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(homeworkSubmitSchema)) body: z.infer<typeof homeworkSubmitSchema>,
  ) {
    return this.homework.submit(id, user.userId, body)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('submissions/:id/review')
  homeworkReview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(homeworkReviewSchema)) body: z.infer<typeof homeworkReviewSchema>,
  ) {
    return this.homework.review(id, user.userId, user.role, body)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('submissions/:id/ai-review')
  homeworkAiReview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(aiReviewSchema)) body: { instructions?: string },
  ) {
    return this.homework.aiReview(id, user.userId, user.role, body.instructions)
  }

  @Get('homework/:id/history')
  homeworkHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.homework.history(id, user.userId, user.role)
  }

}
