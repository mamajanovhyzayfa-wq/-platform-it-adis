import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  copyLessonSchema,
  courseCreateSchema,
  courseUpdateSchema,
  highlightSchema,
  lessonBlocksSchema,
  lessonCreateSchema,
  moduleSchema,
  materialCreateSchema,
  noteSchema,
  reviewSchema,
  type BlockInput,
} from '../../modules/lms/lms.schemas.js'
import { LmsService } from './lms.service.js'

/**
 * LMS. Курсы создают администратор, менеджер и наставник.
 * Публикация — только после одобрения администратором.
 */
@Controller('api/lms')
export class LmsController {
  constructor(private readonly lms: LmsService) {}

  // ---------- управление курсами ----------

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('courses')
  courses(@CurrentUser() user: AuthUser) {
    return this.lms.listCourses(user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses')
  createCourse(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(courseCreateSchema)) body: z.infer<typeof courseCreateSchema>,
  ) {
    return this.lms.createCourse(body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('teachers')
  teachers() {
    return this.lms.listTeachers()
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('courses/:id/preview')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.previewCourse(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('courses/:id')
  updateCourse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(courseUpdateSchema)) body: z.infer<typeof courseUpdateSchema>,
  ) {
    return this.lms.updateCourse(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses/:id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.submitForReview(id, user.userId, user.role)
  }

  @Roles('ADMIN')
  @Post('courses/:id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reviewSchema)) body: { approve: boolean; reason?: string },
  ) {
    return this.lms.reviewCourse(id, user.userId, body.approve, body.reason)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses/:id/copy')
  copyCourse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.copyCourse(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses/:id/versions')
  saveVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ note: z.string().trim().max(200).optional() }))) body: { note?: string },
  ) {
    return this.lms.createCourseVersion(id, user.userId, user.role, body.note)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('courses/:id/versions')
  versions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.courseVersions(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses/:id/versions/:version/restore')
  restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.lms.restoreCourseVersion(id, version, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('courses/:id/participants')
  participants(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.participants(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('courses/:id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.stats(id, user.userId, user.role)
  }

  // ---------- конструктор уроков ----------

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('courses/:id/modules')
  createModule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(moduleSchema)) body: { title: string; description?: string },
  ) {
    return this.lms.createModule(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('modules/:id')
  updateModule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(moduleSchema.partial())) body: { title?: string; description?: string },
  ) {
    return this.lms.updateModule(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @HttpCode(204)
  @Delete('modules/:id')
  async removeModule(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.lms.removeModule(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('modules/:moduleId/lessons')
  createLesson(
    @CurrentUser() user: AuthUser,
    @Param('moduleId') moduleId: string,
    @Body(zodBody(lessonCreateSchema.omit({ moduleId: true })))
    body: Omit<z.infer<typeof lessonCreateSchema>, 'moduleId'>,
  ) {
    return this.lms.createLesson({ ...body, moduleId }, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('lessons/:id/builder')
  builder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.builderLesson(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('lessons/:id/blocks')
  saveBlocks(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(lessonBlocksSchema))
    body: { blocks: BlockInput[]; autosave: boolean; note?: string; title?: string; durationMinutes?: number },
  ) {
    return this.lms.saveLessonBlocks(id, user.userId, user.role, body)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('lessons/:id/versions')
  lessonVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.lessonVersions(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('lessons/:id/versions/:version/restore')
  restoreLesson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.lms.restoreLessonVersion(id, version, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('lessons/:id/copy')
  copyLesson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(copyLessonSchema)) body: { targetModuleId?: string },
  ) {
    return this.lms.copyLesson(id, user.userId, user.role, body.targetModuleId)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('lessons/:id/materials')
  addMaterial(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(materialCreateSchema)) body: z.infer<typeof materialCreateSchema>,
  ) {
    return this.lms.addMaterial(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @HttpCode(204)
  @Delete('materials/:id')
  async removeMaterial(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.lms.removeMaterial(id, user.userId, user.role)
  }

  // ---------- ученик ----------

  @Roles('STUDENT')
  @Get('learn/courses/:id')
  learnCourse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.learnCourse(id, user.userId)
  }

  @Roles('STUDENT')
  @Get('learn/lessons/:id')
  learnLesson(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.learnLesson(id, user.userId)
  }

  @Roles('STUDENT')
  @Post('materials/:id/bookmark')
  toggleBookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lms.toggleBookmark(id, user.userId)
  }

  @Roles('STUDENT')
  @Post('materials/:id/highlights')
  addHighlight(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(highlightSchema)) body: { quote: string; note?: string; color: string },
  ) {
    return this.lms.addHighlight(id, user.userId, body)
  }

  @Roles('STUDENT')
  @HttpCode(204)
  @Delete('highlights/:id')
  async removeHighlight(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.lms.removeHighlight(id, user.userId)
  }

  @Roles('STUDENT')
  @Put('lessons/:id/note')
  saveNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(noteSchema)) body: { body: string },
  ) {
    return this.lms.saveNote(id, user.userId, body.body)
  }

  @Roles('STUDENT')
  @Get('library')
  library(@CurrentUser() user: AuthUser) {
    return this.lms.library(user.userId)
  }
}
