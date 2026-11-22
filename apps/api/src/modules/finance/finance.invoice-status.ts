import { Prisma } from '@prisma/client'
import { invoiceTotals, resolveInvoiceStatus, type InvoiceTotals } from './finance.calc.js'

/**
 * Пересчёт сохранённого статуса счёта по фактическим платежам.
 *
 * Используется и Nest-сервисом, и Express-вебхуком платёжного провайдера:
 * статус всегда выводится из движений денег, а не выставляется вручную.
 */
export async function recalculateInvoiceStatus(
  db: Prisma.TransactionClient,
  invoiceId: string,
): Promise<{ totals: InvoiceTotals; status: string } | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      amount: true,
      dueAt: true,
      status: true,
      payments: {
        select: { amount: true, status: true, refunds: { select: { amount: true, status: true } } },
      },
    },
  })
  if (!invoice) return null

  const totals = invoiceTotals(invoice.amount, invoice.payments)
  const status = resolveInvoiceStatus({
    stored: invoice.status,
    amount: invoice.amount,
    received: totals.received,
    refunded: totals.refunded,
    dueAt: invoice.dueAt,
  })

  if (invoice.status !== status && invoice.status !== 'CANCELLED' && invoice.status !== 'DRAFT') {
    await db.invoice.update({ where: { id: invoice.id }, data: { status } })
  }

  return { totals, status }
}

/** Эффективный статус без записи в БД — для списков, где важна актуальность. */
export function effectiveStatus(invoice: {
  amount: number
  dueAt: Date
  status: string
  payments: Array<{ amount: number; status: string; refunds: Array<{ amount: number; status: string }> }>
}): { totals: InvoiceTotals; status: ReturnType<typeof resolveInvoiceStatus> } {
  const totals = invoiceTotals(invoice.amount, invoice.payments)
  return {
    totals,
    status: resolveInvoiceStatus({
      stored: invoice.status,
      amount: invoice.amount,
      received: totals.received,
      refunded: totals.refunded,
      dueAt: invoice.dueAt,
    }),
  }
}
