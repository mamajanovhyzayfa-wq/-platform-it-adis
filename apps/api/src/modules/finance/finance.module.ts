import { Module } from '@nestjs/common'
import { FinanceAccessService } from './finance.access.js'
import { AnalyticsService } from './analytics.service.js'
import { ExpensesService } from './expenses.service.js'
import { FinanceController } from './finance.controller.js'
import { FinanceLookupService } from './finance.lookups.js'
import { FinanceService } from './finance.service.js'
import { InvoicesService } from './invoices.service.js'
import { PaymentsService } from './payments.service.js'
import { PricingService } from './pricing.service.js'
import { RefundsService } from './refunds.service.js'
import { OnlinePaymentsService } from './online-payments.service.js'

/**
 * Финансовый модуль: фасад для контроллера и отдельные сервисы по доменам.
 * PrismaService предоставляется глобальным PrismaModule.
 */
@Module({
  controllers: [FinanceController],
  providers: [
    FinanceAccessService,
    InvoicesService,
    PaymentsService,
    RefundsService,
    ExpensesService,
    PricingService,
    AnalyticsService,
    OnlinePaymentsService,
    FinanceLookupService,
    FinanceService,
  ],
  exports: [FinanceService],
})
export class FinanceModule {}
