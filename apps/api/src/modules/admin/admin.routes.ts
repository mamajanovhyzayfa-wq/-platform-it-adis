import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requireStepUp } from '../../middleware/step-up.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'
import { summarizeUserRoles, userUpdateData } from './admin.users.js'

/** Все маршруты модуля доступны только администратору и пишут критичные изменения в аудит. */
export const adminRouter = Router()
adminRouter.use(requireAuth, requireRole('ADMIN'))

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const usersQuerySchema = pageSchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']).optional(),
  onlyBlocked: z.enum(['true', 'false']).optional(),
})

const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    role: z.enum(['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Нет полей для изменения')

/** Некорректный идентификатор отсекаем до проверки подтверждения действия. */
const userIdParamsSchema = z.object({ id: z.string().uuid() })

const auditQuerySchema = pageSchema.extend({
  action: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(100).optional(),
})

const coursesQuerySchema = pageSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
})

/** Сводка для главного экрана панели. */
adminRouter.get('/dashboard', async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    students,
    teachers,
    admins,
    managers,
    parents,
    activeCourses,
    draftCourses,
    completedEnrollments,
    upcomingLessons,
    homeworkTotal,
    newUsers,
    activeLastWeek,
    recentAudit,
  ] = await prisma.$transaction([
    prisma.user.count({ where: { role: 'STUDENT', deletedAt: null } }),
    prisma.user.count({ where: { role: 'TEACHER', deletedAt: null } }),
    prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } }),
    prisma.user.count({ where: { role: 'MANAGER', deletedAt: null } }),
    prisma.user.count({ where: { role: 'PARENT', deletedAt: null } }),
    prisma.course.count({ where: { status: 'ACTIVE' } }),
    prisma.course.count({ where: { status: 'DRAFT' } }),
    prisma.courseEnrollment.count({ where: { status: 'COMPLETED' } }),
    prisma.schedule.count({ where: { startsAt: { gte: new Date() }, status: 'SCHEDULED' } }),
    prisma.homework.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
    prisma.user.count({ where: { lastLoginAt: { gte: weekAgo }, deletedAt: null } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
    }),
  ])

  res.json({
    users: summarizeUserRoles({ students, teachers, admins, managers, parents }),
    courses: { active: activeCourses, draft: draftCourses, completedEnrollments },
    upcomingLessons,
    homeworkTotal,
    activity: { newUsers, activeLastWeek },
    recentAudit: recentAudit.map((item) => ({
      id: item.id,
      action: item.action,
      entity: item.entity,
      createdAt: item.createdAt,
      actor: item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : 'Система',
    })),
  })
})

/** Пользователи с поиском, фильтром по роли и пагинацией. */
adminRouter.get('/users', validate(usersQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof usersQuerySchema>
  const search = query.search?.trim()

  const where = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.onlyBlocked === 'true' ? { isActive: false } : {}),
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { enrollments: true, taughtCourses: true } },
      },
    }),
  ])

  res.json({
    items: items.map((user) => ({
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      emailVerified: Boolean(user.emailVerifiedAt),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      courses: user.role === 'TEACHER' ? user._count.taughtCourses : user._count.enrollments,
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

/** Изменение роли или блокировка аккаунта — только с записью в аудит. */
adminRouter.patch(
  '/users/:id',
  validate(userIdParamsSchema, 'params'),
  validate(updateUserSchema),
  requireStepUp,
  async (req, res) => {
  const auth = req.auth!
  const user = await prisma.user.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
  if (!user) throw notFound('Пользователь не найден')

  if (user.id === auth.userId && (req.body.role || req.body.isActive === false)) {
    throw badRequest('Нельзя изменить собственную роль или заблокировать себя')
  }

  // Роль и Parent-профиль обновляются одной вложенной записью Prisma:
  // родитель без профиля не увидит детей и финансовую историю.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: userUpdateData(user.id, req.body, user.role),
  })

  await writeAudit({
    actorId: auth.userId,
    action: 'admin.user.update',
    entity: 'User',
    entityId: user.id,
    metadata: {
      before: { role: user.role, isActive: user.isActive },
      after: { role: updated.role, isActive: updated.isActive },
    },
    ip: req.ip,
  })

  res.json({
    id: updated.id,
    role: updated.role,
    isActive: updated.isActive,
    firstName: updated.firstName,
    lastName: updated.lastName,
  })
})

/** Курсы платформы с преподавателем и количеством записей. */
adminRouter.get('/courses', validate(coursesQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof coursesQuerySchema>

  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        teacher: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { enrollments: true, modules: true } },
      },
    }),
  ])

  res.json({
    items: items.map((course) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      level: course.level,
      status: course.status,
      startDate: course.startDate,
      createdAt: course.createdAt,
      teacher: `${course.teacher.firstName} ${course.teacher.lastName}`,
      enrollments: course._count.enrollments,
      modules: course._count.modules,
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

/** Аналитика: записи, сдачи, посещаемость, популярные курсы. */
adminRouter.get('/analytics', async (_req, res) => {
  const [pending, active, paused, completed, submitted, reviewed, returned, attempts, attendance, popularCourses, activeStudents] =
    await prisma.$transaction([
      prisma.courseEnrollment.count({ where: { status: 'PENDING' } }),
      prisma.courseEnrollment.count({ where: { status: 'ACTIVE' } }),
      prisma.courseEnrollment.count({ where: { status: 'PAUSED' } }),
      prisma.courseEnrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.homeworkSubmission.count({ where: { status: 'SUBMITTED' } }),
      prisma.homeworkSubmission.count({ where: { status: 'REVIEWED' } }),
      prisma.homeworkSubmission.count({ where: { status: 'RETURNED' } }),
      prisma.testAttempt.aggregate({ _count: { _all: true }, _avg: { score: true } }),
      prisma.attendance.aggregate({ _count: { _all: true }, _sum: { durationSeconds: true } }),
      prisma.course.findMany({
        orderBy: { enrollments: { _count: 'desc' } },
        take: 5,
        select: { id: true, title: true, status: true, _count: { select: { enrollments: true } } },
      }),
      prisma.lessonProgress.findMany({
        where: { completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        distinct: ['studentId'],
        select: { studentId: true },
      }),
    ])

  res.json({
    enrollments: { PENDING: pending, ACTIVE: active, PAUSED: paused, COMPLETED: completed },
    submissions: { SUBMITTED: submitted, REVIEWED: reviewed, RETURNED: returned },
    testAttempts: { total: attempts._count._all, averageScore: Math.round((attempts._avg.score ?? 0) * 10) / 10 },
    attendance: { sessions: attendance._count._all, totalMinutes: Math.round((attendance._sum.durationSeconds ?? 0) / 60) },
    activeStudents: activeStudents.length,
    popularCourses: popularCourses.map((course) => ({
      id: course.id,
      title: course.title,
      status: course.status,
      enrollments: course._count.enrollments,
    })),
  })
})

/** Очередь домашних работ: что ждёт проверки, что проверено и что возвращено. */
const submissionsQuerySchema = pageSchema.extend({
  status: z.enum(['SUBMITTED', 'REVIEWED', 'RETURNED', 'ALL']).default('ALL'),
  search: z.string().trim().max(100).optional(),
})

adminRouter.get('/submissions', validate(submissionsQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof submissionsQuerySchema>
  const search = query.search?.trim()

  const where = {
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    ...(search
      ? {
          OR: [
            { student: { firstName: { contains: search, mode: 'insensitive' as const } } },
            { student: { lastName: { contains: search, mode: 'insensitive' as const } } },
            { homework: { title: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.homeworkSubmission.count({ where }),
    prisma.homeworkSubmission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        homework: { select: { id: true, title: true, maxScore: true, course: { select: { id: true, title: true } } } },
        review: { select: { score: true, comment: true, createdAt: true } },
      },
    }),
  ])

  res.json({
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      attempt: item.attempt,
      score: item.score,
      submittedAt: item.submittedAt,
      text: item.text,
      projectUrl: item.projectUrl,
      files: item.files,
      student: item.student,
      homework: {
        id: item.homework.id,
        title: item.homework.title,
        maxScore: item.homework.maxScore,
        course: item.homework.course,
      },
      review: item.review,
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

/** Попытки тестов: баллы и процент считает сервер, здесь — сводка для панели. */
adminRouter.get('/test-attempts', validate(pageSchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof pageSchema>

  const [total, items] = await prisma.$transaction([
    prisma.testAttempt.count(),
    prisma.testAttempt.findMany({
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        test: {
          select: {
            id: true,
            title: true,
            passingScore: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
    }),
  ])

  res.json({
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      score: item.score,
      passed: item.score === null ? null : item.score >= item.test.passingScore,
      startedAt: item.startedAt,
      submittedAt: item.submittedAt,
      student: item.student,
      test: {
        id: item.test.id,
        title: item.test.title,
        passingScore: item.test.passingScore,
        course: item.test.course,
      },
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

/** Все движения IT Coins с фильтром по источнику: начисления, списания и возвраты. */
const coinQuerySchema = pageSchema.extend({
  sourceType: z
    .enum([
      'HOMEWORK', 'TEST', 'ATTENDANCE', 'ACHIEVEMENT', 'COURSE', 'SHOP', 'MANUAL',
      'QUEST', 'STREAK', 'SEASON', 'EVENT', 'PENALTY', 'REFUND', 'REVERSAL', 'LEVEL', 'ADJUSTMENT',
    ])
    .optional(),
  search: z.string().trim().max(100).optional(),
})

adminRouter.get('/coin-transactions', validate(coinQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof coinQuerySchema>
  const search = query.search?.trim()

  const where = {
    ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    ...(search
      ? {
          OR: [
            { reason: { contains: search, mode: 'insensitive' as const } },
            { user: { firstName: { contains: search, mode: 'insensitive' as const } } },
            { user: { lastName: { contains: search, mode: 'insensitive' as const } } },
            { user: { email: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [total, items, income, outcome] = await prisma.$transaction([
    prisma.coinTransaction.count({ where }),
    prisma.coinTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    prisma.coinTransaction.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.coinTransaction.aggregate({ where: { amount: { lt: 0 } }, _sum: { amount: true } }),
  ])

  res.json({
    items: items.map((item) => ({
      id: item.id,
      amount: item.amount,
      reason: item.reason,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      createdAt: item.createdAt,
      user: item.user,
    })),
    total,
    page: query.page,
    limit: query.limit,
    totals: { awarded: income._sum.amount ?? 0, spent: Math.abs(outcome._sum.amount ?? 0) },
  })
})

/** Расписание платформы: все курсы за период, для контроля конфликтов и нагрузки. */
adminRouter.get('/schedule', async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw badRequest('Некорректный период расписания')
  }

  const items = await prisma.schedule.findMany({
    where: { startsAt: { lt: to }, endsAt: { gt: from } },
    orderBy: { startsAt: 'asc' },
    take: 500,
    include: {
      course: { select: { id: true, title: true, teacher: { select: { firstName: true, lastName: true } } } },
      room: { select: { id: true } },
    },
  })

  res.json({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      hasRoom: Boolean(item.room),
      course: { id: item.course.id, title: item.course.title },
      teacher: `${item.course.teacher.firstName} ${item.course.teacher.lastName}`.trim(),
    })),
    range: { from: from.toISOString(), to: to.toISOString() },
  })
})

/** Заявки магазина для модерации: очередь строится от новых к обработанным. */
const shopOrdersQuerySchema = pageSchema.extend({
  status: z.enum(['NEW', 'APPROVED', 'ISSUED', 'REJECTED', 'ALL']).default('NEW'),
})

adminRouter.get('/shop-orders', validate(shopOrdersQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof shopOrdersQuerySchema>
  const where = query.status === 'ALL' ? {} : { status: query.status }

  const [total, items] = await prisma.$transaction([
    prisma.shopOrder.count({ where }),
    prisma.shopOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        product: { select: { id: true, title: true, priceCoins: true, category: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
  ])

  res.json({
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      comment: item.comment,
      createdAt: item.createdAt,
      product: item.product,
      user: item.user,
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

adminRouter.get('/audit-logs', validate(auditQuerySchema, 'query'), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof auditQuerySchema>
  const where = {
    ...(query.action ? { action: { contains: query.action } } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
    }),
  ])

  res.json({
    items: items.map((item) => ({
      id: item.id,
      action: item.action,
      entity: item.entity,
      entityId: item.entityId,
      metadata: item.metadata,
      ip: item.ip,
      createdAt: item.createdAt,
      actor: item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : 'Система',
      actorEmail: item.actor?.email ?? null,
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})
