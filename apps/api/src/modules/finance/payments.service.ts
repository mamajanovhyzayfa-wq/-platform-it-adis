import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { CURRENCY } from './finance.calc.js'
import { effectiveStatus, recalculateInvoiceStatus } from './finance.invoice-status.js'
import { notifyInvoiceParties } from './finance.notify.js'
import { toInvoiceCard, toPaymentRow } from './finance.mappers.js'
import { invoiceInclude, parseRange } from './finance.shared.js'
import type { CashPaymentInput, PaymentAdjustmentInput, PaymentCreateInput, PaymentQuery } from './finance.schemas.js'

/** Платежи: приём в кассе, регистрация администратором и реестр поступлений. */
@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async registerPayment(input: PaymentCreateInput, actor: { userId: string; role: RoleName }) {
    return this.registerPaymentInternal({
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      actor,
    })
  }

  /** Наличный платёж от менеджера: без аналитики и без доступа к счетам других учеников. */
  async registerCashPayment(input: CashPaymentInput, actor: { userId: string; role: RoleName }) {
    if (actor.role !== 'MANAGER' && actor.role !== 'ADMIN') {
      throw forbidden('Регистрировать наличные платежи может менеджер или администратор')
    }
    return this.registerPaymentInternal({
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: 'CASH',
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      actor,
    })
  }

  private async registerPaymentInternal(input: {
    invoiceId: string
    amount: number
    method: 'CASH' | 'BANK_TRANSFER'
    note?: string
    idempotencyKey?: string
    actor: { userId: string; role: RoleName }
  }) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.client.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { invoice: { include: invoiceInclude } },
      })
      if (existing) {
        return {
          duplicate: true,
          payment: toPaymentRow(existing),
          invoice: toInvoiceCard(existing.invoice),
        }
      }
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Блокировка счёта исключает двойную оплату при одновременных запросах.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`

      const invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        include: invoiceInclude,
      })
      if (!invoice) throw notFound('Счёт не найден')
      if (invoice.status === 'CANCELLED') throw badRequest('Нельзя оплатить отменённый счёт')

      const { totals } = effectiveStatus(invoice)
      if (input.amount > totals.remaining) {
        throw badRequest(
          `Сумма ${input.amount} ${CURRENCY} превышает остаток ${totals.remaining} ${CURRENCY} по счёту ${invoice.number}`,
        )
      }

      const now = new Date()
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: input.amount,
          method: input.method,
          status: 'CONFIRMED',
          note: input.note ?? null,
          registeredById: input.actor.userId,
          confirmedById: input.actor.userId,
          confirmedAt: now,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      })

      await recalculateInvoiceStatus(tx, invoice.id)
      const refreshed = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceInclude })
      return { payment, invoice: refreshed, previousRemaining: totals.remaining }
    })

    await writeAudit({
      actorId: input.actor.userId,
      action: 'finance.payment.registered',
      entity: 'payment',
      entityId: result.payment.id,
      metadata: {
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.number,
        amount: result.payment.amount,
        method: result.payment.method,
      },
    })

    const card = toInvoiceCard(result.invoice)
    await notifyInvoiceParties({
      invoiceId: result.invoice.id,
      type: 'PAYMENT_RECEIVED',
      title: 'Платёж получен',
      body: `${result.payment.amount} ${CURRENCY} по счёту ${result.invoice.number}. Остаток: ${card.totals.remaining} ${CURRENCY}`,
    })

    return { duplicate: false, payment: toPaymentRow(result.payment), invoice: card }
  }

  /** Ручная корректировка администратора: только с причиной и записью в историю. */
  async adjustPayment(paymentId: string, input: PaymentAdjustmentInput, adminId: string) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } })
      if (!payment) throw notFound('Платёж не найден')
      const approvedRefunded = payment.refunds.filter((refund) => refund.status === 'APPROVED').reduce((sum, refund) => sum + refund.amount, 0)
      const nextAmount = input.amount ?? payment.amount
      if (nextAmount < approvedRefunded) throw badRequest('Сумма платежа не может быть меньше уже одобренного возврата')
      const nextStatus = input.status ?? payment.status
      if (nextStatus === 'REFUNDED' && approvedRefunded === 0) throw badRequest('Для статуса «Возвращён» оформите возврат через заявку')
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { amount: nextAmount, status: nextStatus, note: input.reason.slice(0, 300) },
      })
      await tx.paymentAdjustment.create({
        data: {
          paymentId,
          previousAmount: payment.amount,
          newAmount: nextAmount,
          previousStatus: payment.status,
          newStatus: nextStatus,
          reason: input.reason,
          adjustedById: adminId,
        },
      })
      await recalculateInvoiceStatus(tx, payment.invoiceId)
      return { payment: updated, previousAmount: payment.amount, previousStatus: payment.status }
    })
    await writeAudit({ actorId: adminId, action: 'finance.payment.adjusted', entity: 'Payment', entityId: paymentId, metadata: { previousAmount: result.previousAmount, previousStatus: result.previousStatus, newAmount: result.payment.amount, newStatus: result.payment.status, reason: input.reason } })
    await notifyInvoiceParties({
      invoiceId: result.payment.invoiceId,
      type: 'SYSTEM',
      title: 'Платёж скорректирован',
      body: `${result.previousAmount} → ${result.payment.amount} ${CURRENCY}. Причина: ${input.reason}`,
    })
    return toPaymentRow(result.payment)
  }

  async listPayments(query: PaymentQuery) {
    const range = query.from || query.to ? parseRange(query, 90) : null
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(range ? { paidAt: { gte: range.from, lte: range.to } } : {}),
      ...(query.search
        ? {
            OR: [
              { invoice: { number: { contains: query.search, mode: 'insensitive' } } },
              { invoice: { student: { firstName: { contains: query.search, mode: 'insensitive' } } } },
              { invoice: { student: { lastName: { contains: query.search, mode: 'insensitive' } } } },
              { invoice: { student: { email: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.client.payment.findMany({
        where,
        include: {
          invoice: {
            select: {
              id: true,
              number: true,
              amount: true,
              student: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          registeredBy: { select: { id: true, firstName: true, lastName: true } },
          refunds: { select: { amount: true, status: true } },
        },
        orderBy: { paidAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.payment.count({ where }),
    ])

    return {
      items: items.map((payment) => ({
        ...toPaymentRow(payment),
        student: payment.invoice.student,
        invoice: {
          id: payment.invoice.id,
          number: payment.invoice.number,
          amount: payment.invoice.amount,
        },
        registeredBy: payment.registeredBy
          ? `${payment.registeredBy.firstName} ${payment.registeredBy.lastName}`.trim()
          : null,
        refunded: payment.refunds
          .filter((refund) => refund.status === 'APPROVED')
          .reduce((sum, refund) => sum + refund.amount, 0),
        pendingRefund: payment.refunds
          .filter((refund) => refund.status === 'REQUESTED')
          .reduce((sum, refund) => sum + refund.amount, 0),
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
      currency: CURRENCY,
    }
  }
}
