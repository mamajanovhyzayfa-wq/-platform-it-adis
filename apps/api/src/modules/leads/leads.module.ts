import { Module } from '@nestjs/common'
import { LeadsController } from './leads.controller.js'
import { LeadsService } from './leads.service.js'
import { AiCenterModule } from '../ai-center/ai-center.module.js'

@Module({
  imports: [AiCenterModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
