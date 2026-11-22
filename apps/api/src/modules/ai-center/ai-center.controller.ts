import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { AiCenterService } from './ai-center.service.js'
import {
  aiFlagSchema, aiResolveSchema, aiRoleLimitSchema, aiRunSchema, aiSettingsSchema, aiUserLimitSchema,
  automationRunSchema, automationSchema, automationUpdateSchema,
} from './ai-center.schemas.js'
import type { RoleName } from '@prisma/client'

const toInt = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

/** AI-центр филиала: отдельные инструменты ролей, история, лимиты и автоматизации. */
@Controller('api/ai-center')
export class AiCenterController {
  constructor(private readonly ai: AiCenterService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.ai.status(user.userId, user.role)
  }

  @Get('tools')
  tools(@CurrentUser() user: AuthUser) {
    return this.ai.tools(user.userId, user.role)
  }

  @Post('run')
  run(@CurrentUser() user: AuthUser, @Body(zodBody(aiRunSchema)) body: z.infer<typeof aiRunSchema>) {
    return this.ai.run(user.userId, user.role, body)
  }

  @Get('history')
  history(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('feature') feature?: string,
  ) {
    return this.ai.history(user.userId, user.role, { page: toInt(page, 1), limit: toInt(limit, 20), feature })
  }

  @Delete('history')
  clearHistory(@CurrentUser() user: AuthUser) {
    return this.ai.clearHistory(user.userId)
  }

  @Delete('history/:id')
  deleteHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.deleteHistory(id, user.userId, user.role)
  }

  @Post('history/:id/flag')
  flagHistory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(aiFlagSchema)) body: z.infer<typeof aiFlagSchema>,
  ) {
    return this.ai.flagHistory(id, user.userId, user.role, body.feedback)
  }

  @Roles('ADMIN', 'MANAGER')
  @Get('errors')
  errors(@CurrentUser() user: AuthUser) {
    return this.ai.errors(user.role)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('errors/:id/resolve')
  resolveError(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(aiResolveSchema)) body: z.infer<typeof aiResolveSchema>,
  ) {
    return this.ai.resolveError(id, user, body.resolution)
  }

  @Roles('ADMIN')
  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.ai.settings(user.role)
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(aiSettingsSchema)) body: z.infer<typeof aiSettingsSchema>,
  ) {
    return this.ai.updateSettings(user, body)
  }

  @Roles('ADMIN')
  @Patch('limits/role/:role')
  updateRoleLimit(
    @CurrentUser() user: AuthUser,
    @Param('role') role: RoleName,
    @Body(zodBody(aiRoleLimitSchema)) body: z.infer<typeof aiRoleLimitSchema>,
  ) {
    return this.ai.updateRoleLimit(user, role, body)
  }

  @Roles('ADMIN')
  @Patch('limits/user/:userId')
  updateUserLimit(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(zodBody(aiUserLimitSchema)) body: z.infer<typeof aiUserLimitSchema>,
  ) {
    return this.ai.updateUserLimit(user, userId, body)
  }

  @Roles('ADMIN', 'MANAGER')
  @Get('automations')
  automations(@CurrentUser() user: AuthUser) {
    return this.ai.automations(user.role)
  }

  @Roles('ADMIN')
  @Post('automations')
  createAutomation(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(automationSchema)) body: z.infer<typeof automationSchema>,
  ) {
    return this.ai.createAutomation(user, body)
  }

  @Roles('ADMIN')
  @Patch('automations/:id')
  updateAutomation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(automationUpdateSchema)) body: z.infer<typeof automationUpdateSchema>,
  ) {
    return this.ai.updateAutomation(user, id, body)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('automations/runs/:runId/approve')
  approveRun(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.ai.approveAutomationRun(runId, user)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('automations/:id/run')
  runAutomation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(automationRunSchema)) body: z.infer<typeof automationRunSchema>,
  ) {
    return this.ai.runAutomation(id, user, Boolean(body.approved))
  }
}
