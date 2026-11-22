import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { CURRENCY } from './finance.calc.js'
import { effectiveStatus } from './finance.invoice-status.js'
import { onlineProviderStatus, ONLINE_PROVIDER_ENV_VARS } from '../../integrations/payments/online-payments.js'
import { EXPENSE_CATEGORY_LABELS, monthKey, parseRange } from './finance.shared.js'
import type { OverviewQuery } from './finance.schemas.js'

/** Аналитика филиала: доходы, расходы, прибыль, долги и динамика по месяцам. */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async exportRows(query: OverviewQuery) {
    const { from, to } = parseRange(query, 30)
    const [payments, expenses, refunds] = await Promise.all([
      this.prisma.client.payment.findMany({
        where: { paidAt: { gte: from, lte: to } },
        select: { id: true, amount: true, method: true, status: true, paidAt: true, provider: true, invoice: { select: { number: true, student: { select: { firstName: true, lastName: true } } } } },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.client.expense.findMany({
        where: { spentAt: { gte: from, lte: to } },
        select: { id: true, category: true, amount: true, spentAt: true, description: true, documentUrl: true },
        orderBy: { spentAt: 'asc' },
      }),
      this.prisma.client.refund.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { id: true, amount: true, status: true, reason: true, createdAt: true, reviewedAt: true, payment: { select: { invoice: { select: { number: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return { from, to, payments, expenses, refunds }
  }

  async exportAccounting(query: OverviewQuery) {
    const rows = await this.exportRows(query)
    return {
      range: { from: rows.from.toISOString(), to: rows.to.toISOString() },
      currency: CURRENCY,
      payments: rows.payments.map((payment) => ({
        id: payment.id, date: payment.paidAt.toISOString(), invoice: payment.invoice.number,
        student: `${payment.invoice.student.firstName} ${payment.invoice.student.lastName}`.trim(),
        amount: payment.amount, method: payment.method, status: payment.status, provider: payment.provider,
      })),
      expenses: rows.expenses.map((expense) => ({ id: expense.id, date: expense.spentAt.toISOString(), category: expense.category, amount: expense.amount, description: expense.description, documentUrl: expense.documentUrl })),
      refunds: rows.refunds.map((refund) => ({ id: refund.id, date: refund.createdAt.toISOString(), reviewedAt: refund.reviewedAt?.toISOString() ?? null, invoice: refund.payment.invoice.number, amount: refund.amount, status: refund.status, reason: refund.reason })),
    }
  }

  async exportCsv(query: OverviewQuery) {
    const rows = await this.exportRows(query)
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const lines = [['type', 'date', 'invoice', 'student_or_description', 'category_or_method', 'status', 'amount'].join(',')]
    for (const payment of rows.payments) {
      lines.push(['PAYMENT', payment.paidAt.toISOString(), payment.invoice.number, `${payment.invoice.student.firstName} ${payment.invoice.student.lastName}`, payment.method, payment.status, payment.amount].map(escape).join(','))
    }
    for (const expense of rows.expenses) {
      lines.push(['EXPENSE', expense.spentAt.toISOString(), '', expense.description, expense.category, '', -expense.amount].map(escape).join(','))
    }
    for (const refund of rows.refunds) {
      lines.push(['REFUND', refund.createdAt.toISOString(), refund.payment.invoice.number, refund.reason, '', refund.status, -refund.amount].map(escape).join(','))
    }
    return `\uFEFF${lines.join('\n')}`
  }

  async overview(query: OverviewQuery) {
    const { from, to } = parseRange(query, 30) // период по умолчанию — 30 дней

    const [payments, refunds, expenses, openInvoices, courseGroups] = await Promise.all([
      this.prisma.client.payment.findMany({
        where: { status: { in: ['CONFIRMED', 'REFUNDED'] }, paidAt: { gte: from, lte: to } },
        select: {
          amount: true,
          method: true,
          paidAt: true,
          invoice: { select: { courseId: true, course: { select: { id: true, title: true } } } },
        },
      }),
      this.prisma.client.refund.findMany({
        where: { status: 'APPROVED', reviewedAt: { gte: from, lte: to } },
        select: {
          amount: true,
          reviewedAt: true,
          payment: {
            select: {
              invoice: { select: { courseId: true, course: { select: { id: true, title: true } } } },
            },
          },
        },
      }),
      this.prisma.client.expense.findMany({
        where: { spentAt: { gte: from, lte: to } },
        select: { amount: true, spentAt: true, category: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] } },
        select: {
          id: true,
          number: true,
          courseId: true,
          amount: true,
          dueAt: true,
          status: true,
          student: { select: { id: true, firstName: true, lastName: true, email: true } },
          payments: { select: { amount: true, status: true, refunds: { select: { amount: true, status: true } } } },
        },
      }),
      this.prisma.client.course.findMany({
        where: { status: { in: ['ACTIVE', 'ARCHIVED'] } },
        select: {
          id: true,
          title: true,
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: { title: 'asc' },
      }),
    ])

    const paymentsTotal = payments.reduce((sum, payment) => sum + payment.amount, 0)
    const refundsTotal = refunds.reduce((sum, refund) => sum + refund.amount, 0)
    const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0)
    const netIncome = paymentsTotal - refundsTotal

    const outstandingByStudent = new Map<string, { student: { id: string; firstName: string; lastName: string; email: string }; amount: number; invoices: number }>()
    const outstandingByCourse = new Map<string, number>()
    let outstandingTotal = 0
    let overdueTotal = 0
    let overdueCount = 0

    for (const invoice of openInvoices) {
      const { totals, status } = effectiveStatus(invoice)
      if (totals.remaining <= 0) continue
      outstandingTotal += totals.remaining
      if (status === 'OVERDUE') {
        overdueTotal += totals.remaining
        overdueCount += 1
      }
      if (invoice.courseId) {
        outstandingByCourse.set(invoice.courseId, (outstandingByCourse.get(invoice.courseId) ?? 0) + totals.remaining)
      }
      const entry = outstandingByStudent.get(invoice.student.id) ?? {
        student: invoice.student,
        amount: 0,
        invoices: 0,
      }
      entry.amount += totals.remaining
      entry.invoices += 1
      outstandingByStudent.set(invoice.student.id, entry)
    }

    const byCourse = new Map<string, { id: string; title: string; income: number }>()
    for (const payment of payments) {
      const course = payment.invoice.course
      const key = course?.id ?? 'none'
      const entry = byCourse.get(key) ?? {
        id: key,
        title: course?.title ?? 'Без курса',
        income: 0,
      }
      entry.income += payment.amount
      byCourse.set(key, entry)
    }
    for (const refund of refunds) {
      const course = refund.payment.invoice.course
      const key = course?.id ?? 'none'
      const entry = byCourse.get(key) ?? {
        id: key,
        title: course?.title ?? 'Без курса',
        income: 0,
      }
      entry.income -= refund.amount
      byCourse.set(key, entry)
    }

    const methods = ['CASH', 'BANK_TRANSFER', 'ONLINE'].map((method) => ({
      method,
      amount: payments.filter((payment) => payment.method === method).reduce((sum, payment) => sum + payment.amount, 0),
      count: payments.filter((payment) => payment.method === method).length,
    }))

    const expensesByCategory = Object.keys(EXPENSE_CATEGORY_LABELS).map((category) => ({
      category,
      label: EXPENSE_CATEGORY_LABELS[category],
      amount: expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amount, 0),
    }))

    // Шесть месяцев динамики: доход, расход и возвраты по месяцам.
    const sixMonthsFrom = new Date(to)
    sixMonthsFrom.setUTCDate(1)
    sixMonthsFrom.setUTCHours(0, 0, 0, 0)
    sixMonthsFrom.setUTCMonth(sixMonthsFrom.getUTCMonth() - 5)

    const [seriesPayments, seriesExpenses, seriesRefunds] = await Promise.all([
      this.prisma.client.payment.findMany({
        where: { status: { in: ['CONFIRMED', 'REFUNDED'] }, paidAt: { gte: sixMonthsFrom, lte: to } },
        select: { amount: true, paidAt: true },
      }),
      this.prisma.client.expense.findMany({
        where: { spentAt: { gte: sixMonthsFrom, lte: to } },
        select: { amount: true, spentAt: true },
      }),
      this.prisma.client.refund.findMany({
        where: { status: 'APPROVED', reviewedAt: { gte: sixMonthsFrom, lte: to } },
        select: { amount: true, reviewedAt: true },
      }),
    ])

    const monthly: Array<{ month: string; income: number; expenses: number; refunds: number }> = []
    for (let index = 0; index < 6; index += 1) {
      const cursor = new Date(sixMonthsFrom)
      cursor.setUTCMonth(cursor.getUTCMonth() + index)
      const key = monthKey(cursor)
      monthly.push({
        month: key,
        income: seriesPayments.filter((payment) => monthKey(payment.paidAt) === key).reduce((sum, p) => sum + p.amount, 0),
        expenses: seriesExpenses.filter((expense) => monthKey(expense.spentAt) === key).reduce((sum, e) => sum + e.amount, 0),
        refunds: seriesRefunds
          .filter((refund) => refund.reviewedAt && monthKey(refund.reviewedAt) === key)
          .reduce((sum, r) => sum + r.amount, 0),
      })
    }

    return {
      currency: CURRENCY,
      range: { from: from.toISOString(), to: to.toISOString() },
      income: { payments: paymentsTotal, refunds: refundsTotal, net: netIncome },
      expenses: expensesTotal,
      profit: netIncome - expensesTotal,
      outstanding: { total: outstandingTotal, overdue: overdueTotal, overdueCount, invoices: openInvoices.length },
      counts: {
        payments: payments.length,
        invoices: openInvoices.length,
        refundsPending: await this.prisma.client.refund.count({ where: { status: 'REQUESTED' } }),
      },
      methods,
      expensesByCategory,
      courses: [...byCourse.values()].sort((a, b) => b.income - a.income),
      // Группа в ITadis — это учебный курс. Показываем и нулевые группы,
      // чтобы администратор видел набор и задолженность по каждому курсу.
      groups: courseGroups.map((course) => ({
        id: course.id,
        title: course.title,
        students: course._count.enrollments,
        income: byCourse.get(course.id)?.income ?? 0,
        outstanding: outstandingByCourse.get(course.id) ?? 0,
      })),
      monthly,
      debtors: [...outstandingByStudent.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
      provider: { ...onlineProviderStatus(), envVars: [...ONLINE_PROVIDER_ENV_VARS] },
    }
  }
}
