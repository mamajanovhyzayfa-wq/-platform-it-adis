import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { onlineProviderStatus, ONLINE_PROVIDER_ENV_VARS } from '../../integrations/payments/online-payments.js'
import { CURRENCY } from './finance.calc.js'
import { effectiveStatus } from './finance.invoice-status.js'
import type { LookupQuery } from './finance.schemas.js'

/** Справочники и операционные выборки: ученики, счета для кассы, статус провайдера. */
@Injectable()
export class FinanceLookupService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async studentsLookup(query: LookupQuery) {
    const students = await this.prisma.client.user.findMany({
      where: {
        role: 'STUDENT',
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          select: {
            course: { select: { id: true, title: true, priceKgs: true, billing: true, installmentsCount: true } },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: query.limit,
    })

    return {
      items: students.map((student) => ({
        id: student.id,
        name: `${student.firstName} ${student.lastName}`.trim(),
        email: student.email,
        phone: student.phone,
        courses: student.enrollments.map((enrollment) => enrollment.course),
      })),
    }
  }

  /** Незакрытые счета для кассы менеджера: только операционные данные. */
  async managerInvoices(search?: string) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { student: { firstName: { contains: search, mode: 'insensitive' } } },
                { student: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        number: true,
        description: true,
        amount: true,
        dueAt: true,
        status: true,
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        payments: { select: { amount: true, status: true, refunds: { select: { amount: true, status: true } } } },
      },
      orderBy: { dueAt: 'asc' },
      take: 100,
    })

    return {
      items: invoices
        .map((invoice) => {
          const { totals, status } = effectiveStatus(invoice)
          return {
            id: invoice.id,
            number: invoice.number,
            description: invoice.description,
            amount: invoice.amount,
            dueAt: invoice.dueAt,
            status,
            remaining: totals.remaining,
            student: invoice.student,
          }
        })
        .filter((invoice) => invoice.remaining > 0),
      currency: CURRENCY,
    }
  }

  providerStatus() {
    return {
      ...onlineProviderStatus(),
      envVars: [...ONLINE_PROVIDER_ENV_VARS],
    }
  }
}
