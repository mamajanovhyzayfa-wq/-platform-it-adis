import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'

/**
 * Очередь проверки работ и результаты тестов.
 *
 * Администратор видит весь филиал, преподаватель — только свои курсы.
 * Это отдельный маршрут, а не /api/admin: последний целиком закрыт ролью
 * ADMIN, и открывать его преподавателю нельзя.
 */
export const reviewRouter = Router()
reviewRouter.use(requireAuth, requireRole('ADMIN', 'TEACHER'))

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const submissionsQuerySchema = pageSchema.extend({
  status: z.enum(['SUBMITTED', 'REVIEWED', 'RETURNED', 'ALL']).default('ALL'),
  search: z.string().trim().max(100).optional(),
})

reviewRouter.get('/submissions', validate(submissionsQuerySchema, 'query'), async (req, res) => {
  const auth = req.auth!
  const query = req.query as unknown as z.infer<typeof submissionsQuerySchema>
  const search = query.search?.trim()

  const where = {
    // Преподаватель не должен видеть работы чужих курсов даже при прямом запросе.
    ...(auth.role === 'TEACHER' ? { homework: { teacherId: auth.userId } } : {}),
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

reviewRouter.get('/test-attempts', validate(pageSchema, 'query'), async (req, res) => {
  const auth = req.auth!
  const query = req.query as unknown as z.infer<typeof pageSchema>

  const where =
    auth.role === 'TEACHER'
      ? { test: { course: { teacherId: auth.userId } } }
      : {}

  const [total, items] = await prisma.$transaction([
    prisma.testAttempt.count({ where }),
    prisma.testAttempt.findMany({
      where,
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
