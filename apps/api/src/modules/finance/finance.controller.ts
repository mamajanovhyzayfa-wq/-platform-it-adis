import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentUser, Public, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { badRequest } from '../../lib/errors.js'
import { FinanceService } from './finance.service.js'
import { OnlinePaymentsService } from './online-payments.service.js'
import {
  cashPaymentSchema,
  expenseCreateSchema,
  expenseQuerySchema,
  installmentCreateSchema,
  invoiceCreateSchema,
  invoiceDiscountSchema,
  invoiceQuerySchema,
  lookupQuerySchema,
  overviewQuerySchema,
  paymentAdjustmentSchema,
  paymentCreateSchema,
  paymentQuerySchema,
  priceUpdateSchema,
  providerAccountSchema,
  refundCreateSchema,
  refundReviewSchema,
  teacherRateSchema,
  type CashPaymentInput,
  type ExpenseCreateInput,
  type ExpenseQuery,
  type InstallmentCreateInput,
  type InvoiceCreateInput,
  type InvoiceDiscountInput,
  type InvoiceQuery,
  type LookupQuery,
  type OverviewQuery,
  type PaymentAdjustmentInput,
  type PaymentCreateInput,
  type PaymentQuery,
  type PriceUpdateInput,
  type ProviderAccountInput,
  type RefundCreateInput,
  type RefundReviewInput,
  type TeacherRateInput,
} from './finance.schemas.js'

const cancelSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict()
const refundQuerySchema = z
  .object({ status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED']).optional() })
  .strict()

/** Разбор входа: единый формат 400 с указанием полей вместо 500. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw badRequest(
      'Проверьте правильность заполнения полей',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/**
 * Финансовый кабинет.
 *
 * Роли распределены по маршрутам: суммы и аналитика — только ADMIN, касса —
 * MANAGER, собственные счета — STUDENT и PARENT. Проверка владения счётом
 * выполняется в сервисе по данным из токена, а не по параметрам запроса.
 */
@Controller('api/finance')
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly online: OnlinePaymentsService,
  ) {}

  @Roles('ADMIN')
  @Get('overview')
  overview(@Query() query: Record<string, unknown>) {
    const input: OverviewQuery = parse(overviewQuerySchema, query)
    return this.finance.overview(input)
  }

  @Roles('ADMIN')
  @Get('invoices')
  invoices(@Query() query: Record<string, unknown>) {
    const input: InvoiceQuery = parse(invoiceQuerySchema, query)
    return this.finance.listInvoices(input)
  }

  @Roles('ADMIN')
  @Post('invoices')
  createInvoice(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: InvoiceCreateInput = parse(invoiceCreateSchema, body)
    return this.finance.createInvoice(input, user.userId)
  }

  @Roles('ADMIN')
  @Post('invoices/installments')
  createInstallments(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: InstallmentCreateInput = parse(installmentCreateSchema, body)
    return this.finance.createInstallments(input, user.userId)
  }

  @Roles('ADMIN', 'STUDENT', 'PARENT')
  @Get('invoices/:id')
  invoice(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.finance.getInvoice(id, user)
  }

  @Roles('ADMIN', 'STUDENT', 'PARENT')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('invoices/:id/receipt')
  receipt(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.finance.receiptHtml(id, user)
  }

  @Roles('ADMIN', 'STUDENT', 'PARENT')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="itadis-receipt.pdf"')
  @Get('invoices/:id/pdf')
  async receiptPdf(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<StreamableFile> {
    return new StreamableFile(await this.finance.receiptPdf(id, user))
  }

  @Roles('ADMIN')
  @Patch('invoices/:id/discount')
  applyDiscount(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: InvoiceDiscountInput = parse(invoiceDiscountSchema, body)
    return this.finance.applyDiscount(id, input, user.userId)
  }

  @Roles('ADMIN')
  @Patch('invoices/:id/cancel')
  cancelInvoice(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(cancelSchema, body)
    return this.finance.cancelInvoice(id, input.reason, user.userId)
  }

  @Roles('ADMIN', 'STUDENT', 'PARENT')
  @Post('invoices/:id/checkout')
  checkout(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.online.checkout(id, user)
  }

  @Roles('ADMIN')
  @Get('payments')
  payments(@Query() query: Record<string, unknown>) {
    const input: PaymentQuery = parse(paymentQuerySchema, query)
    return this.finance.listPayments(input)
  }

  @Roles('ADMIN')
  @Post('payments')
  registerPayment(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: PaymentCreateInput = parse(paymentCreateSchema, body)
    return this.finance.registerPayment(input, user)
  }

  @Roles('ADMIN')
  @Patch('payments/:id')
  adjustPayment(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: PaymentAdjustmentInput = parse(paymentAdjustmentSchema, body)
    return this.finance.adjustPayment(id, input, user.userId)
  }

  @Roles('ADMIN')
  @Get('refunds')
  refunds(@Query() query: Record<string, unknown>) {
    const input = parse(refundQuerySchema, query)
    return this.finance.listRefunds(input.status)
  }

  @Roles('ADMIN')
  @Post('refunds')
  requestRefund(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: RefundCreateInput = parse(refundCreateSchema, body)
    return this.finance.requestRefund(input, user.userId)
  }

  @Roles('ADMIN')
  @Patch('refunds/:id')
  reviewRefund(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: RefundReviewInput = parse(refundReviewSchema, body)
    return this.finance.reviewRefund(id, input, user.userId)
  }

  @Roles('ADMIN')
  @Get('expenses')
  expenses(@Query() query: Record<string, unknown>) {
    const input: ExpenseQuery = parse(expenseQuerySchema, query)
    return this.finance.listExpenses(input)
  }

  @Roles('ADMIN')
  @Post('expenses')
  createExpense(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: ExpenseCreateInput = parse(expenseCreateSchema, body)
    return this.finance.createExpense(input, user.userId)
  }

  @Roles('ADMIN')
  @Delete('expenses/:id')
  deleteExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.finance.deleteExpense(id, user.userId)
  }

  @Roles('ADMIN')
  @Get('courses')
  courses() {
    return this.finance.coursePricing()
  }

  @Roles('ADMIN')
  @Patch('courses/:id/price')
  updatePrice(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: PriceUpdateInput = parse(priceUpdateSchema, body)
    return this.finance.updateCoursePrice(id, input, user.userId)
  }

  @Roles('ADMIN')
  @Get('students')
  students(@Query() query: Record<string, unknown>) {
    const input: LookupQuery = parse(lookupQuerySchema, query)
    return this.finance.studentsLookup(input)
  }

  @Roles('ADMIN')
  @Get('provider')
  provider() {
    return this.finance.providerStatus()
  }

  @Roles('ADMIN')
  @Get('provider-accounts')
  providerAccounts() {
    return this.online.accounts()
  }

  @Roles('ADMIN')
  @Post('provider-accounts')
  createProviderAccount(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: ProviderAccountInput = parse(providerAccountSchema, body)
    return this.online.upsertAccount(user, input)
  }

  @Roles('ADMIN')
  @Patch('provider-accounts/:id')
  updateProviderAccount(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: ProviderAccountInput = parse(providerAccountSchema, { ...(body as object), id })
    return this.online.upsertAccount(user, input)
  }

  @Roles('ADMIN')
  @Get('teacher-earnings')
  teacherEarnings(@Query() query: Record<string, unknown>) {
    const input: OverviewQuery = parse(overviewQuerySchema, query)
    return this.finance.teacherEarnings(input)
  }

  @Roles('ADMIN')
  @Patch('teachers/:userId/rate')
  updateTeacherRate(@Param('userId') userId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: TeacherRateInput = parse(teacherRateSchema, body)
    return this.finance.updateTeacherRate(userId, input, user.userId)
  }

  @Roles('ADMIN')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="itadis-finance.csv"')
  async exportCsv(@Query() query: Record<string, unknown>) {
    const input: OverviewQuery = parse(overviewQuerySchema, query)
    return this.finance.exportCsv(input)
  }

  @Roles('ADMIN')
  @Get('accounting')
  accounting(@Query() query: Record<string, unknown>) {
    const input: OverviewQuery = parse(overviewQuerySchema, query)
    return this.finance.exportAccounting(input)
  }

  /** Личная финансовая история: ученик — своя, родитель — только подтверждённые дети. */
  @Roles('STUDENT', 'PARENT')
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.finance.myFinance(user.userId, user.role)
  }

  /** Касса менеджера: незакрытые счета для приёма наличных. */
  @Roles('MANAGER', 'ADMIN')
  @Get('manager/invoices')
  managerInvoices(@Query() query: Record<string, unknown>) {
    const input: LookupQuery = parse(lookupQuerySchema, query)
    return this.finance.managerInvoices(input.search)
  }

  @Roles('MANAGER', 'ADMIN')
  @Post('manager/cash-payments')
  managerCashPayment(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input: CashPaymentInput = parse(cashPaymentSchema, body)
    return this.finance.registerCashPayment(input, user)
  }

  /** Вебхуки локальных провайдеров. Подпись/статус проверяются в адаптере. */
  @Public()
  @Post('webhooks/freedompay')
  async freedomPayWebhook(
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Res() res: Response,
  ) {
    const raw = Buffer.isBuffer(body)
      ? body.toString('utf8')
      : typeof body === 'string'
        ? body
        : new URLSearchParams(body as Record<string, string>).toString()
    const result = await this.online.handleWebhook('freedompay', raw, contentType)
    res.status(result.status).type(result.contentType).send(result.body)
  }

  @Public()
  @Post('webhooks/elsom')
  async elsomWebhook(
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Res() res: Response,
  ) {
    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body)
    const result = await this.online.handleWebhook('elsom', raw, contentType)
    res.status(result.status).type(result.contentType).send(result.body)
  }
}
