import type { InvoiceStatus, PaymentStatus, RefundStatus } from '@prisma/client'

/**
 * Денежные расчёты финансового модуля.
 *
 * Все суммы — целые числа в сомах (KGS): у сома нет используемой в расчётах
 * дробной части, поэтому число с плавающей точкой здесь только создало бы
 * ошибки округления. Функции чистые, чтобы их можно было проверить тестами
 * без базы данных.
 */

export const CURRENCY = 'KGS'
export const MAX_INVOICE_AMOUNT = 100_000_000

/** Деньги считаются полученными, если платёж подтверждён (в том числе возвращённый позже). */
const RECEIVED_STATUSES: readonly PaymentStatus[] = ['CONFIRMED', 'REFUNDED']

interface PaymentLike {
  amount: number
  status: PaymentStatus | string
  refunds?: RefundLike[]
}

interface RefundLike {
  amount: number
  status: RefundStatus | string
}

export interface InvoiceTotals {
  /** Подтверждённые поступления по счёту. */
  received: number
  /** Одобренные возвраты по платежам счёта. */
  refunded: number
  /** Сколько осталось оплатить. */
  remaining: number
  /** Переплата: возможна только при ручной корректировке, но не теряется в отчётах. */
  overpaid: number
}

function sumReceived(payments: PaymentLike[]): number {
  return payments
    .filter((payment) => RECEIVED_STATUSES.includes(payment.status as PaymentStatus))
    .reduce((total, payment) => total + payment.amount, 0)
}

export function sumRefunded(payments: PaymentLike[]): number {
  return payments.reduce(
    (total, payment) =>
      total +
      (payment.refunds ?? [])
        .filter((refund) => refund.status === 'APPROVED')
        .reduce((sum, refund) => sum + refund.amount, 0),
    0,
  )
}

export function invoiceTotals(amount: number, payments: PaymentLike[]): InvoiceTotals {
  const received = sumReceived(payments)
  const refunded = sumRefunded(payments)
  const net = received - refunded
  return {
    received,
    refunded,
    remaining: Math.max(0, amount - net),
    overpaid: Math.max(0, net - amount),
  }
}

interface InvoiceStatusInput {
  stored: InvoiceStatus | string
  amount: number
  received: number
  refunded: number
  dueAt: Date
  now?: Date
}

/**
 * Эффективный статус счёта.
 *
 * Хранимый статус обновляется при платежах и возвратах, но просрочка зависит от
 * времени, поэтому OVERDUE вычисляется при каждом чтении — без фонового задания,
 * которое может отставать. Отменённые и черновики не пересчитываются.
 */
export function resolveInvoiceStatus(input: InvoiceStatusInput): InvoiceStatus {
  if (input.stored === 'CANCELLED') return 'CANCELLED'
  if (input.stored === 'DRAFT') return 'DRAFT'

  const now = input.now ?? new Date()
  const net = input.received - input.refunded

  if (net >= input.amount) return 'PAID'
  if (input.dueAt.getTime() < now.getTime()) return 'OVERDUE'
  if (net > 0) return 'PARTIALLY_PAID'
  return 'ISSUED'
}

/**
 * Проверка суммы возврата.
 *
 * Уже одобренные возвраты и заявки на рассмотрении резервируют сумму: иначе два
 * администратора могли бы вернуть больше, чем было оплачено.
 */
export function refundValidationError(input: {
  paymentAmount: number
  approvedRefunded: number
  pendingRequested: number
  requested: number
}): string | null {
  if (!Number.isInteger(input.requested) || input.requested <= 0) {
    return 'Сумма возврата должна быть целым положительным числом'
  }

  const available = input.paymentAmount - input.approvedRefunded - input.pendingRequested
  if (input.requested > available) {
    return `Доступно к возврату ${Math.max(0, available)} ${CURRENCY} из ${input.paymentAmount} ${CURRENCY}`
  }
  return null
}

/** Номер счёта: INV-2026-000001. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(6, '0')}`
}

/**
 * Разбивка суммы на равные части: остаток от деления добавляется к последнему
 * платежу, чтобы сумма частей точно совпала с исходной суммой.
 */
export function splitAmount(total: number, parts: number): number[] {
  if (!Number.isInteger(total) || total <= 0) throw new Error('Сумма должна быть положительным целым числом')
  if (!Number.isInteger(parts) || parts < 2 || parts > 60) throw new Error('Количество частей — от 2 до 60')

  const base = Math.floor(total / parts)
  if (base < 1) throw new Error('Сумма слишком мала для выбранного количества частей')
  const remainder = total - base * parts
  return Array.from({ length: parts }, (_, index) => (index === parts - 1 ? base + remainder : base))
}

/** Следующий месяц для графика рассрочки: сохраняет день, но не выходит за границы месяца. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

/** Месяц начисления YYYY-MM в UTC — не зависит от часового пояса сервера. */
export function periodMonthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
