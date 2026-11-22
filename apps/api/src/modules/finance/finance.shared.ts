import { Prisma } from '@prisma/client'
import { badRequest } from '../../lib/errors.js'

/**
 * Общие фрагменты финансового модуля: выборки, подписи и разбор периода.
 * Вынесены отдельно, чтобы сервисы не дублировали форму запросов и словари.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/** Единая выборка счёта с платежами и возвратами для карточек и квитанций. */
export const invoiceInclude = {
  student: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  course: { select: { id: true, title: true } },
  discounts: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, amount: true, reason: true, createdAt: true, createdBy: { select: { firstName: true, lastName: true } } },
  },
  payments: {
    orderBy: { paidAt: 'desc' as const },
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      note: true,
      provider: true,
      externalId: true,
      refunds: {
        select: { id: true, amount: true, status: true, reason: true, createdAt: true, reviewComment: true },
      },
    },
  },
} satisfies Prisma.InvoiceInclude

export type InvoiceWithPayments = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  RENT: 'Аренда',
  SALARY: 'Зарплаты',
  EQUIPMENT: 'Оборудование',
  MARKETING: 'Маркетинг',
  UTILITIES: 'Коммунальные услуги',
  SOFTWARE: 'Программное обеспечение',
  OTHER: 'Прочее',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  BANK_TRANSFER: 'Банковский перевод',
  ONLINE: 'Онлайн',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает подтверждения',
  CONFIRMED: 'Подтверждён',
  FAILED: 'Ошибка',
  REFUNDED: 'Возвращён',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  ISSUED: 'Выставлен',
  PARTIALLY_PAID: 'Частично оплачен',
  PAID: 'Оплачен',
  OVERDUE: 'Просрочен',
  CANCELLED: 'Отменён',
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Период отчёта: по умолчанию — последние `fallbackDays` дней до текущего момента. */
export function parseRange(
  query: { from?: string; to?: string },
  fallbackDays: number,
): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - fallbackDays * DAY_MS)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Некорректный период')
  if (from.getTime() >= to.getTime()) throw badRequest('Начало периода должно быть раньше конца')
  return { from, to }
}

/** Ключ месяца YYYY-MM в UTC — не зависит от часового пояса сервера. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
