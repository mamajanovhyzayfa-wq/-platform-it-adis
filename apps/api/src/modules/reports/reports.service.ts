import { Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { ZodError } from 'zod'
import { AppError, badRequest } from '../../lib/errors.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { reportRangeSchema, type ReportRangeInput } from './reports.dto.js'

interface Range {
  from: Date
  to: Date
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(raw: Record<string, unknown>): Range {
    let input: ReportRangeInput
    try {
      input = reportRangeSchema.parse(raw)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Проверьте период отчёта',
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        )
      }
      throw error
    }
    const now = new Date()
    const from = input.from ?? new Date(now.getFullYear(), now.getMonth(), 1)
    const to = input.to ?? now
    if (from > to) throw badRequest('Дата начала периода не может быть позже даты окончания')
    return { from, to }
  }

  async overview(raw: Record<string, unknown>, role: RoleName) {
    const range = this.range(raw)
    const [users, courses, enrollments, certificates, support, attendance] = await Promise.all([
      this.prisma.client.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.client.course.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.courseEnrollment.count({ where: { status: 'ACTIVE' } }),
      this.prisma.client.certificate.count({
        where: { status: 'ISSUED', issuedAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.client.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.client.attendance.groupBy({
        by: ['status'],
        where: { joinedAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
    ])

    // Финансовая аналитика не входит в интерфейс менеджера: он видит только
    // организационные показатели филиала.
    let finance: {
      revenue: number
      expenses: number
      margin: number
      paymentsCount: number
      expensesCount: number
    } | undefined
    if (role === 'ADMIN') {
      const [payments, expenses] = await Promise.all([
        this.prisma.client.payment.aggregate({
          where: { status: 'CONFIRMED', paidAt: { gte: range.from, lte: range.to } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.client.expense.aggregate({
          where: { spentAt: { gte: range.from, lte: range.to } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ])
      const revenue = payments._sum.amount ?? 0
      const spent = expenses._sum.amount ?? 0
      finance = {
        revenue,
        expenses: spent,
        margin: revenue - spent,
        paymentsCount: payments._count._all,
        expensesCount: expenses._count._all,
      }
    }

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      users: Object.fromEntries(users.map((row) => [row.role, row._count._all])),
      courses: Object.fromEntries(courses.map((row) => [row.status, row._count._all])),
      activeEnrollments: enrollments,
      ...(finance ? { finance } : {}),
      certificatesIssued: certificates,
      openSupportTickets: support,
      attendance: Object.fromEntries(attendance.map((row) => [row.status, row._count._all])),
    }
  }

  async finance(raw: Record<string, unknown>) {
    const range = this.range(raw)
    const [paymentsByMethod, expensesByCategory, refunds, outstanding] = await Promise.all([
      this.prisma.client.payment.groupBy({
        by: ['method'],
        where: { status: 'CONFIRMED', paidAt: { gte: range.from, lte: range.to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.client.expense.groupBy({
        by: ['category'],
        where: { spentAt: { gte: range.from, lte: range.to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.client.refund.aggregate({
        where: { status: 'APPROVED', createdAt: { gte: range.from, lte: range.to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ])
    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      payments: paymentsByMethod.map((row) => ({ method: row.method, amount: row._sum.amount ?? 0, count: row._count._all })),
      expenses: expensesByCategory.map((row) => ({ category: row.category, amount: row._sum.amount ?? 0, count: row._count._all })),
      refunds: { amount: refunds._sum.amount ?? 0, count: refunds._count._all },
      outstandingInvoices: { amount: outstanding._sum.amount ?? 0, count: outstanding._count._all },
    }
  }

  async academic(raw: Record<string, unknown>) {
    const range = this.range(raw)
    const [attendance, submissions, attempts, publishedCourses] = await Promise.all([
      this.prisma.client.attendance.groupBy({
        by: ['status'],
        where: { joinedAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
      this.prisma.client.homeworkSubmission.groupBy({
        by: ['status'],
        where: { submittedAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
      this.prisma.client.testAttempt.aggregate({
        where: { submittedAt: { gte: range.from, lte: range.to }, percent: { not: null } },
        _avg: { percent: true },
        _count: { _all: true },
      }),
      this.prisma.client.course.count({ where: { status: 'ACTIVE' } }),
    ])
    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      attendance: Object.fromEntries(attendance.map((row) => [row.status, row._count._all])),
      submissions: Object.fromEntries(submissions.map((row) => [row.status, row._count._all])),
      testAttempts: { averagePercent: attempts._avg.percent ?? 0, count: attempts._count._all },
      publishedCourses,
    }
  }
}
