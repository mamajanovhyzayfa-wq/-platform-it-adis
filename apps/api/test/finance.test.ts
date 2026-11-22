import { describe, expect, it } from 'vitest'
import {
  addMonths,
  formatInvoiceNumber,
  invoiceTotals,
  periodMonthOf,
  refundValidationError,
  resolveInvoiceStatus,
  splitAmount,
} from '../src/modules/finance/finance.calc.js'

const confirmed = (amount: number, refunds: Array<{ amount: number; status: string }> = []) => ({
  amount,
  status: 'CONFIRMED',
  refunds,
})

describe('баланс счёта', () => {
  it('учитывает только подтверждённые платежи и одобренные возвраты', () => {
    const totals = invoiceTotals(5000, [
      confirmed(2000),
      confirmed(1000, [{ amount: 500, status: 'APPROVED' }]),
      { amount: 2000, status: 'PENDING' },
      { amount: 500, status: 'FAILED' },
      confirmed(500, [{ amount: 500, status: 'REQUESTED' }]),
    ])

    expect(totals.received).toBe(3500)
    expect(totals.refunded).toBe(500)
    expect(totals.remaining).toBe(2000)
    expect(totals.overpaid).toBe(0)
  })

  it('фиксирует переплату, а не отрицательный остаток', () => {
    const totals = invoiceTotals(1000, [confirmed(1200)])
    expect(totals.remaining).toBe(0)
    expect(totals.overpaid).toBe(200)
  })
})

describe('эффективный статус счёта', () => {
  const dueAt = new Date('2026-11-10T00:00:00.000Z')
  const now = new Date('2026-11-19T00:00:00.000Z')

  it('полная оплата даёт PAID независимо от срока', () => {
    expect(resolveInvoiceStatus({ stored: 'ISSUED', amount: 1000, received: 1000, refunded: 0, dueAt, now })).toBe('PAID')
  })

  it('частичная оплата после срока — просрочка', () => {
    expect(
      resolveInvoiceStatus({ stored: 'PARTIALLY_PAID', amount: 1000, received: 400, refunded: 0, dueAt, now }),
    ).toBe('OVERDUE')
  })

  it('частичная оплата до срока — PARTIALLY_PAID', () => {
    expect(
      resolveInvoiceStatus({ stored: 'ISSUED', amount: 1000, received: 400, refunded: 0, dueAt, now: new Date('2026-11-01') }),
    ).toBe('PARTIALLY_PAID')
  })

  it('возврат уменьшает оплату и возвращает счёт в работу', () => {
    expect(
      resolveInvoiceStatus({ stored: 'PAID', amount: 1000, received: 1000, refunded: 1000, dueAt, now: new Date('2026-11-01') }),
    ).toBe('ISSUED')
  })

  it('отменённый счёт и черновик не пересчитываются', () => {
    expect(resolveInvoiceStatus({ stored: 'CANCELLED', amount: 1000, received: 0, refunded: 0, dueAt, now })).toBe(
      'CANCELLED',
    )
    expect(resolveInvoiceStatus({ stored: 'DRAFT', amount: 1000, received: 0, refunded: 0, dueAt, now })).toBe('DRAFT')
  })
})

describe('возвраты', () => {
  it('не позволяет вернуть больше, чем осталось с учётом заявок на рассмотрении', () => {
    const error = refundValidationError({
      paymentAmount: 1000,
      approvedRefunded: 200,
      pendingRequested: 300,
      requested: 600,
    })
    expect(error).toContain('Доступно к возврату 500')
  })

  it('разрешает возврат в пределах доступной суммы', () => {
    expect(
      refundValidationError({ paymentAmount: 1000, approvedRefunded: 200, pendingRequested: 0, requested: 800 }),
    ).toBeNull()
  })

  it('отклоняет нулевую и дробную сумму', () => {
    expect(refundValidationError({ paymentAmount: 1000, approvedRefunded: 0, pendingRequested: 0, requested: 0 })).not.toBeNull()
    expect(refundValidationError({ paymentAmount: 1000, approvedRefunded: 0, pendingRequested: 0, requested: 10.5 })).not.toBeNull()
  })
})

describe('нумерация и рассрочка', () => {
  it('формирует номер счёта с ведущими нулями', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('INV-2026-000001')
    expect(formatInvoiceNumber(2026, 123456)).toBe('INV-2026-123456')
  })

  it('делит сумму без потери сома', () => {
    const parts = splitAmount(10000, 3)
    expect(parts).toEqual([3333, 3333, 3334])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10000)
  })

  it('не создаёт части нулевого размера', () => {
    expect(() => splitAmount(2, 5)).toThrow()
    expect(() => splitAmount(100, 1)).toThrow()
  })

  it('прибавляет месяцы, не выходя за границы месяца', () => {
    const january31 = new Date(Date.UTC(2026, 0, 31))
    expect(addMonths(january31, 1).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(addMonths(new Date(Date.UTC(2026, 10, 15)), 2).toISOString().slice(0, 10)).toBe('2027-01-15')
  })

  it('формирует месяц начисления в UTC', () => {
    expect(periodMonthOf(new Date('2026-11-30T22:00:00.000Z'))).toBe('2026-11')
  })
})
