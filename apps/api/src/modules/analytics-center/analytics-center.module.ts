import { Module } from '@nestjs/common'
import { FinanceModule } from '../finance/finance.module.js'
import { AnalyticsCenterController } from './analytics-center.controller.js'
import { AnalyticsCenterService } from './analytics-center.service.js'

@Module({
  imports: [FinanceModule],
  controllers: [AnalyticsCenterController],
  providers: [AnalyticsCenterService],
})
export class AnalyticsCenterModule {}
