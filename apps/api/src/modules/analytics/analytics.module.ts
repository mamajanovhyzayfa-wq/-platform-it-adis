import { Module } from '@nestjs/common'
import { AnalyticsCenterModule } from '../analytics-center/analytics-center.module.js'

/** Публичное имя домена Analytics; реализация — AnalyticsCenterModule. */
@Module({
  imports: [AnalyticsCenterModule],
  exports: [AnalyticsCenterModule],
})
export class AnalyticsModule {}
