import { Controller, Get, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { PortalService } from './portal.service.js'

/** Панели ролей и глобальный поиск. Доступ ограничен ролью пользователя. */
@Controller('api/portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Roles('STUDENT')
  @Get('student')
  student(@CurrentUser() user: AuthUser) {
    return this.portal.student(user.userId)
  }

  @Roles('TEACHER')
  @Get('mentor')
  mentor(@CurrentUser() user: AuthUser) {
    return this.portal.mentor(user.userId)
  }

  @Roles('MANAGER', 'ADMIN')
  @Get('manager')
  manager(@CurrentUser() user: AuthUser) {
    return this.portal.manager(user.userId)
  }

  @Roles('PARENT')
  @Get('parent')
  parent(@CurrentUser() user: AuthUser) {
    return this.portal.parent(user.userId)
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') query?: string) {
    return this.portal.search(user.userId, user.role, query ?? '')
  }
}
