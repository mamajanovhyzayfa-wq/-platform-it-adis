import { Inject, Injectable } from '@nestjs/common'
import { notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { CURRENCY } from './finance.calc.js'
import type { PriceUpdateInput, TeacherRateInput } from './finance.schemas.js'
import { parseRange } from './finance.shared.js'
import type { OverviewQuery } from './finance.schemas.js'

/** Тарифы курсов: фиксированная цена, модель оплаты и история изменений. */
@Injectable()
export class PricingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async coursePricing() {
    const [courses, history] = await Promise.all([
      this.prisma.client.course.findMany({
        select: {
          id: true,
          title: true,
          status: true,
          priceKgs: true,
          billing: true,
          installmentsCount: true,
          _count: { select: { invoices: true, enrollments: true } },
        },
        orderBy: { title: 'asc' },
      }),
      this.prisma.client.coursePriceHistory.findMany({
        include: {
          changedBy: { select: { firstName: true, lastName: true } },
          course: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])

    return {
      items: courses.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        priceKgs: course.priceKgs,
        billing: course.billing,
        installmentsCount: course.installmentsCount,
        invoicesCount: course._count.invoices,
        studentsCount: course._count.enrollments,
      })),
      history: history.map((entry) => ({
        id: entry.id,
        course: entry.course,
        previousPrice: entry.previousPrice,
        newPrice: entry.newPrice,
        reason: entry.reason,
        changedBy: `${entry.changedBy.firstName} ${entry.changedBy.lastName}`.trim(),
        createdAt: entry.createdAt,
      })),
      currency: CURRENCY,
    }
  }

  async updateCoursePrice(courseId: string, input: PriceUpdateInput, actorId: string) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, priceKgs: true },
    })
    if (!course) throw notFound('Курс не найден')

    const installmentsCount =
      input.billing === 'INSTALLMENT' ? Math.max(2, input.installmentsCount) : 1

    const result = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.course.update({
        where: { id: courseId },
        data: { priceKgs: input.priceKgs, billing: input.billing, installmentsCount },
        select: { id: true, title: true, priceKgs: true, billing: true, installmentsCount: true },
      })
      if (course.priceKgs !== input.priceKgs) {
        await tx.coursePriceHistory.create({
          data: {
            courseId,
            previousPrice: course.priceKgs,
            newPrice: input.priceKgs,
            reason: input.reason ?? null,
            changedById: actorId,
          },
        })
      }
      return updated
    })

    await writeAudit({
      actorId,
      action: 'finance.course.price_updated',
      entity: 'course',
      entityId: courseId,
      metadata: { previousPrice: course.priceKgs, newPrice: input.priceKgs, billing: input.billing, reason: input.reason ?? null },
    })
    return result
  }

  /** Заработок наставников по фиксированной ставке за проведённые занятия. */
  async teacherEarnings(query: OverviewQuery) {
    const { from, to } = parseRange(query, 30)
    const teachers = await this.prisma.client.teacher.findMany({
      select: {
        userId: true,
        lessonRateKgs: true,
        specialization: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } },
      },
      orderBy: { user: { lastName: 'asc' } },
    })
    const schedules = await this.prisma.client.schedule.findMany({
      where: { startsAt: { gte: from, lte: to }, status: 'COMPLETED' },
      select: { teacherId: true, startsAt: true, title: true },
    })
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      currency: CURRENCY,
      items: teachers.map((teacher) => {
        const lessons = schedules.filter((schedule) => schedule.teacherId === teacher.userId).length
        return {
          userId: teacher.userId,
          name: `${teacher.user.firstName} ${teacher.user.lastName}`.trim(),
          email: teacher.user.email,
          specialization: teacher.specialization,
          isActive: teacher.user.isActive,
          lessonRateKgs: teacher.lessonRateKgs,
          lessons,
          earnedKgs: lessons * teacher.lessonRateKgs,
        }
      }).sort((left, right) => right.earnedKgs - left.earnedKgs),
      totals: { lessons: schedules.length, earnedKgs: teachers.reduce((sum, teacher) => sum + schedules.filter((schedule) => schedule.teacherId === teacher.userId).length * teacher.lessonRateKgs, 0) },
    }
  }

  async updateTeacherRate(userId: string, input: TeacherRateInput, actorId: string) {
    const teacher = await this.prisma.client.teacher.findUnique({ where: { userId }, select: { id: true } })
    if (!teacher) throw notFound('Наставник не найден')
    const updated = await this.prisma.client.teacher.update({ where: { userId }, data: { lessonRateKgs: input.lessonRateKgs } })
    await writeAudit({ actorId, action: 'finance.teacher.rate_updated', entity: 'Teacher', entityId: teacher.id, metadata: { lessonRateKgs: input.lessonRateKgs } })
    return updated
  }
}
