import { z } from 'zod'
import { MAX_INVOICE_AMOUNT } from './finance.calc.js'

/** Схемы запросов финансового модуля: валидация до обращения к базе. */

const expenseCategories = ['RENT', 'SALARY', 'EQUIPMENT', 'MARKETING', 'UTILITIES', 'SOFTWARE', 'OTHER'] as const
const invoiceStatuses = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const
const paymentMethods = ['CASH', 'BANK_TRANSFER', 'ONLINE'] as const

const amount = z.number().int().min(1).max(MAX_INVOICE_AMOUNT)
const isoDate = z.string().datetime()

export const invoiceQuerySchema = z
  .object({
    status: z.enum(invoiceStatuses).optional(),
    studentId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export const invoiceCreateSchema = z
  .object({
    studentId: z.string().uuid(),
    courseId: z.string().uuid().optional(),
    description: z.string().trim().min(3).max(300),
    amount,
    dueAt: isoDate,
    periodMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц в формате YYYY-MM')
      .optional(),
  })
  .strict()

export const installmentCreateSchema = z
  .object({
    studentId: z.string().uuid(),
    courseId: z.string().uuid().optional(),
    description: z.string().trim().min(3).max(300),
    totalAmount: z.number().int().min(2).max(MAX_INVOICE_AMOUNT),
    count: z.number().int().min(2).max(60),
    firstDueAt: isoDate,
  })
  .strict()

export const paymentCreateSchema = z
  .object({
    invoiceId: z.string().uuid(),
    amount,
    method: z.enum(['CASH', 'BANK_TRANSFER']),
    note: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .strict()

export const cashPaymentSchema = z
  .object({
    invoiceId: z.string().uuid(),
    amount,
    note: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .strict()

export const refundCreateSchema = z
  .object({
    paymentId: z.string().uuid(),
    amount,
    reason: z.string().trim().min(5).max(500),
  })
  .strict()

export const refundReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comment: z.string().trim().max(500).optional(),
  })
  .strict()

export const expenseQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    category: z.enum(expenseCategories).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export const expenseCreateSchema = z
  .object({
    category: z.enum(expenseCategories).default('OTHER'),
    amount,
    spentAt: isoDate.optional(),
    description: z.string().trim().min(3).max(500),
    documentUrl: z.string().url().max(2048).optional(),
    documentUrls: z.array(z.string().url().max(2048)).max(10).optional(),
  })
  .strict()

export const priceUpdateSchema = z
  .object({
    priceKgs: z.number().int().min(0).max(MAX_INVOICE_AMOUNT),
    billing: z.enum(['FULL', 'MONTHLY', 'INSTALLMENT']).default('FULL'),
    installmentsCount: z.number().int().min(1).max(60).default(1),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()

export const invoiceDiscountSchema = z
  .object({ amount, reason: z.string().trim().min(3).max(300) })
  .strict()

export const paymentAdjustmentSchema = z
  .object({
    amount: amount.optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']).optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine((value) => value.amount !== undefined || value.status !== undefined, { message: 'Укажите сумму или статус' })

export const providerAccountSchema = z
  .object({
    id: z.string().uuid().optional(),
    provider: z.enum(['freedompay', 'elsom']),
    label: z.string().trim().min(2).max(120),
    merchantId: z.string().trim().min(1).max(120),
    tenantId: z.string().trim().max(120).optional(),
    secretEnvVar: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,80}$/),
    webhookSecretEnvVar: z.string().trim().max(120).optional(),
    baseUrl: z.string().url().optional(),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const teacherRateSchema = z
  .object({ lessonRateKgs: z.number().int().min(0).max(MAX_INVOICE_AMOUNT) })
  .strict()

export const overviewQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()

export const paymentQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']).optional(),
    method: z.enum(paymentMethods).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export const lookupQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()

export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>
export type InstallmentCreateInput = z.infer<typeof installmentCreateSchema>
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>
export type CashPaymentInput = z.infer<typeof cashPaymentSchema>
export type RefundCreateInput = z.infer<typeof refundCreateSchema>
export type RefundReviewInput = z.infer<typeof refundReviewSchema>
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>
export type PriceUpdateInput = z.infer<typeof priceUpdateSchema>
export type InvoiceDiscountInput = z.infer<typeof invoiceDiscountSchema>
export type PaymentAdjustmentInput = z.infer<typeof paymentAdjustmentSchema>
export type ProviderAccountInput = z.infer<typeof providerAccountSchema>
export type TeacherRateInput = z.infer<typeof teacherRateSchema>
export type OverviewQuery = z.infer<typeof overviewQuerySchema>
export type PaymentQuery = z.infer<typeof paymentQuerySchema>
export type LookupQuery = z.infer<typeof lookupQuerySchema>
