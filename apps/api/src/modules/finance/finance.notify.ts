import type { NotificationType } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { notifyUsers } from '../../lib/notify.js'

/**
 * Уведомления по финансовым событиям.
 *
 * Получатели — ученик и подтверждённые родители. Рассылка идёт через общий
 * notifyUsers, поэтому учитывает персональные настройки внутренних, push,
 * email и SMS каналов. Ошибки не должны ломать платёжную операцию.
 */
export async function notifyInvoiceParties(input: {
  invoiceId: string
  type: Extract<NotificationType, 'INVOICE_ISSUED' | 'PAYMENT_RECEIVED' | 'PAYMENT_DUE' | 'REFUND_PROCESSED' | 'SYSTEM'>
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { number: true, studentId: true },
    })
    if (!invoice) return

    const parents = await prisma.parentStudentLink.findMany({
      where: { student: { userId: invoice.studentId }, verifiedAt: { not: null } },
      select: { parent: { select: { userId: true } } },
    })

    const recipients = [...new Set([invoice.studentId, ...parents.map((link) => link.parent.userId)])]
    const payload = { ...input.data, invoiceId: input.invoiceId, invoiceNumber: invoice.number }

    await notifyUsers(recipients, {
      type: input.type,
      title: input.title,
      body: input.body,
      data: payload,
      email: { subject: `ITadis: ${input.title}`, text: input.body },
      sms: `ITadis: ${input.title}. ${input.body}`.slice(0, 160),
    })
  } catch (error) {
    console.error('[finance] не удалось отправить уведомление', error)
  }
}
