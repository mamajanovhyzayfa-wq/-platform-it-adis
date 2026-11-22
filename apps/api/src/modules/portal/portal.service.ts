import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string | null
  href: string
}

/**
 * Данные главных панелей ролей и глобальный поиск.
 *
 * Каждый запрос ограничен данными текущего пользователя: ученик видит свои курсы,
 * наставник — свои группы, родитель — только подтверждённых детей.
 */
@Injectable()
export class PortalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async enrolledCourseIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.courseEnrollment.findMany({
      where: { studentId: userId },
      select: { courseId: true },
    })
    return rows.map((row) => row.courseId)
  }

  async student(userId: string) {
    const now = new Date()
    const courseIds = await this.enrolledCourseIds(userId)

    const [
      enrollments,
      upcoming,
      homework,
      tests,
      submissions,
      attempts,
      coins,
      transactions,
      achievements,
      notifications,
      unread,
      lessonsDone,
      lessonsTotal,
    ] = await Promise.all([
      this.prisma.client.courseEnrollment.findMany({
        where: { studentId: userId },
        orderBy: { enrolledAt: 'desc' },
        take: 6,
        select: {
          progress: true,
          status: true,
          course: { select: { id: true, title: true, coverUrl: true, level: true } },
        },
      }),
      this.prisma.client.schedule.findMany({
        where: { courseId: { in: courseIds }, startsAt: { gte: now }, status: { in: ['SCHEDULED', 'ONGOING'] } },
        orderBy: { startsAt: 'asc' },
        take: 5,
        select: { id: true, title: true, startsAt: true, endsAt: true, course: { select: { title: true } } },
      }),
      this.prisma.client.homework.findMany({
        where: { courseId: { in: courseIds }, submissions: { none: { studentId: userId } } },
        orderBy: { dueAt: 'asc' },
        take: 5,
        select: { id: true, title: true, dueAt: true, course: { select: { title: true } } },
      }),
      this.prisma.client.test.findMany({
        where: { courseId: { in: courseIds }, isPublished: true },
        take: 5,
        select: {
          id: true,
          title: true,
          course: { select: { title: true } },
          attempts: { where: { studentId: userId }, select: { status: true, score: true } },
        },
      }),
      this.prisma.client.homeworkSubmission.findMany({
        where: { studentId: userId, status: 'REVIEWED', score: { not: null } },
        orderBy: { reviewedAt: 'desc' },
        take: 5,
        select: { id: true, score: true, reviewedAt: true, homework: { select: { title: true, maxScore: true } } },
      }),
      this.prisma.client.testAttempt.findMany({
        where: { studentId: userId, status: 'SUBMITTED' },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: { id: true, score: true, submittedAt: true, test: { select: { title: true } } },
      }),
      this.prisma.client.coinBalance.findUnique({ where: { userId }, select: { balance: true } }),
      this.prisma.client.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, amount: true, reason: true, createdAt: true },
      }),
      this.prisma.client.userAchievement.findMany({
        where: { userId },
        orderBy: { awardedAt: 'desc' },
        take: 5,
        select: { awardedAt: true, achievement: { select: { title: true, description: true, iconUrl: true } } },
      }),
      this.prisma.client.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, body: true, type: true, createdAt: true, readAt: true },
      }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
      this.prisma.client.lessonProgress.count({ where: { studentId: userId, status: 'COMPLETED' } }),
      courseIds.length
        ? this.prisma.client.lesson.count({ where: { module: { courseId: { in: courseIds } } } })
        : Promise.resolve(0),
    ])

    const results = [
      ...submissions.map((item) => ({
        id: item.id,
        kind: 'Домашняя работа',
        title: item.homework.title,
        score: item.score ?? 0,
        max: item.homework.maxScore,
        date: item.reviewedAt,
      })),
      ...attempts.map((item) => ({
        id: item.id,
        kind: 'Тест',
        title: item.test.title,
        score: item.score ?? 0,
        max: 100,
        date: item.submittedAt,
      })),
    ]
      .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      .slice(0, 5)

    return {
      courses: enrollments.map((item) => ({
        id: item.course.id,
        title: item.course.title,
        coverUrl: item.course.coverUrl,
        level: item.course.level,
        progress: item.progress,
        status: item.status,
      })),
      upcoming: upcoming.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course.title,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      })),
      homework: homework.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course.title,
        dueAt: item.dueAt,
      })),
      tests: tests.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course.title,
        attempts: item.attempts.length,
        lastScore: [...item.attempts].reverse().find((attempt) => attempt.score !== null)?.score ?? null,
      })),
      results,
      progress: {
        lessonsCompleted: lessonsDone,
        lessonsTotal,
        percent: lessonsTotal > 0 ? Math.round((lessonsDone / lessonsTotal) * 100) : 0,
      },
      coins: { balance: coins?.balance ?? 0, recent: transactions },
      achievements: achievements.map((item) => ({
        title: item.achievement.title,
        description: item.achievement.description,
        iconUrl: item.achievement.iconUrl,
        awardedAt: item.awardedAt,
      })),
      notifications: { unread, items: notifications },
    }
  }

  async mentor(userId: string) {
    const now = new Date()
    const courses = await this.prisma.client.course.findMany({
      where: { teacherId: userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, _count: { select: { enrollments: true } } },
    })
    const courseIds = courses.map((course) => course.id)

    const [studentRows, upcoming, pendingItems, pendingCount, reviews, attendanceRows, participants, notifications, unread] =
      await Promise.all([
        this.prisma.client.courseEnrollment.findMany({
          where: { courseId: { in: courseIds } },
          take: 500,
          select: { studentId: true, student: { select: { firstName: true, lastName: true } } },
        }),
        this.prisma.client.schedule.findMany({
          where: { teacherId: userId, startsAt: { gte: now }, status: { in: ['SCHEDULED', 'ONGOING'] } },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: { id: true, title: true, startsAt: true, course: { select: { title: true } } },
        }),
        this.prisma.client.homeworkSubmission.findMany({
          where: { status: 'SUBMITTED', homework: { teacherId: userId } },
          orderBy: { submittedAt: 'asc' },
          take: 5,
          select: {
            id: true,
            submittedAt: true,
            homework: { select: { title: true } },
            student: { select: { firstName: true, lastName: true } },
          },
        }),
        this.prisma.client.homeworkSubmission.count({
          where: { status: 'SUBMITTED', homework: { teacherId: userId } },
        }),
        this.prisma.client.homeworkReview.aggregate({
          where: { submission: { homework: { teacherId: userId } } },
          _avg: { score: true },
        }),
        this.prisma.client.attendance.findMany({
          where: { schedule: { teacherId: userId } },
          select: { durationSeconds: true },
          take: 500,
        }),
        this.prisma.client.conversationParticipant.findMany({
          where: { userId },
          select: { conversationId: true, lastReadAt: true },
        }),
        this.prisma.client.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, body: true, createdAt: true, readAt: true },
        }),
        this.prisma.client.notification.count({ where: { userId, readAt: null } }),
      ])

    const students = [
      ...new Map(
        studentRows.map((row) => [
          row.studentId,
          { id: row.studentId, name: `${row.student.firstName} ${row.student.lastName}` },
        ]),
      ).values(),
    ]

    const unreadMessages = participants.length
      ? await this.prisma.client.message.count({
          where: {
            senderId: { not: userId },
            OR: participants.map((participant) =>
              participant.lastReadAt
                ? { conversationId: participant.conversationId, createdAt: { gt: participant.lastReadAt } }
                : { conversationId: participant.conversationId },
            ),
          },
        })
      : 0

    const attendanceRate = attendanceRows.length
      ? Math.round((attendanceRows.filter((row) => row.durationSeconds > 0).length / attendanceRows.length) * 100)
      : 0

    return {
      groups: courses.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        students: course._count.enrollments,
      })),
      students: { total: students.length, items: students.slice(0, 8) },
      upcoming: upcoming.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course.title,
        startsAt: item.startsAt,
      })),
      pendingReviews: {
        count: pendingCount,
        items: pendingItems.map((item) => ({
          id: item.id,
          title: item.homework.title,
          student: `${item.student.firstName} ${item.student.lastName}`,
          submittedAt: item.submittedAt,
        })),
      },
      stats: {
        groups: courses.length,
        students: students.length,
        averageScore: Math.round(reviews._avg.score ?? 0),
        attendanceRate,
      },
      messages: { unread: unreadMessages },
      notifications: { unread, items: notifications },
    }
  }

  async manager(userId: string) {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [
      students,
      teachers,
      activeGroups,
      newLeads,
      upcoming,
      attendanceWeek,
      leads,
      notifications,
      unread,
      studentList,
      groupList,
      teacherList,
    ] = await Promise.all([
        this.prisma.client.user.count({ where: { role: 'STUDENT', deletedAt: null } }),
        this.prisma.client.user.count({ where: { role: 'TEACHER', deletedAt: null } }),
        this.prisma.client.course.count({ where: { status: 'ACTIVE' } }),
        this.prisma.client.lead.count({ where: { status: 'NEW' } }),
        this.prisma.client.schedule.findMany({
          where: { startsAt: { gte: now }, status: { in: ['SCHEDULED', 'ONGOING'] } },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: {
            id: true,
            title: true,
            startsAt: true,
            course: { select: { title: true } },
            teacherId: true,
          },
        }),
        this.prisma.client.attendance.count({ where: { joinedAt: { gte: weekAgo } } }),
        this.prisma.client.lead.findMany({
          where: { status: 'NEW' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, name: true, phone: true, audience: true, createdAt: true },
        }),
        this.prisma.client.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, body: true, createdAt: true, readAt: true },
        }),
        this.prisma.client.notification.count({ where: { userId, readAt: null } }),
        this.prisma.client.user.findMany({
          where: { role: 'STUDENT', deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
        this.prisma.client.course.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            title: true,
            teacher: { select: { firstName: true, lastName: true } },
            _count: { select: { enrollments: true } },
          },
        }),
        this.prisma.client.user.findMany({
          where: { role: 'TEACHER', deletedAt: null },
          orderBy: { firstName: 'asc' },
          take: 8,
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
      ])

    return {
      metrics: { students, teachers, activeGroups, newLeads, attendanceWeek },
      studentsList: studentList.map((item) => ({
        id: item.id,
        name: `${item.firstName} ${item.lastName}`,
        email: item.email,
      })),
      groups: groupList.map((item) => ({
        id: item.id,
        title: item.title,
        teacher: `${item.teacher.firstName} ${item.teacher.lastName}`,
        students: item._count.enrollments,
      })),
      teachersList: teacherList.map((item) => ({
        id: item.id,
        name: `${item.firstName} ${item.lastName}`,
        email: item.email,
      })),
      upcoming: upcoming.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course.title,
        startsAt: item.startsAt,
      })),
      leads,
      notifications: { unread, items: notifications },
    }
  }

  async parent(userId: string) {
    const parent = await this.prisma.client.parent.findUnique({ where: { userId }, select: { id: true } })
    if (!parent) return { children: [], notifications: { unread: 0, items: [] } }

    const links = await this.prisma.client.parentStudentLink.findMany({
      where: { parentId: parent.id, verifiedAt: { not: null } },
      include: {
        student: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
    })

    const now = new Date()
    const children = await Promise.all(
      links.slice(0, 5).map(async (link) => {
        const studentUser = link.student.user
        const enrollments = await this.prisma.client.courseEnrollment.findMany({
          where: { studentId: studentUser.id },
          select: { progress: true, course: { select: { id: true, title: true } } },
          take: 6,
        })
        const courseIds = enrollments.map((item) => item.course.id)
        const [coins, upcoming, payments, attendanceRows, achievements, homework, results] = await Promise.all([
          this.prisma.client.coinBalance.findUnique({ where: { userId: studentUser.id }, select: { balance: true } }),
          this.prisma.client.schedule.findMany({
            where: { courseId: { in: courseIds }, startsAt: { gte: now } },
            orderBy: { startsAt: 'asc' },
            take: 3,
            select: { id: true, title: true, startsAt: true },
          }),
          this.prisma.client.payment.aggregate({
            where: { invoice: { studentId: studentUser.id }, status: 'CONFIRMED' },
            _sum: { amount: true },
          }),
          this.prisma.client.attendance.findMany({
            where: { userId: studentUser.id },
            select: { durationSeconds: true },
            take: 200,
          }),
          this.prisma.client.userAchievement.count({ where: { userId: studentUser.id } }),
          this.prisma.client.homework.findMany({
            where: { courseId: { in: courseIds } },
            orderBy: { dueAt: 'asc' },
            take: 5,
            select: { id: true, title: true, dueAt: true, course: { select: { title: true } } },
          }),
          this.prisma.client.testAttempt.findMany({
            where: { studentId: studentUser.id, status: 'SUBMITTED' },
            orderBy: { submittedAt: 'desc' },
            take: 5,
            select: {
              id: true,
              score: true,
              percent: true,
              submittedAt: true,
              test: { select: { title: true } },
            },
          }),
        ])

        return {
          id: studentUser.id,
          name: `${studentUser.firstName} ${studentUser.lastName}`,
          email: studentUser.email,
          relation: link.relation,
          courses: enrollments.map((item) => ({
            id: item.course.id,
            title: item.course.title,
            progress: item.progress,
          })),
          coins: coins?.balance ?? 0,
          upcoming,
          paidTotalKgs: payments._sum.amount ?? 0,
          attendanceRate: attendanceRows.length
            ? Math.round((attendanceRows.filter((row) => row.durationSeconds > 0).length / attendanceRows.length) * 100)
            : 0,
          achievements,
          homework: homework.map((item) => ({
            id: item.id,
            title: item.title,
            course: item.course.title,
            dueAt: item.dueAt,
          })),
          results: results.map((item) => ({
            id: item.id,
            title: item.test.title,
            score: item.score,
            percent: item.percent,
            submittedAt: item.submittedAt,
          })),
        }
      }),
    )

    const [notifications, unread] = await Promise.all([
      this.prisma.client.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, body: true, createdAt: true, readAt: true },
      }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ])

    return { children, notifications: { unread, items: notifications } }
  }

  /** Глобальный поиск по данным, доступным текущей роли. */
  async search(userId: string, role: RoleName, rawQuery: string) {
    const query = rawQuery.trim()
    if (query.length < 2) return { query, results: [] as SearchResult[] }

    const contains = { contains: query, mode: 'insensitive' as const }
    const results: SearchResult[] = []
    const max = 12

    if (role === 'STUDENT') {
      const courseIds = await this.enrolledCourseIds(userId)
      const [courses, lessons, materials] = await Promise.all([
        this.prisma.client.course.findMany({
          where: { id: { in: courseIds }, title: contains },
          take: max,
          select: { id: true, title: true },
        }),
        this.prisma.client.lesson.findMany({
          where: { module: { courseId: { in: courseIds } }, title: contains },
          take: max,
          select: { id: true, title: true, module: { select: { course: { select: { title: true } } } } },
        }),
        this.prisma.client.knowledgeMaterial.findMany({
          where: { isPublished: true, title: contains },
          take: max,
          select: { id: true, title: true, category: { select: { title: true } } },
        }),
      ])
      results.push(
        ...courses.map((item) => ({
          type: 'Курс',
          id: item.id,
          title: item.title,
          subtitle: null,
          href: '/student',
        })),
        ...lessons.map((item) => ({
          type: 'Урок',
          id: item.id,
          title: item.title,
          subtitle: item.module.course.title,
          href: '/student',
        })),
        ...materials.map((item) => ({
          type: 'Материал',
          id: item.id,
          title: item.title,
          subtitle: item.category.title,
          href: '/student',
        })),
      )
    }

    if (role === 'TEACHER') {
      const [courses, students, homework] = await Promise.all([
        this.prisma.client.course.findMany({
          where: { teacherId: userId, title: contains },
          take: max,
          select: { id: true, title: true },
        }),
        this.prisma.client.user.findMany({
          where: {
            role: 'STUDENT',
            enrollments: { some: { course: { teacherId: userId } } },
            OR: [{ firstName: contains }, { lastName: contains }, { email: contains }],
          },
          take: max,
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
        this.prisma.client.homework.findMany({
          where: { teacherId: userId, title: contains },
          take: max,
          select: { id: true, title: true, course: { select: { title: true } } },
        }),
      ])
      results.push(
        ...courses.map((item) => ({
          type: 'Курс',
          id: item.id,
          title: item.title,
          subtitle: null,
          href: '/mentor',
        })),
        ...students.map((item) => ({
          type: 'Ученик',
          id: item.id,
          title: `${item.firstName} ${item.lastName}`,
          subtitle: item.email,
          href: '/mentor',
        })),
        ...homework.map((item) => ({
          type: 'Задание',
          id: item.id,
          title: item.title,
          subtitle: item.course.title,
          href: '/review',
        })),
      )
    }

    if (role === 'MANAGER' || role === 'ADMIN') {
      const [users, courses, leads] = await Promise.all([
        this.prisma.client.user.findMany({
          where: {
            deletedAt: null,
            OR: [
              { firstName: contains },
              { lastName: contains },
              { email: contains },
              { phone: contains },
            ],
          },
          take: max,
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        }),
        this.prisma.client.course.findMany({
          where: { title: contains },
          take: max,
          select: { id: true, title: true, status: true },
        }),
        this.prisma.client.lead.findMany({
          where: { OR: [{ name: contains }, { phone: contains }, { email: contains }] },
          take: max,
          select: { id: true, name: true, phone: true, status: true },
        }),
      ])
      results.push(
        ...users.map((item) => ({
          type: item.role,
          id: item.id,
          title: `${item.firstName} ${item.lastName}`,
          subtitle: item.email,
          href: role === 'ADMIN' ? '/users' : '/manager',
        })),
        ...courses.map((item) => ({
          type: 'Курс',
          id: item.id,
          title: item.title,
          subtitle: item.status,
          href: '/courses',
        })),
        ...leads.map((item) => ({
          type: 'Заявка',
          id: item.id,
          title: item.name,
          subtitle: `${item.phone} · ${item.status}`,
          href: role === 'ADMIN' ? '/review' : '/manager',
        })),
      )
    }

    if (role === 'PARENT') {
      const parent = await this.prisma.client.parent.findUnique({ where: { userId }, select: { id: true } })
      if (parent) {
        const links = await this.prisma.client.parentStudentLink.findMany({
          where: {
            parentId: parent.id,
            verifiedAt: { not: null },
            student: {
              user: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] },
            },
          },
          include: { student: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } },
          take: max,
        })
        results.push(
          ...links.map((link) => ({
            type: 'Ребёнок',
            id: link.student.user.id,
            title: `${link.student.user.firstName} ${link.student.user.lastName}`,
            subtitle: link.student.user.email,
            href: '/parent',
          })),
        )
      }
    }

    return { query, results: results.slice(0, 30) }
  }
}
