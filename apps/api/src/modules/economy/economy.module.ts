import { Module } from '@nestjs/common'
import { EconomyController } from './economy.controller.js'
import { EconomyService } from './economy.service.js'

@Module({
  controllers: [EconomyController],
  providers: [EconomyService],
  exports: [EconomyService],
})
export class EconomyModule {}
