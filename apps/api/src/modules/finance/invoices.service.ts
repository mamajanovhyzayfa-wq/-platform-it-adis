import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import {
  CURRENCY,
  addMonths,
  formatInvoiceNumber,
  periodMonthOf,
  splitAmount,
} from './finance.calc.js'
import { effectiveStatus } from './finance.invoice-status.js'
import { notifyInvoiceParties } from './finance.notify.js'
import { FinanceAccessService } from './finance.access.js'
import { toInvoiceCard } from './finance.mappers.js'
import { buildReceiptHtml } from './finance.receipt.js'
import { recalculateInvoiceStatus } from './finance.invoice-status.js'
import { buildReceiptPdf } from './finance.pdf.js'
import { invoiceInclude, parseRange, type InvoiceWithPayments } from './finance.shared.js'
import type { InstallmentCreateInput, InvoiceCreateInput, InvoiceDiscountInput, InvoiceQuery } from './finance.schemas.js'

/** Счета за обучение: реестр, выставление, рассрочка, отмена и личная история. */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceAccessService) private readonly access: FinanceAccessService,
  ) {}

  async listInvoices(query: InvoiceQuery) {
    const range = query.from || query.to ? parseRange(query, 365) : null
    const where: Prisma.InvoiceWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
      // Просрочка вычисляется по времени, поэтому фильтр учитывает срок оплаты.
      ...(query.status === 'OVERDUE'
        ? { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueAt: { lt: new Date() } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { student: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { student: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.invoice.count({ where }),
    ])

    return {
      items: items.map((invoice) => toInvoiceCard(invoice)),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
      currency: CURRENCY,
    }
  }

  async getInvoice(invoiceId: string, user: { userId: string; role: RoleName }) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceInclude,
    })
    if (!invoice) throw notFound('Счёт не найден')
    await this.access.assertCanView(invoice.studentId, user)
    return toInvoiceCard(invoice)
  }

  async createInvoice(input: InvoiceCreateInput, actorId: string) {
    await this.access.assertStudentExists(input.studentId)
    if (input.courseId) await this.access.assertCourseExists(input.courseId)

    const dueAt = new Date(input.dueAt)
    const year = dueAt.getUTCFullYear()

    const invoice = await this.prisma.client.$transaction(async (tx) => {
      const number = await this.nextInvoiceNumber(tx, year)
      return tx.invoice.create({
        data: {
          number,
          studentId: input.studentId,
          courseId: input.courseId ?? null,
          description: input.description,
          amount: input.amount,
          dueAt,
          periodMonth: input.periodMonth ?? null,
          issuedById: actorId,
        },
        include: invoiceInclude,
      })
    })

    await writeAudit({
      actorId,
      action: 'finance.invoice.created',
      entity: 'invoice',
      entityId: invoice.id,
      metadata: { number: invoice.number, amount: invoice.amount, studentId: invoice.studentId },
    })
    await notifyInvoiceParties({
      invoiceId: invoice.id,
      type: 'INVOICE_ISSUED',
      title: 'Выставлен счёт на обучение',
      body: `${invoice.description}: ${invoice.amount} ${CURRENCY} до ${dueAt.toLocaleDateString('ru-RU')}`,
    })

    return toInvoiceCard(invoice)
  }

  /** Рассрочка: несколько счетов с равными частями и месячным шагом. */
  async createInstallments(input: InstallmentCreateInput, actorId: string) {
    await this.access.assertStudentExists(input.studentId)
    if (input.courseId) await this.access.assertCourseExists(input.courseId)

    const parts = splitAmount(input.totalAmount, input.count)
    const firstDueAt = new Date(input.firstDueAt)

    const invoices = await this.prisma.client.$transaction(async (tx) => {
      const created: InvoiceWithPayments[] = []
      for (const [index, part] of parts.entries()) {
        const dueAt = addMonths(firstDueAt, index)
        const number = await this.nextInvoiceNumber(tx, dueAt.getUTCFullYear())
        created.push(
          await tx.invoice.create({
            data: {
              number,
              studentId: input.studentId,
              courseId: input.courseId ?? null,
              description: `${input.description} — часть ${index + 1} из ${parts.length}`,
              amount: part,
              dueAt,
              periodMonth: periodMonthOf(dueAt),
              issuedById: actorId,
            },
            include: invoiceInclude,
          }),
        )
      }
      return created
    })

    const firstInvoice = invoices[0]
    if (!firstInvoice) throw badRequest('Не удалось создать счета рассрочки')

    await writeAudit({
      actorId,
      action: 'finance.installments.created',
      entity: 'invoice',
      entityId: firstInvoice.id,
      metadata: { count: invoices.length, totalAmount: input.totalAmount, studentId: input.studentId },
    })
    await notifyInvoiceParties({
      invoiceId: firstInvoice.id,
      type: 'INVOICE_ISSUED',
      title: 'Оформлена рассрочка',
      body: `${input.description}: ${invoices.length} платежей на ${input.totalAmount} ${CURRENCY}`,
    })

    return { items: invoices.map((invoice) => toInvoiceCard(invoice)), currency: CURRENCY }
  }

  async cancelInvoice(invoiceId: string, reason: string, actorId: string) {
    const invoice = await this.getInvoiceWithPayments(invoiceId)
    if (invoice.status === 'CANCELLED') throw conflict('Счёт уже отменён')

    const { totals } = effectiveStatus(invoice)
    if (totals.received - totals.refunded > 0) {
      throw badRequest('По счёту есть поступления — сначала оформите возврат, затем отмените счёт')
    }

    const updated = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      include: invoiceInclude,
    })

    await writeAudit({
      actorId,
      action: 'finance.invoice.cancelled',
      entity: 'invoice',
      entityId: invoiceId,
      metadata: { reason, number: updated.number },
    })
    return toInvoiceCard(updated)
  }

  /** История счетов ученика или всех подтверждённых детей родителя. */
  async myFinance(userId: string, role: RoleName) {
    const studentIds = await this.access.resolveStudentIds(userId, role)
    if (studentIds.length === 0) {
      return { currency: CURRENCY, invoices: [], summary: { outstanding: 0, paid: 0, refunded: 0 }, children: [] }
    }

    const [invoices, children] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { studentId: { in: studentIds } },
        include: invoiceInclude,
        orderBy: { dueAt: 'desc' },
        take: 200,
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ])

    const cards = invoices.map((invoice) => toInvoiceCard(invoice))
    const billable = cards.filter((card) => card.status !== 'CANCELLED' && card.status !== 'DRAFT')
    const outstanding = billable.reduce((sum, card) => sum + card.totals.remaining, 0)
    const paid = billable.reduce((sum, card) => sum + card.totals.received - card.totals.refunded, 0)
    const refunded = billable.reduce((sum, card) => sum + card.totals.refunded, 0)

    return {
      currency: CURRENCY,
      invoices: cards,
      summary: { outstanding: Math.max(0, outstanding), paid, refunded },
      children: children.map((child) => ({ id: child.id, name: `${child.firstName} ${child.lastName}`.trim() })),
    }
  }

  /** HTML-квитанция для печати из браузера. */
  async receiptHtml(invoiceId: string, user: { userId: string; role: RoleName }): Promise<string> {
    const invoice = await this.getInvoiceWithPayments(invoiceId)
    await this.access.assertCanView(invoice.studentId, user)
    return buildReceiptHtml(toInvoiceCard(invoice))
  }

  /** PDF-квитанция формируется сервером и скачивается напрямую. */
  async receiptPdf(invoiceId: string, user: { userId: string; role: RoleName }): Promise<Buffer> {
    const invoice = await this.getInvoiceWithPayments(invoiceId)
    await this.access.assertCanView(invoice.studentId, user)
    return buildReceiptPdf(toInvoiceCard(invoice))
  }

  /** Ручная скидка администратора: уменьшает сумму счёта и сохраняет причину. */
  async applyDiscount(invoiceId: string, input: InvoiceDiscountInput, actorId: string) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude })
      if (!invoice) throw notFound('Счёт не найден')
      if (invoice.status === 'CANCELLED') throw conflict('Счёт отменён')
      if (invoice.status === 'PAID') throw conflict('Оплаченный счёт нельзя изменить скидкой')
      const { totals } = effectiveStatus(invoice)
      const net = totals.received - totals.refunded
      if (input.amount > invoice.amount) throw badRequest('Скидка не может превышать сумму счёта')
      if (invoice.amount - input.amount < net) throw badRequest('Скидка не может уменьшить счёт ниже уже оплаченной суммы')
      const discount = await tx.invoiceDiscount.create({ data: { invoiceId, amount: input.amount, reason: input.reason, createdById: actorId } })
      const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { amount: { decrement: input.amount } }, include: invoiceInclude })
      await recalculateInvoiceStatus(tx, invoiceId)
      return { discount, invoice: updated }
    })
    await writeAudit({ actorId, action: 'finance.invoice.discount', entity: 'Invoice', entityId: invoiceId, metadata: { amount: input.amount, reason: input.reason } })
    const card = toInvoiceCard(result.invoice)
    await notifyInvoiceParties({ invoiceId, type: 'SYSTEM', title: 'Скидка по счёту', body: `Скидка ${input.amount} ${CURRENCY} по счёту ${result.invoice.number}: ${input.reason}` })
    return card
  }

  private async nextInvoiceNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
    await tx.invoiceSequence.upsert({ where: { year }, update: {}, create: { year, lastNumber: 0 } })
    const updated = await tx.invoiceSequence.update({
      where: { year },
      data: { lastNumber: { increment: 1 } },
      select: { lastNumber: true },
    })
    return formatInvoiceNumber(year, updated.lastNumber)
  }

  private async getInvoiceWithPayments(invoiceId: string): Promise<InvoiceWithPayments> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceInclude,
    })
    if (!invoice) throw notFound('Счёт не найден')
    return invoice
  }
}
