import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../common/decorators.js'
import { zodBody } from '../../common/zod.pipe.js'
import {
  CoursesService,
  moduleCreateSchema,
  moduleUpdateSchema,
  type ModuleCreateInput,
  type ModuleUpdateInput,
} from './courses.service.js'

/**
 * Модули программы курса.
 *
 * Создавать и менять модули может только преподаватель своего курса
 * (или администратор) — проверка владения выполняется в сервисе.
 */
@Controller('api')
export class ModulesController {
  constructor(private readonly courses: CoursesService) {}

  @Roles('TEACHER', 'ADMIN')
  @Post('courses/:courseId/modules')
  create(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Body(zodBody(moduleCreateSchema)) body: ModuleCreateInput,
  ) {
    return this.courses.createModule(courseId, body, user.userId, user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch('modules/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(moduleUpdateSchema)) body: ModuleUpdateInput,
  ) {
    return this.courses.updateModule(id, body, user.userId, user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @HttpCode(204)
  @Delete('modules/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.courses.removeModule(id, user.userId, user.role)
  }
}
