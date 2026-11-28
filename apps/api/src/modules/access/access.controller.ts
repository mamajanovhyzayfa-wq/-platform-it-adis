import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { CurrentUser, Public, RequireStepUp, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  invitationAcceptSchema,
  invitationCreateSchema,
  registrationApplySchema,
  registrationDecisionSchema,
  adminResetAccessSchema,
  type InvitationAcceptInput,
  type InvitationCreateInput,
  type RegistrationApplyInput,
} from '../../modules/access/access.schemas.js'
import { AccessService } from './access.service.js'

function metaOf(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  }
}

/**
 * Регистрация через заявку и приглашения.
 * Публичные маршруты ограничены по частоте, решения принимает только администратор.
 */
@Controller('api/access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('registration')
  apply(@Body(zodBody(registrationApplySchema)) body: RegistrationApplyInput, @Req() req: Request) {
    return this.access.apply(body, metaOf(req))
  }

  @Roles('ADMIN')
  @Get('registrations')
  registrations(@Query('status') status?: string) {
    const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const
    const value = allowed.includes((status ?? 'PENDING') as (typeof allowed)[number])
      ? ((status ?? 'PENDING') as (typeof allowed)[number])
      : 'PENDING'
    return this.access.listRegistrations(value)
  }

  @Roles('ADMIN')
  @RequireStepUp()
  @Post('registrations/:id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(registrationDecisionSchema)) body: { approve: boolean; reason?: string },
  ) {
    return this.access.decideRegistration(user.userId, id, body.approve, body.reason)
  }

  @Roles('ADMIN')
  @RequireStepUp()
  @Post('invitations')
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(invitationCreateSchema)) body: InvitationCreateInput,
  ) {
    return this.access.createInvitation(user.userId, body)
  }

  @Roles('ADMIN')
  @Get('invitations')
  invitations() {
    return this.access.listInvitations()
  }

  @Public()
  @Get('invitations/:code')
  preview(@Param('code') code: string) {
    return this.access.previewInvitation(code)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('invitations/accept')
  accept(@Body(zodBody(invitationAcceptSchema)) body: InvitationAcceptInput, @Req() req: Request) {
    return this.access.acceptInvitation(body, metaOf(req))
  }

  /** Восстановление доступа администратором — важная операция, нужен повторный пароль. */
  @Roles('ADMIN')
  @RequireStepUp()
  @Post('users/:id/reset-access')
  resetAccess(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(adminResetAccessSchema)) body: { newPassword?: string },
  ) {
    return this.access.adminResetAccess(user.userId, id, body.newPassword)
  }
}
