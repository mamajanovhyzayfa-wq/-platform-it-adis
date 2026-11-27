import { CURRENCY, sumRefunded } from './finance.calc.js'
import { effectiveStatus } from './finance.invoice-status.js'
import type { InvoiceWithPayments } from './finance.shared.js'

/** Чистые преобразования моделей в ответы API: без обращений к базе. */

export interface PaymentRowInput {
  id: string
  amount: number
  method: string
  status: string
  paidAt: Date
  note: string | null
  provider?: string | null
  externalId?: string | null
}

export function toPaymentRow(payment: PaymentRowInput) {
  return {
    id: payment.id,
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt,
    note: payment.note,
    provider: payment.provider ?? null,
    externalId: payment.externalId ?? null,
  }
}

export function toInvoiceCard(invoice: InvoiceWithPayments) {
  const { totals, status } = effectiveStatus(invoice)
  const discountAmount = invoice.discounts.reduce((sum, discount) => sum + discount.amount, 0)
  return {
    id: invoice.id,
    number: invoice.number,
    description: invoice.description,
    amount: invoice.amount,
    grossAmount: invoice.amount + discountAmount,
    discountAmount,
    dueAt: invoice.dueAt,
    status,
    storedStatus: invoice.status,
    periodMonth: invoice.periodMonth,
    createdAt: invoice.createdAt,
    cancelledAt: invoice.cancelledAt,
    cancelReason: invoice.cancelReason,
    currency: CURRENCY,
    student: {
      id: invoice.student.id,
      name: `${invoice.student.firstName} ${invoice.student.lastName}`.trim(),
      email: invoice.student.email,
      phone: invoice.student.phone,
    },
    course: invoice.course,
    discounts: invoice.discounts.map((discount) => ({
      id: discount.id,
      amount: discount.amount,
      reason: discount.reason,
      createdAt: discount.createdAt,
      createdBy: discount.createdBy
        ? `${discount.createdBy.firstName} ${discount.createdBy.lastName}`.trim()
        : 'Не указан',
    })),
    totals,
    payments: invoice.payments.map((payment) => ({
      ...toPaymentRow(payment),
      refunded: sumRefunded([payment]),
      refunds: payment.refunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
        reason: refund.reason,
        createdAt: refund.createdAt,
        reviewComment: refund.reviewComment,
      })),
    })),
  }
}

export type InvoiceCard = ReturnType<typeof toInvoiceCard>
