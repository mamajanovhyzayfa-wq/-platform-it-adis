import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import {
  canonicalWebhookSchema,
  onlineProviderStatus,
  verifyWebhookSignature,
} from '../../integrations/payments/online-payments.js'
import { effectiveStatus, recalculateInvoiceStatus } from './finance.invoice-status.js'
import { notifyInvoiceParties } from './finance.notify.js'
import { CURRENCY } from './finance.calc.js'

/**
 * Вебхук платёжного провайдера (канонический контракт, см. online-payments.ts).
 *
 * Тело приходит сырым (express.raw в main.ts), подпись проверяется HMAC-SHA256.
 * Повторная доставка того же события не создаёт второй платёж: externalId уникален.
 * Пока провайдер не настроен, маршрут отвечает 503 и не меняет данные.
 */
export const financeWebhookRouter = Router()

financeWebhookRouter.post('/online', async (req, res) => {
  const status = onlineProviderStatus()
  if (!status.configured) {
    res.status(503).json({ error: { code: 'ONLINE_PAYMENTS_NOT_CONFIGURED', message: status.note } })
    return
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
  const signature = req.header('x-itadis-signature') ?? undefined
  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Подпись вебхука неверна' } })
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString('utf8') || '{}')
  } catch {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Тело вебхука не является JSON' } })
    return
  }

  const parsed = canonicalWebhookSchema.safeParse(payload)
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некорректное тело вебхука',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    })
    return
  }

  const event = parsed.data

  try {
    const duplicate = await prisma.payment.findUnique({ where: { externalId: event.externalId } })
    if (duplicate) {
      res.status(200).json({ received: true, duplicate: true })
      return
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: event.invoiceId },
      include: {
        payments: { select: { amount: true, status: true, refunds: { select: { amount: true, status: true } } } },
      },
    })
    if (!invoice) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Счёт не найден' } })
      return
    }
    if (invoice.status === 'CANCELLED') {
      res.status(409).json({ error: { code: 'INVOICE_CANCELLED', message: 'Счёт отменён' } })
      return
    }

    const { totals } = effectiveStatus(invoice)
    if (event.amount > totals.remaining) {
      res.status(409).json({
        error: {
          code: 'AMOUNT_EXCEEDS_REMAINING',
          message: `Сумма ${event.amount} ${CURRENCY} превышает остаток ${totals.remaining} ${CURRENCY}`,
        },
      })
      return
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: event.amount,
          method: 'ONLINE',
          status: 'CONFIRMED',
          provider: status.provider,
          externalId: event.externalId,
          paidAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
          confirmedAt: new Date(),
        },
      })
      await recalculateInvoiceStatus(tx, invoice.id)
      return created
    })

    await notifyInvoiceParties({
      invoiceId: invoice.id,
      type: 'PAYMENT_RECEIVED',
      title: 'Онлайн-платёж зачислен',
      body: `${payment.amount} ${CURRENCY} по счёту ${invoice.number}`,
    })

    res.status(200).json({ received: true, paymentId: payment.id })
  } catch (error) {
    console.error('[payments] ошибка обработки вебхука', error)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Не удалось обработать платёж' } })
  }
})
