import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
import { CurrentUser, RequireStepUp, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { BackupsService } from './backups.service.js'
import {
  backupApprovalSchema,
  backupRestoreSchema,
  backupRunSchema,
  backupSettingsSchema,
  type BackupSettingsInput,
} from './backups.schemas.js'

@Roles('ADMIN')
@Controller('api/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('overview')
  overview() {
    return this.backups.overview()
  }

  @Get('runs')
  runs() {
    return this.backups.runs()
  }

  @Post('runs')
  async run(
    @Body(zodBody(backupRunSchema)) body: { branchId?: string; kind: 'DATABASE' | 'FILES' },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.backups.run(body.kind, body.branchId)
    if ('status' in result) response.status(202)
    return result
  }

  @Post('runs/:id/verify')
  verify(@Param('id') id: string) {
    return this.backups.verify(id)
  }

  @Patch('branches/:id/settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(backupSettingsSchema)) body: BackupSettingsInput,
  ) {
    return this.backups.updateSettings(id, body, user.userId)
  }

  @Get('restores')
  restores() {
    return this.backups.restores()
  }

  @Post('restores')
  createRestore(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(backupRestoreSchema))
    body: { branchId?: string; backupId: string; filesBackupId?: string; reason?: string },
  ) {
    return this.backups.createRestore({ ...body, requestedBy: user.email })
  }

  @RequireStepUp()
  @Post('restores/:id/approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(backupApprovalSchema)) body: { phrase: string },
  ) {
    return this.backups.approve(id, body.phrase, user.email)
  }

  @RequireStepUp()
  @Post('restores/:id/execute')
  execute(@Param('id') id: string) {
    return this.backups.execute(id)
  }

  @Post('restores/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.backups.cancel(id)
  }
}
