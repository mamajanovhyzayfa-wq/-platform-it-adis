import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { Public } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { BranchProvisioningService } from './branch-provisioning.service.js'
import { PlatformGuard } from './platform.guard.js'
import { PlatformService } from './platform.service.js'
import { branchActivateSchema, branchCreateSchema, platformLoginSchema } from './platform.schemas.js'

@Controller('api/platform')
@Public()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly provisioning: BranchProvisioningService,
  ) {}

  @Post('auth/login')
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  login(@Body(zodBody(platformLoginSchema)) body: { email: string; password: string }, @Req() req: Request) {
    return this.platform.login(req.hostname, body.email, body.password)
  }

  @Get('branches')
  @UseGuards(PlatformGuard)
  list() {
    return this.provisioning.list()
  }

  @Get('branches/:id')
  @UseGuards(PlatformGuard)
  get(@Param('id') id: string) {
    return this.provisioning.get(id)
  }

  @Post('branches')
  @UseGuards(PlatformGuard)
  create(@Body(zodBody(branchCreateSchema)) body: Parameters<BranchProvisioningService['provision']>[0]) {
    return this.provisioning.provision(body)
  }

  @Post('branches/:id/retry')
  @UseGuards(PlatformGuard)
  retry(@Param('id') id: string) {
    return this.provisioning.retry(id)
  }

  @Post('branches/:id/activate')
  @UseGuards(PlatformGuard)
  activate(
    @Param('id') id: string,
    @Body(zodBody(branchActivateSchema)) body: { confirm: true },
  ) {
    return this.provisioning.activate(id, body.confirm)
  }
}
