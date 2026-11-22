import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { badRequest } from '../../lib/errors.js'
import { CurrentUser, RequireStepUp, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { RolesService, STANDARD_ROLES } from './roles.service.js'

interface RoleRequestBody {
  role?: RoleName
  reason?: string
}

interface ParentLinkBody {
  code?: string
}

@Controller('api/roles')
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  /** Роли текущего пользователя для выбора кабинета и проверки доступа. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.roles.getMyRoles(user.userId)
  }

  /** Запрос дополнительной роли; до подтверждения администратором роль не действует. */
  @Post('requests')
  requestRole(@CurrentUser() user: AuthUser, @Body() body: RoleRequestBody) {
    if (!body.role || !STANDARD_ROLES.includes(body.role)) {
      throw badRequest('Неизвестная роль')
    }
    return this.roles.requestRole(user.userId, body.role, body.reason?.slice(0, 500))
  }

  @Get('requests/pending')
  @Roles('ADMIN')
  pending() {
    return this.roles.listPendingRequests()
  }

  @Post('requests/:id/approve')
  @Roles('ADMIN')
  @RequireStepUp()
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.decideRequest(user.userId, id, true)
  }

  @Post('requests/:id/reject')
  @Roles('ADMIN')
  @RequireStepUp()
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.decideRequest(user.userId, id, false)
  }

  @Get('parent-links/pending')
  @Roles('ADMIN')
  pendingParentLinks() {
    return this.roles.listPendingParentLinks()
  }

  /** Администратор выпускает одноразовый код привязки родителя к ученику. */
  @Post('parent-links/codes')
  @Roles('ADMIN')
  issueCode(@CurrentUser() user: AuthUser, @Body() body: { studentId?: string }) {
    if (!body.studentId) throw badRequest('Не указан ученик')
    return this.roles.createParentLinkCode(user.userId, body.studentId)
  }

  /** Родитель вводит код, выданный администратором для ребёнка. */
  @Post('parent-links/redeem')
  redeem(@CurrentUser() user: AuthUser, @Body() body: ParentLinkBody) {
    if (!body.code || !/^\d{6}$/.test(body.code)) {
      throw badRequest('Некорректный код')
    }
    return this.roles.redeemParentLinkCode(user.userId, body.code)
  }

  @Post('parent-links/:id/verify')
  @Roles('ADMIN')
  @RequireStepUp()
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.verifyParentLink(user.userId, id)
  }
}
