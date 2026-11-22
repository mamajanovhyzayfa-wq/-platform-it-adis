import { Module } from '@nestjs/common'
import { BranchProvisioningService } from './branch-provisioning.service.js'
import { PlatformController } from './platform.controller.js'
import { PlatformGuard } from './platform.guard.js'
import { PlatformService } from './platform.service.js'

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, BranchProvisioningService, PlatformGuard],
})
export class PlatformModule {}
