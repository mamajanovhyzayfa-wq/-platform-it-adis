import { Module } from '@nestjs/common'
import { AiCenterController } from './ai-center.controller.js'
import { AiCenterService } from './ai-center.service.js'

@Module({
  controllers: [AiCenterController],
  providers: [AiCenterService],
  exports: [AiCenterService],
})
export class AiCenterModule {}
