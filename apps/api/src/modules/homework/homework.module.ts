import { Module } from '@nestjs/common'
import { AiCenterModule } from '../ai-center/ai-center.module.js'
import { HomeworkController } from './homework.controller.js'
import { HomeworkService } from './homework.service.js'

@Module({
  imports: [AiCenterModule],
  controllers: [HomeworkController],
  providers: [HomeworkService],
  exports: [HomeworkService],
})
export class HomeworkModule {}
