import { Controller, Get, Param, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../common/decorators.js'
import { badRequest } from '../../../lib/errors.js'
import { CoursesService, catalogQuerySchema, type CatalogQuery } from './courses.service.js'

/** Парсит query-параметры и отдаёт понятную 400 вместо 500 при мусоре. */
function parseCatalogQuery(raw: Record<string, unknown>): CatalogQuery {
  const result = catalogQuerySchema.safeParse(raw)
  if (!result.success) {
    throw badRequest(
      'Некорректные параметры фильтра',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/**
 * Курсы: каталог, личные курсы, сводка для главного экрана и запись.
 * Доступ — любой авторизованный пользователь; список для ученика фильтруется сервером.
 */
@Controller('api/courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get('categories')
  categories() {
    return this.courses.listCategories()
  }

  @Get('my')
  my(@CurrentUser() user: AuthUser) {
    return this.courses.myCourses(user.userId)
  }

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.courses.overview(user.userId)
  }

  @Get()
  catalog(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.courses.catalog(parseCatalogQuery(query), user.userId, user.role)
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courses.detail(id, user.userId, user.role)
  }

  @Roles('STUDENT')
  @Post(':id/enroll')
  enroll(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courses.enroll(id, user.userId, user.role)
  }
}
