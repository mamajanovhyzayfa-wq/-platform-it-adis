import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { InvoicesService } from './invoices.service.js'
import { PaymentsService } from './payments.service.js'
import { RefundsService } from './refunds.service.js'
import { ExpensesService } from './expenses.service.js'
import { PricingService } from './pricing.service.js'
import { AnalyticsService } from './analytics.service.js'
import { FinanceLookupService } from './finance.lookups.js'
import type {
  CashPaymentInput,
  ExpenseCreateInput,
  ExpenseQuery,
  InstallmentCreateInput,
  InvoiceCreateInput,
  InvoiceDiscountInput,
  InvoiceQuery,
  PaymentAdjustmentInput,
  TeacherRateInput,
  LookupQuery,
  OverviewQuery,
  PaymentCreateInput,
  PaymentQuery,
  PriceUpdateInput,
  RefundCreateInput,
  RefundReviewInput,
} from './finance.schemas.js'

/**
 * Финансовый контур филиала.
 *
 * Фасад сохраняет единую точку входа для контроллера, а реализация разделена по
 * доменам: счета, платежи, возвраты, расходы, тарифы, аналитика и справочники.
 *
 * Доступ к суммам и возвратам — только у администратора. Менеджер регистрирует
 * наличные платежи и не получает агрегатов. Ученик и родитель видят только
 * собственные счета; проверки выполняются в FinanceAccessService.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(FinanceLookupService) private readonly lookups: FinanceLookupService,
  ) {}

  // ------------------------------------------------------------------ счета

  listInvoices(query: InvoiceQuery) {
    return this.invoices.listInvoices(query)
  }

  getInvoice(invoiceId: string, user: { userId: string; role: RoleName }) {
    return this.invoices.getInvoice(invoiceId, user)
  }

  createInvoice(input: InvoiceCreateInput, actorId: string) {
    return this.invoices.createInvoice(input, actorId)
  }

  createInstallments(input: InstallmentCreateInput, actorId: string) {
    return this.invoices.createInstallments(input, actorId)
  }

  cancelInvoice(invoiceId: string, reason: string, actorId: string) {
    return this.invoices.cancelInvoice(invoiceId, reason, actorId)
  }

  myFinance(userId: string, role: RoleName) {
    return this.invoices.myFinance(userId, role)
  }

  receiptHtml(invoiceId: string, user: { userId: string; role: RoleName }): Promise<string> {
    return this.invoices.receiptHtml(invoiceId, user)
  }

  receiptPdf(invoiceId: string, user: { userId: string; role: RoleName }): Promise<Buffer> {
    return this.invoices.receiptPdf(invoiceId, user)
  }

  applyDiscount(invoiceId: string, input: InvoiceDiscountInput, actorId: string) {
    return this.invoices.applyDiscount(invoiceId, input, actorId)
  }

  // ---------------------------------------------------------------- платежи

  registerPayment(input: PaymentCreateInput, actor: { userId: string; role: RoleName }) {
    return this.payments.registerPayment(input, actor)
  }

  registerCashPayment(input: CashPaymentInput, actor: { userId: string; role: RoleName }) {
    return this.payments.registerCashPayment(input, actor)
  }

  listPayments(query: PaymentQuery) {
    return this.payments.listPayments(query)
  }

  adjustPayment(paymentId: string, input: PaymentAdjustmentInput, adminId: string) {
    return this.payments.adjustPayment(paymentId, input, adminId)
  }

  // --------------------------------------------------------------- возвраты

  listRefunds(status?: 'REQUESTED' | 'APPROVED' | 'REJECTED') {
    return this.refunds.listRefunds(status)
  }

  requestRefund(input: RefundCreateInput, actorId: string) {
    return this.refunds.requestRefund(input, actorId)
  }

  reviewRefund(refundId: string, input: RefundReviewInput, adminId: string) {
    return this.refunds.reviewRefund(refundId, input, adminId)
  }

  // ---------------------------------------------------------------- расходы

  listExpenses(query: ExpenseQuery) {
    return this.expenses.listExpenses(query)
  }

  createExpense(input: ExpenseCreateInput, actorId: string) {
    return this.expenses.createExpense(input, actorId)
  }

  deleteExpense(expenseId: string, actorId: string) {
    return this.expenses.deleteExpense(expenseId, actorId)
  }

  // ----------------------------------------------------------------- тарифы

  coursePricing() {
    return this.pricing.coursePricing()
  }

  updateCoursePrice(courseId: string, input: PriceUpdateInput, actorId: string) {
    return this.pricing.updateCoursePrice(courseId, input, actorId)
  }

  teacherEarnings(query: OverviewQuery) {
    return this.pricing.teacherEarnings(query)
  }

  updateTeacherRate(userId: string, input: TeacherRateInput, actorId: string) {
    return this.pricing.updateTeacherRate(userId, input, actorId)
  }

  // -------------------------------------------------------------- аналитика

  overview(query: OverviewQuery) {
    return this.analytics.overview(query)
  }

  exportCsv(query: OverviewQuery) {
    return this.analytics.exportCsv(query)
  }

  exportAccounting(query: OverviewQuery) {
    return this.analytics.exportAccounting(query)
  }

  // ------------------------------------------------------- менеджер и поиск

  studentsLookup(query: LookupQuery) {
    return this.lookups.studentsLookup(query)
  }

  managerInvoices(search?: string) {
    return this.lookups.managerInvoices(search)
  }

  providerStatus() {
    return this.lookups.providerStatus()
  }
}
