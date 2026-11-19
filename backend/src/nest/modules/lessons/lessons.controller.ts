import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../common/decorators.js'
import { zodBody } from '../../common/zod.pipe.js'
import {
  LessonsService,
  lessonCreateSchema,
  lessonProgressSchema,
  lessonUpdateSchema,
  type LessonCreateInput,
  type LessonUpdateInput,
} from './lessons.service.js'

/** Курсы и уроки: учебный контент, прогресс и управление уроками преподавателем. */
@Controller('api/lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lessons.detail(id, user.userId, user.role)
  }

  @Patch(':id/progress')
  saveProgress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(lessonProgressSchema)) body: { positionSeconds: number },
  ) {
    return this.lessons.saveProgress(id, user.userId, user.role, body.positionSeconds)
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lessons.complete(id, user.userId, user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(zodBody(lessonCreateSchema)) body: LessonCreateInput) {
    return this.lessons.create(body, user.userId, user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(lessonUpdateSchema)) body: LessonUpdateInput,
  ) {
    return this.lessons.update(id, body, user.userId, user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.lessons.remove(id, user.userId, user.role)
  }
}
