import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser, RequirePermissions, Roles } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { conflict } from '../../lib/errors.js'
import type { AuthUser } from '../../nest/common/decorators.js'
import {
  UsersService,
  changePasswordSchema,
  deviceIdSchema,
  patchMeSchema,
  pushTokenSchema,
  type PatchMeInput,
  type PushTokenInput,
} from './users.service.js'

/** Личный кабинет: профиль текущего пользователя и связанные данные. */
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.userId)
  }

  @Patch('me')
  patchMe(@CurrentUser() user: AuthUser, @Body(zodBody(patchMeSchema)) body: PatchMeInput) {
    return this.users.updateProfile(user.userId, body)
  }

  @HttpCode(204)
  @Post('me/password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    await this.users.changePassword(user.userId, body.currentPassword, body.newPassword)
  }

  @Post('me/push-token')
  registerPushToken(@CurrentUser() user: AuthUser, @Body(zodBody(pushTokenSchema)) body: PushTokenInput) {
    return this.users.registerPushToken(user.userId, body)
  }

  @Delete('me/push-token')
  removePushToken(@CurrentUser() user: AuthUser, @Query('deviceId') deviceId: string) {
    const parsed = deviceIdSchema.parse({ deviceId })
    return this.users.removePushToken(user.userId, parsed.deviceId)
  }

  @Get('me/courses')
  getMyCourses(@CurrentUser() user: AuthUser) {
    return this.users.getMyCourses(user.userId)
  }

  @Get('me/permissions')
  getPermissions(@CurrentUser() user: AuthUser) {
    return this.users.getEffectivePermissions(user.role)
  }

  @Roles('TEACHER', 'ADMIN')
  @RequirePermissions('analytics.view')
  @Get('me/students')
  getMyStudents(@CurrentUser() user: AuthUser) {
    return this.users.getMyStudents(user.userId, user.role)
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.getById(id, user.userId, user.role)
  }

  @Delete('me')
  async deleteMe(@CurrentUser() _user: AuthUser): Promise<never> {
    // Мгновенное удаление обходило бы обязательное рассмотрение администратором.
    throw conflict('Удаление аккаунта выполняется по заявке: POST /api/privacy/account-deletion')
  }
}
