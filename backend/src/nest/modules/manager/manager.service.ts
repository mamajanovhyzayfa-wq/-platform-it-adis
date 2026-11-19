import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service.js'

export const managerStudentsQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export type ManagerStudentsQuery = z.infer<typeof managerStudentsQuerySchema>

/** Начало и конец текущих суток в часовом поясе сервера. */
function dayRange(now = new Date()) {
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { from, to }
}

/**
 * Операционный кабинет менеджера.
 *
 * Менеджер видит организационный контур филиала: заявки, учеников, занятия
 * и загрузку преподавателей. Финансовая аналитика и управление ролями сюда
 * не входят — это право администратора.
 */
@Injectable()
export class ManagerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date()
    const { from, to } = dayRange(now)

    const [students, teachers, activeCourses, newLeads, lessonsToday, pendingHomework, attendanceToday, recentLeads, upcoming] =
      await Promise.all([
        this.prisma.client.user.count({ where: { role: 'STUDENT', isActive: true, deletedAt: null } }),
        this.prisma.client.user.count({ where: { role: 'TEACHER', isActive: true, deletedAt: null } }),
        this.prisma.client.course.count({ where: { status: 'ACTIVE' } }),
        this.prisma.client.lead.count({ where: { status: 'NEW' } }),
        this.prisma.client.schedule.count({
          where: { startsAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
        }),
        this.prisma.client.homeworkSubmission.count({ where: { status: 'SUBMITTED' } }),
        this.prisma.client.attendance.count({ where: { joinedAt: { gte: from, lt: to } } }),
        this.prisma.client.lead.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            phone: true,
            audience: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.client.schedule.findMany({
          where: { startsAt: { gte: now }, status: 'SCHEDULED' },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            course: { select: { id: true, title: true } },
          },
        }),
      ])

    return {
      stats: {
        students,
        teachers,
        activeCourses,
        newLeads,
        lessonsToday,
        pendingHomework,
        attendanceToday,
      },
      recentLeads: recentLeads.map((lead) => ({ ...lead, createdAt: lead.createdAt.toISOString() })),
      upcoming: upcoming.map((lesson) => ({
        ...lesson,
        startsAt: lesson.startsAt.toISOString(),
        endsAt: lesson.endsAt.toISOString(),
      })),
      generatedAt: now.toISOString(),
    }
  }

  async students(query: ManagerStudentsQuery) {
    const where: Prisma.UserWhereInput = {
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
    }

    const [total, items] = await Promise.all([
      this.prisma.client.user.count({ where }),
      this.prisma.client.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          studentProfile: { select: { gradeLevel: true } },
          coinBalance: { select: { balance: true } },
          enrollments: {
            where: { status: 'ACTIVE' },
            select: { progress: true, course: { select: { id: true, title: true } } },
          },
        },
      }),
    ])

    return {
      items: items.map((student) => ({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        phone: student.phone,
        avatarUrl: student.avatarUrl,
        isActive: student.isActive,
        gradeLevel: student.studentProfile?.gradeLevel ?? null,
        coinBalance: student.coinBalance?.balance ?? 0,
        courses: student.enrollments.map((enrollment) => ({
          id: enrollment.course.id,
          title: enrollment.course.title,
          progress: enrollment.progress,
        })),
        lastLoginAt: student.lastLoginAt?.toISOString() ?? null,
        createdAt: student.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    }
  }
}
