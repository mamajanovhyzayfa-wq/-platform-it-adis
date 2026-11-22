import { Module } from '@nestjs/common'
import { LmsController } from './lms.controller.js'
import { LmsService } from './lms.service.js'

@Module({
  controllers: [LmsController],
  providers: [LmsService],
  exports: [LmsService],
})
export class LmsModule {}
