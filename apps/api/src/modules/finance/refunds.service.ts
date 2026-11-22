import { Inject, Injectable } from '@nestjs/common'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { CURRENCY, refundValidationError } from './finance.calc.js'
import { recalculateInvoiceStatus } from './finance.invoice-status.js'
import { notifyInvoiceParties } from './finance.notify.js'
import type { RefundCreateInput, RefundReviewInput } from './finance.schemas.js'

/** Возвраты: заявка, рассмотрение администратором и история. */
@Injectable()
export class RefundsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listRefunds(status?: 'REQUESTED' | 'APPROVED' | 'REJECTED') {
    const items = await this.prisma.client.refund.findMany({
      where: status ? { status } : {},
      include: {
        payment: {
          select: {
            id: true,
            amount: true,
            method: true,
            paidAt: true,
            invoice: {
              select: {
                id: true,
                number: true,
                student: { select: { id: true, firstName: true, lastName: true, email: true } },
              },
            },
          },
        },
        requestedBy: { select: { firstName: true, lastName: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    return {
      items: items.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt,
        reviewedAt: refund.reviewedAt,
        reviewComment: refund.reviewComment,
        payment: {
          id: refund.payment.id,
          amount: refund.payment.amount,
          method: refund.payment.method,
          paidAt: refund.payment.paidAt,
          invoiceNumber: refund.payment.invoice.number,
          invoiceId: refund.payment.invoice.id,
          student: refund.payment.invoice.student,
        },
        requestedBy: `${refund.requestedBy.firstName} ${refund.requestedBy.lastName}`.trim(),
        reviewedBy: refund.reviewedBy
          ? `${refund.reviewedBy.firstName} ${refund.reviewedBy.lastName}`.trim()
          : null,
      })),
      currency: CURRENCY,
    }
  }

  async requestRefund(input: RefundCreateInput, actorId: string) {
    const payment = await this.prisma.client.payment.findUnique({
      where: { id: input.paymentId },
      include: { refunds: true, invoice: { select: { id: true, number: true } } },
    })
    if (!payment) throw notFound('Платёж не найден')
    if (payment.status !== 'CONFIRMED') throw badRequest('Возврат возможен только по подтверждённому платежу')
    if (payment.method === 'ONLINE') {
      throw badRequest('Возврат онлайн-платежа оформляется через платёжного провайдера; используйте его кабинет')
    }

    const approved = payment.refunds
      .filter((refund) => refund.status === 'APPROVED')
      .reduce((sum, refund) => sum + refund.amount, 0)
    const pending = payment.refunds
      .filter((refund) => refund.status === 'REQUESTED')
      .reduce((sum, refund) => sum + refund.amount, 0)

    const error = refundValidationError({
      paymentAmount: payment.amount,
      approvedRefunded: approved,
      pendingRequested: pending,
      requested: input.amount,
    })
    if (error) throw badRequest(error)

    const refund = await this.prisma.client.refund.create({
      data: {
        paymentId: payment.id,
        amount: input.amount,
        reason: input.reason,
        requestedById: actorId,
      },
    })

    await writeAudit({
      actorId,
      action: 'finance.refund.requested',
      entity: 'refund',
      entityId: refund.id,
      metadata: { paymentId: payment.id, amount: refund.amount, invoiceNumber: payment.invoice.number },
    })
    await notifyInvoiceParties({
      invoiceId: payment.invoice.id,
      type: 'REFUND_PROCESSED',
      title: 'Заявка на возврат создана',
      body: `Заявка на ${refund.amount} ${CURRENCY} по счёту ${payment.invoice.number} ожидает решения администратора`,
    })

    return { id: refund.id, status: refund.status, amount: refund.amount, createdAt: refund.createdAt }
  }

  async reviewRefund(refundId: string, input: RefundReviewInput, adminId: string) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${refundId} FOR UPDATE`

      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { payment: { include: { refunds: true, invoice: { select: { id: true, number: true, studentId: true } } } } },
      })
      if (!refund) throw notFound('Заявка на возврат не найдена')
      if (refund.status !== 'REQUESTED') throw conflict('Заявка уже рассмотрена')

      if (input.decision === 'REJECT') {
        const rejected = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: 'REJECTED',
            reviewedById: adminId,
            reviewedAt: new Date(),
            reviewComment: input.comment ?? null,
          },
        })
        return { refund: rejected, invoiceId: refund.payment.invoice.id, invoiceNumber: refund.payment.invoice.number, approved: false }
      }

      const approved = refund.payment.refunds
        .filter((item) => item.status === 'APPROVED')
        .reduce((sum, item) => sum + item.amount, 0)
      // Другие заявки на рассмотрении тоже резервируют сумму платежа.
      const pending = refund.payment.refunds
        .filter((item) => item.status === 'REQUESTED' && item.id !== refund.id)
        .reduce((sum, item) => sum + item.amount, 0)
      const error = refundValidationError({
        paymentAmount: refund.payment.amount,
        approvedRefunded: approved,
        pendingRequested: pending,
        requested: refund.amount,
      })
      if (error) throw badRequest(error)

      const approvedRefund = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'APPROVED',
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewComment: input.comment ?? null,
        },
      })

      // Если возвращена вся сумма платежа, платёж помечается REFUNDED — это видно в истории.
      if (approved + refund.amount >= refund.payment.amount) {
        await tx.payment.update({ where: { id: refund.payment.id }, data: { status: 'REFUNDED' } })
      }
      await recalculateInvoiceStatus(tx, refund.payment.invoice.id)

      return { refund: approvedRefund, invoiceId: refund.payment.invoice.id, invoiceNumber: refund.payment.invoice.number, approved: true }
    })

    await writeAudit({
      actorId: adminId,
      action: input.decision === 'APPROVE' ? 'finance.refund.approved' : 'finance.refund.rejected',
      entity: 'refund',
      entityId: refundId,
      metadata: { amount: result.refund.amount, comment: input.comment ?? null, invoiceNumber: result.invoiceNumber },
    })
    await notifyInvoiceParties({
      invoiceId: result.invoiceId,
      type: 'REFUND_PROCESSED',
      title: result.approved ? 'Возврат одобрен' : 'Возврат отклонён',
      body: `${result.refund.amount} ${CURRENCY} по счёту ${result.invoiceNumber}${
        input.comment ? `: ${input.comment}` : ''
      }`,
    })

    return { id: result.refund.id, status: result.refund.status, amount: result.refund.amount }
  }
}
