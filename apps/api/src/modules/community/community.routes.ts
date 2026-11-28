import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { notifyUsers } from '../../lib/notify.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, COIN_RULES, eventPlaceCoinReward } from '../../lib/coins.js'
import { evaluateAchievements } from '../achievements/evaluate.js'
import { rankEventParticipants } from './event-ranking.js'

/**
 * Сообщество: обсуждения уроков, вопросы, встречи, объявления, события.
 * Все проверки доступа выполняются по пользователю из access-токена.
 */
export const communityRouter = Router()

const attachmentsSchema = z.array(z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url().max(2048),
  mimeType: z.string().trim().max(120).optional(),
})).max(5).optional()

const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentId: z.string().uuid().optional(),
  attachments: attachmentsSchema,
}).strict()

const questionSchema = z.object({
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(3).max(4000),
}).strict()

const answerSchema = z.object({
  answer: z.string().trim().min(3).max(4000),
  status: z.enum(['ANSWERED', 'CLOSED']).default('ANSWERED'),
}).strict()

const meetingCreateSchema = z.object({
  teacherId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().max(2000).optional(),
  preferredAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(180).default(30),
}).strict()

const meetingDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'DECLINED', 'CANCELLED', 'COMPLETED']),
  response: z.string().trim().max(1000).optional(),
}).strict()

const announcementSchema = z.object({
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(3).max(8000),
  audience: z.enum(['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'MANAGERS', 'COURSE']).default('ALL'),
  courseId: z.string().uuid().optional(),
  attachments: attachmentsSchema,
  isPinned: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
}).strict()

const announcementQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  audience: z.enum(['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'MANAGERS', 'COURSE']).optional(),
  courseId: z.string().uuid().optional(),
}).strict()

const eventCreateSchema = z.object({
  type: z.enum(['EVENT', 'CONTEST', 'OLYMPIAD', 'COMPETITION']).default('EVENT'),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(8000),
  rules: z.string().trim().max(8000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  registrationDeadline: z.string().datetime().optional(),
  location: z.string().trim().max(300).optional(),
  onlineUrl: z.string().url().max(2048).optional(),
  capacity: z.number().int().min(1).max(10000).optional(),
  visibility: z.enum(['BRANCH', 'COURSE', 'PUBLIC']).default('BRANCH'),
  courseId: z.string().uuid().optional(),
}).strict()

const eventUpdateSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'REGISTRATION', 'ONGOING', 'COMPLETED', 'CANCELLED']).optional(),
  title: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().min(3).max(8000).optional(),
  rules: z.string().trim().max(8000).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  location: z.string().trim().max(300).optional(),
  onlineUrl: z.string().url().max(2048).optional(),
  capacity: z.number().int().min(1).max(10000).optional(),
  visibility: z.enum(['BRANCH', 'COURSE', 'PUBLIC']).optional(),
}).strict()

const eventTaskSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(4000).optional(),
  dueAt: z.string().datetime().optional(),
  maxScore: z.number().int().min(1).max(1000).optional(),
  position: z.number().int().min(0).max(100).default(0),
}).strict()

const eventResultSchema = z.object({
  userId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  score: z.number().int().min(0).max(100000).optional(),
  place: z.number().int().min(1).max(1000).optional(),
  comment: z.string().trim().max(1000).optional(),
  publish: z.boolean().default(false),
}).strict()

const eventAwardSchema = z.object({
  userId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(1000).optional(),
  place: z.number().int().min(1).max(100).optional(),
}).strict()

const eventQuerySchema = z.object({
  type: z.enum(['EVENT', 'CONTEST', 'OLYMPIAD', 'COMPETITION']).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'REGISTRATION', 'ONGOING', 'COMPLETED', 'CANCELLED']).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

async function lessonCourse(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, module: { select: { course: { select: { id: true, title: true, teacherId: true } } } } },
  })
  if (!lesson) throw notFound('Урок не найден')
  return lesson
}

async function assertLessonAccess(lessonId: string, user: { userId: string; role: string }) {
  const lesson = await lessonCourse(lessonId)
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return lesson
  if (lesson.module.course.teacherId === user.userId) return lesson
  if (user.role === 'STUDENT') {
    const enrolled = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: lesson.module.course.id, studentId: user.userId } },
      select: { id: true },
    })
    if (enrolled) return lesson
  }
  if (user.role === 'PARENT') {
    const linked = await prisma.parentStudentLink.findFirst({
      where: {
        parent: { userId: user.userId },
        verifiedAt: { not: null },
        student: { user: { enrollments: { some: { courseId: lesson.module.course.id } } } },
      },
      select: { id: true },
    })
    if (linked) return lesson
  }
  throw forbidden('Урок доступен только участникам курса')
}

async function courseAudience(courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      teacherId: true,
      enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
    },
  })
  if (!course) throw notFound('Курс не найден')
  const learnerIds = course.enrollments.map((item) => item.studentId)
  const parents = learnerIds.length
    ? await prisma.parentStudentLink.findMany({
        where: { student: { userId: { in: learnerIds } }, verifiedAt: { not: null } },
        select: { parent: { select: { userId: true } } },
      })
    : []
  return {
    teacherId: course.teacherId,
    learnerIds,
    parentIds: parents.map((item) => item.parent.userId),
  }
}

communityRouter.get('/directory', requireAuth, async (req, res) => {
  const auth = req.auth!
  let courses: Array<{ id: string; title: string }> = []
  let students: Array<{ id: string; firstName: string; lastName: string; email: string }> = []
  if (auth.role === 'ADMIN' || auth.role === 'MANAGER') {
    courses = await prisma.course.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } })
  } else if (auth.role === 'TEACHER') {
    courses = await prisma.course.findMany({ where: { teacherId: auth.userId }, select: { id: true, title: true }, orderBy: { title: 'asc' } })
  } else if (auth.role === 'STUDENT') {
    const rows = await prisma.courseEnrollment.findMany({
      where: { studentId: auth.userId, status: 'ACTIVE' },
      select: { course: { select: { id: true, title: true } } },
    })
    courses = rows.map((row) => row.course)
  } else {
    const links = await prisma.parentStudentLink.findMany({
      where: { parent: { userId: auth.userId }, verifiedAt: { not: null } },
      select: { student: { select: { user: { select: { enrollments: { select: { course: { select: { id: true, title: true } } } } } } } } },
    })
    courses = [...new Map(links.flatMap((link) => link.student.user.enrollments.map((item) => item.course)).map((course) => [course.id, course])).values()]
  }
  if (auth.role === 'ADMIN' || auth.role === 'MANAGER') {
    students = await prisma.user.findMany({
      where: { role: 'STUDENT', isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    })
  } else if (auth.role === 'TEACHER') {
    // Наставник видит только учеников своих курсов.
    const courses = await prisma.course.findMany({
      where: { teacherId: auth.userId },
      select: { enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } },
    })
    const studentIds = [...new Set(courses.flatMap((course) => course.enrollments.map((item) => item.studentId)))]
    students = await prisma.user.findMany({
      where: { id: { in: studentIds }, role: 'STUDENT', isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    })
  } else if (auth.role === 'PARENT') {
    const links = await prisma.parentStudentLink.findMany({
      where: { parent: { userId: auth.userId }, verifiedAt: { not: null } },
      select: { student: { select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } },
    })
    students = links.map((link) => link.student.user)
  }
  const teachers = await prisma.user.findMany({
    where: { role: 'TEACHER', isActive: true, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  res.json({ courses, teachers, students })
})

// ---------------------------------------------------------- комментарии урока

communityRouter.get('/lessons/:lessonId/comments', requireAuth, async (req, res) => {
  const lesson = await assertLessonAccess(String(req.params.lessonId), req.auth!)
  const comments = await prisma.lessonComment.findMany({
    where: { lessonId: lesson.id, parentId: null },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } } },
      },
    },
  })
  res.json({ lesson: { id: lesson.id, title: lesson.title }, items: comments })
})

communityRouter.post('/lessons/:lessonId/comments', requireAuth, validate(commentSchema), async (req, res) => {
  const lesson = await assertLessonAccess(String(req.params.lessonId), req.auth!)
  const parentId = req.body.parentId as string | undefined
  if (parentId) {
    const parent = await prisma.lessonComment.findFirst({ where: { id: parentId, lessonId: lesson.id }, select: { id: true, userId: true } })
    if (!parent) throw badRequest('Родительский комментарий не найден в этом уроке')
  }
  const comment = await prisma.lessonComment.create({
    data: {
      lessonId: lesson.id,
      userId: req.auth!.userId,
      parentId: parentId ?? null,
      body: req.body.body,
      attachments: (req.body.attachments as never) ?? undefined,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } } },
  })
  const recipients = new Set<string>([lesson.module.course.teacherId])
  if (parentId) {
    const parent = await prisma.lessonComment.findUnique({ where: { id: parentId }, select: { userId: true } })
    if (parent) recipients.add(parent.userId)
  }
  recipients.delete(req.auth!.userId)
  if (recipients.size) {
    await notifyUsers([...recipients], {
      type: 'MESSAGE_RECEIVED',
      title: `Комментарий к уроку «${lesson.title}»`,
      body: req.body.body.slice(0, 180),
      data: { kind: 'lesson_comment', lessonId: lesson.id, commentId: comment.id },
    })
  }
  res.status(201).json(comment)
})

// ------------------------------------------------------------- вопросы урока

communityRouter.get('/lessons/:lessonId/questions', requireAuth, async (req, res) => {
  const lesson = await assertLessonAccess(String(req.params.lessonId), req.auth!)
  const items = await prisma.lessonQuestion.findMany({
    where: { lessonId: lesson.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      student: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      answeredBy: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  res.json({ lesson: { id: lesson.id, title: lesson.title }, items })
})

communityRouter.post('/lessons/:lessonId/questions', requireAuth, validate(questionSchema), async (req, res) => {
  const lesson = await assertLessonAccess(String(req.params.lessonId), req.auth!)
  if (req.auth!.role !== 'STUDENT') throw forbidden('Вопрос по уроку задаёт ученик')
  const question = await prisma.lessonQuestion.create({
    data: { lessonId: lesson.id, studentId: req.auth!.userId, title: req.body.title, body: req.body.body },
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
  })
  const recipients = await prisma.courseEnrollment.findMany({
    where: { courseId: lesson.module.course.id, status: 'ACTIVE', studentId: { not: req.auth!.userId } },
    select: { studentId: true },
  })
  await notifyUsers([lesson.module.course.teacherId, ...recipients.map((item) => item.studentId)], {
    type: 'MESSAGE_RECEIVED',
    title: `Вопрос по уроку «${lesson.title}»`,
    body: req.body.title,
    data: { kind: 'lesson_question', lessonId: lesson.id, questionId: question.id },
  })
  res.status(201).json(question)
})

communityRouter.patch('/lesson-questions/:id/answer', requireAuth, validate(answerSchema), async (req, res) => {
  const question = await prisma.lessonQuestion.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, lessonId: true, studentId: true, title: true, lesson: { select: { module: { select: { course: { select: { teacherId: true, title: true } } } } } } },
  })
  if (!question) throw notFound('Вопрос не найден')
  if (!['ADMIN', 'MANAGER'].includes(req.auth!.role) && question.lesson.module.course.teacherId !== req.auth!.userId) {
    throw forbidden('Ответить на вопрос может наставник курса')
  }
  const updated = await prisma.lessonQuestion.update({
    where: { id: question.id },
    data: { answer: req.body.answer, status: req.body.status, answeredById: req.auth!.userId, answeredAt: new Date() },
    include: { student: { select: { id: true, firstName: true, lastName: true } }, answeredBy: { select: { id: true, firstName: true, lastName: true } } },
  })
  await notifyUsers([question.studentId], {
    type: 'MESSAGE_RECEIVED',
    title: 'Наставник ответил на вопрос',
    body: `«${question.title}»: ${String(req.body.answer).slice(0, 180)}`,
    data: { kind: 'lesson_answer', lessonId: question.lessonId, questionId: question.id },
  })
  res.json(updated)
})

// ------------------------------------------------------------------- встречи

communityRouter.get('/meeting-requests', requireAuth, async (req, res) => {
  const auth = req.auth!
  const where = auth.role === 'ADMIN'
    ? {}
    : auth.role === 'TEACHER' || auth.role === 'MANAGER'
      ? { OR: [{ requesterId: auth.userId }, { teacherId: auth.userId }] }
      : { OR: [{ requesterId: auth.userId }, { studentId: auth.userId }] }
  const items = await prisma.meetingRequest.findMany({
    where,
    orderBy: { preferredAt: 'asc' },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, role: true, email: true } },
      teacher: { select: { id: true, firstName: true, lastName: true, email: true } },
      student: { select: { id: true, firstName: true, lastName: true } },
      course: { select: { id: true, title: true } },
    },
  })
  res.json({ items })
})

communityRouter.post('/meeting-requests', requireAuth, validate(meetingCreateSchema), async (req, res) => {
  const auth = req.auth!
  const teacher = await prisma.user.findFirst({
    where: { id: req.body.teacherId, role: 'TEACHER', isActive: true, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!teacher) throw badRequest('Наставник не найден')
  if (auth.role === 'PARENT') {
    const linked = await prisma.parentStudentLink.findFirst({
      where: { parent: { userId: auth.userId }, verifiedAt: { not: null }, ...(req.body.studentId ? { student: { userId: req.body.studentId } } : {}) },
      select: { id: true },
    })
    if (!linked) throw forbidden('Можно запросить встречу только по подтверждённому ребёнку')
  }
  const request = await prisma.meetingRequest.create({
    data: {
      requesterId: auth.userId,
      teacherId: teacher.id,
      studentId: req.body.studentId ?? (auth.role === 'STUDENT' ? auth.userId : null),
      courseId: req.body.courseId ?? null,
      subject: req.body.subject,
      message: req.body.message ?? null,
      preferredAt: new Date(req.body.preferredAt),
      durationMinutes: req.body.durationMinutes,
    },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, role: true } },
      teacher: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  await notifyUsers([teacher.id], {
    type: 'MEETING_REQUEST',
    title: 'Новый запрос на встречу',
    body: `${req.body.subject} · ${new Date(req.body.preferredAt).toLocaleString('ru-RU')}`,
    data: { kind: 'meeting_request', meetingRequestId: request.id },
    email: { subject: 'ITadis: запрос на встречу', text: `${req.body.subject}\n${req.body.message ?? ''}` },
  })
  res.status(201).json(request)
})

communityRouter.patch('/meeting-requests/:id', requireAuth, validate(meetingDecisionSchema), async (req, res) => {
  const auth = req.auth!
  const request = await prisma.meetingRequest.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, requesterId: true, teacherId: true, subject: true, status: true },
  })
  if (!request) throw notFound('Запрос не найден')
  if (!['ADMIN', 'MANAGER'].includes(auth.role) && request.teacherId !== auth.userId && request.requesterId !== auth.userId) {
    throw forbidden('Решение по встрече принимает участник или администратор')
  }
  if (request.requesterId === auth.userId && req.body.status !== 'CANCELLED') {
    throw forbidden('Автор запроса может только отменить его')
  }
  const updated = await prisma.meetingRequest.update({
    where: { id: request.id },
    data: { status: req.body.status, response: req.body.response ?? null, respondedAt: new Date() },
  })
  await notifyUsers([request.requesterId, request.teacherId].filter((id) => id !== auth.userId), {
    type: 'MEETING_RESPONSE',
    title: 'Ответ по запросу на встречу',
    body: `${request.subject}: ${req.body.status}`,
    data: { kind: 'meeting_response', meetingRequestId: request.id, status: req.body.status },
  })
  res.json(updated)
})

// ---------------------------------------------------------------- объявления

function announcementAudiences(role: string): string[] {
  if (role === 'STUDENT') return ['STUDENTS']
  if (role === 'PARENT') return ['PARENTS']
  if (role === 'TEACHER') return ['TEACHERS']
  if (role === 'MANAGER') return ['MANAGERS']
  return []
}

communityRouter.get('/announcements', requireAuth, validate(announcementQuerySchema, 'query'), async (req, res) => {
  const auth = req.auth!
  const query = req.query as unknown as z.infer<typeof announcementQuerySchema>
  const now = new Date()
  let where: Record<string, unknown> = {
    publishedAt: { lte: now },
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { body: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.audience ? { audience: query.audience } : {}),
    ...(query.courseId ? { courseId: query.courseId } : {}),
  }
  if (auth.role !== 'ADMIN' && auth.role !== 'MANAGER') {
    const roles = announcementAudiences(auth.role)
    let courseIds: string[] = []
    if (auth.role === 'STUDENT') {
      const courses = await prisma.courseEnrollment.findMany({ where: { studentId: auth.userId, status: 'ACTIVE' }, select: { courseId: true } })
      courseIds = courses.map((item) => item.courseId)
    } else if (auth.role === 'PARENT') {
      const links = await prisma.parentStudentLink.findMany({
        where: { parent: { userId: auth.userId }, verifiedAt: { not: null } },
        select: { student: { select: { user: { select: { enrollments: { select: { courseId: true } } } } } } },
      })
      courseIds = [...new Set(links.flatMap((item) => item.student.user.enrollments.map((enrollment) => enrollment.courseId)))]
    } else if (auth.role === 'TEACHER') {
      // Наставник видит объявления курсов, которые ведёт.
      const courses = await prisma.course.findMany({ where: { teacherId: auth.userId }, select: { id: true } })
      courseIds = courses.map((course) => course.id)
    }
    where = {
      ...where,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            { audience: { in: ['ALL', ...roles] as never } },
            ...(courseIds.length ? [{ audience: 'COURSE' as const, courseId: { in: courseIds } }] : []),
          ],
        },
      ],
    }
  }
  const items = await prisma.announcement.findMany({
    where: where as never,
    orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
    include: { createdBy: { select: { firstName: true, lastName: true } }, course: { select: { id: true, title: true } } },
  })
  res.json({ items })
})

communityRouter.post('/announcements', requireAuth, validate(announcementSchema), async (req, res) => {
  const auth = req.auth!
  if (auth.role !== 'ADMIN' && auth.role !== 'MANAGER') throw forbidden('Объявления публикует администратор или менеджер')
  if (req.body.audience === 'COURSE' && !req.body.courseId) throw badRequest('Для аудитории курса укажите курс')
  const announcement = await prisma.announcement.create({
    data: {
      title: req.body.title,
      body: req.body.body,
      audience: req.body.audience,
      courseId: req.body.courseId ?? null,
      attachments: (req.body.attachments as never) ?? undefined,
      isPinned: req.body.isPinned,
      publishedAt: req.body.publishedAt ? new Date(req.body.publishedAt) : new Date(),
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      createdById: auth.userId,
    },
    include: { createdBy: { select: { firstName: true, lastName: true } }, course: { select: { id: true, title: true } } },
  })
  let recipients: string[] = []
  if (req.body.audience === 'COURSE' && req.body.courseId) {
    const audience = await courseAudience(req.body.courseId)
    recipients = [audience.teacherId, ...audience.learnerIds, ...audience.parentIds]
  } else {
    const roles = req.body.audience === 'ALL' ? undefined : req.body.audience === 'STUDENTS' ? ['STUDENT'] : req.body.audience === 'PARENTS' ? ['PARENT'] : req.body.audience === 'TEACHERS' ? ['TEACHER'] : ['MANAGER']
    const users = await prisma.user.findMany({ where: { role: roles ? { in: roles as never } : undefined, isActive: true, deletedAt: null }, select: { id: true } })
    recipients = users.map((user) => user.id)
  }
  await notifyUsers(recipients.filter((id) => id !== auth.userId), {
    type: 'ANNOUNCEMENT',
    title: req.body.title,
    body: req.body.body.slice(0, 300),
    data: { kind: 'announcement', announcementId: announcement.id },
    email: { subject: `ITadis: ${req.body.title}`, text: req.body.body },
  })
  res.status(201).json(announcement)
})

// ---------------------------------------------------------- события и конкурсы

async function assertEventAccess(eventId: string, user: { userId: string; role: string }) {
  const event = await prisma.communityEvent.findUnique({
    where: { id: eventId },
    include: { course: { select: { id: true, teacherId: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } } },
  })
  if (!event) throw notFound('Мероприятие не найдено')
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return event
  if (event.status === 'DRAFT') throw forbidden('Мероприятие ещё не опубликовано')
  if (event.visibility === 'PUBLIC') return event
  if (user.role === 'TEACHER' && event.course?.teacherId === user.userId) return event
  if (event.course?.enrollments.some((item) => item.studentId === user.userId)) return event
  if (user.role === 'PARENT') {
    const linked = await prisma.parentStudentLink.findFirst({
      where: { parent: { userId: user.userId }, verifiedAt: { not: null }, student: { user: { enrollments: { some: { courseId: event.courseId ?? undefined } } } } },
      select: { id: true },
    })
    if (linked) return event
  }
  if (event.visibility === 'BRANCH') return event
  throw forbidden('Мероприятие доступно только участникам курса')
}

async function eventRanking(eventId: string, publishedOnly: boolean) {
  const [results, participants] = await Promise.all([
    prisma.eventResult.findMany({
      where: { eventId, ...(publishedOnly ? { publishedAt: { not: null } } : {}) },
      select: { userId: true, score: true, place: true, taskId: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.eventRegistration.findMany({
      where: { eventId, status: 'REGISTERED' },
      select: { userId: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { registeredAt: 'asc' },
    }),
  ])
  return rankEventParticipants(participants, results)
}

communityRouter.get('/events', requireAuth, validate(eventQuerySchema, 'query'), async (req, res) => {
  const auth = req.auth!
  const query = req.query as unknown as z.infer<typeof eventQuerySchema>
  const statuses = auth.role === 'ADMIN' || auth.role === 'MANAGER'
    ? undefined
    : (['PUBLISHED', 'REGISTRATION', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const)
  let courseIds: string[] = []
  if (auth.role === 'TEACHER') {
    const courses = await prisma.course.findMany({ where: { teacherId: auth.userId }, select: { id: true } })
    courseIds = courses.map((course) => course.id)
  } else if (auth.role === 'STUDENT') {
    const courses = await prisma.courseEnrollment.findMany({ where: { studentId: auth.userId, status: 'ACTIVE' }, select: { courseId: true } })
    courseIds = courses.map((course) => course.courseId)
  } else if (auth.role === 'PARENT') {
    const links = await prisma.parentStudentLink.findMany({
      where: { parent: { userId: auth.userId }, verifiedAt: { not: null } },
      select: { student: { select: { user: { select: { enrollments: { select: { courseId: true } } } } } } },
    })
    courseIds = [...new Set(links.flatMap((link) => link.student.user.enrollments.map((enrollment) => enrollment.courseId)))]
  }
  const accessFilter = auth.role === 'ADMIN' || auth.role === 'MANAGER'
    ? {}
    : { OR: [
        { visibility: 'PUBLIC' as const },
        { visibility: 'BRANCH' as const },
        ...(courseIds.length ? [{ visibility: 'COURSE' as const, courseId: { in: courseIds } }] : []),
      ] }
  // Роль не может запросить скрытый статус (например, черновик) через query.
  const requestedStatus =
    query.status && (!statuses || statuses.some((status) => status === query.status)) ? query.status : undefined
  const history = requestedStatus === 'COMPLETED' || requestedStatus === 'CANCELLED'
  const defaultStatuses = statuses
    ? statuses.filter((status) => status !== 'COMPLETED' && status !== 'CANCELLED')
    : (['PUBLISHED', 'REGISTRATION', 'ONGOING'] as const)
  const where: Prisma.CommunityEventWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(requestedStatus ? { status: requestedStatus } : { status: { in: [...defaultStatuses] } }),
    ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}),
    AND: [accessFilter],
  }
  const [events, total] = await Promise.all([
    prisma.communityEvent.findMany({
      where,
      orderBy: { startsAt: history ? 'desc' : 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        course: { select: { id: true, title: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        registrations: { select: { userId: true, status: true } },
        _count: { select: { registrations: true, tasks: true } },
      },
    }),
    prisma.communityEvent.count({ where }),
  ])
  const items = events.map((event) => ({
    ...event,
    registered: event.registrations.some((registration) => registration.userId === auth.userId && registration.status !== 'CANCELLED'),
  }))
  res.json({
    items,
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(total / query.limit)),
  })
})

communityRouter.get('/events/:id', requireAuth, async (req, res) => {
  const event = await assertEventAccess(String(req.params.id), req.auth!)
  const staff = ['ADMIN', 'MANAGER', 'TEACHER'].includes(req.auth!.role)
  const [participants, tasks, awards, ranking, results] = await Promise.all([
    prisma.eventRegistration.findMany({
      where: { eventId: event.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { registeredAt: 'asc' },
    }),
    prisma.eventTask.findMany({ where: { eventId: event.id }, orderBy: { position: 'asc' } }),
    prisma.eventAward.findMany({ where: { eventId: event.id }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { place: 'asc' } }),
    eventRanking(event.id, !staff),
    prisma.eventResult.findMany({
      where: { eventId: event.id, ...(staff ? {} : { publishedAt: { not: null } }) },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  res.json({ ...event, participants, tasks, awards, ranking, results, registered: participants.some((item) => item.userId === req.auth!.userId && item.status !== 'CANCELLED') })
})

communityRouter.post('/events', requireAuth, validate(eventCreateSchema), async (req, res) => {
  if (!['ADMIN', 'MANAGER'].includes(req.auth!.role)) throw forbidden('Мероприятие создаёт администратор или менеджер')
  const startsAt = new Date(req.body.startsAt)
  const endsAt = new Date(req.body.endsAt)
  if (startsAt >= endsAt) throw badRequest('Дата окончания должна быть позже начала')
  if (req.body.visibility === 'COURSE' && !req.body.courseId) throw badRequest('Для мероприятия курса укажите курс')
  const event = await prisma.communityEvent.create({
    data: {
      type: req.body.type,
      title: req.body.title,
      description: req.body.description,
      rules: req.body.rules ?? null,
      startsAt,
      endsAt,
      registrationDeadline: req.body.registrationDeadline ? new Date(req.body.registrationDeadline) : null,
      location: req.body.location ?? null,
      onlineUrl: req.body.onlineUrl ?? null,
      capacity: req.body.capacity ?? null,
      visibility: req.body.visibility,
      courseId: req.body.courseId ?? null,
      createdById: req.auth!.userId,
    },
  })
  await writeAudit({ actorId: req.auth!.userId, action: 'community.event.created', entity: 'CommunityEvent', entityId: event.id })
  res.status(201).json(event)
})

communityRouter.patch('/events/:id', requireAuth, validate(eventUpdateSchema), async (req, res) => {
  const event = await prisma.communityEvent.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } })
  if (!event) throw notFound('Мероприятие не найдено')
  if (!['ADMIN', 'MANAGER'].includes(req.auth!.role)) throw forbidden('Мероприятие меняет администратор или менеджер')
  const updated = await prisma.communityEvent.update({
    where: { id: event.id },
    data: {
      ...(req.body.status ? { status: req.body.status } : {}),
      ...(req.body.title ? { title: req.body.title } : {}),
      ...(req.body.description ? { description: req.body.description } : {}),
      ...(req.body.rules !== undefined ? { rules: req.body.rules } : {}),
      ...(req.body.startsAt ? { startsAt: new Date(req.body.startsAt) } : {}),
      ...(req.body.endsAt ? { endsAt: new Date(req.body.endsAt) } : {}),
      ...(req.body.registrationDeadline ? { registrationDeadline: new Date(req.body.registrationDeadline) } : {}),
      ...(req.body.location !== undefined ? { location: req.body.location } : {}),
      ...(req.body.onlineUrl !== undefined ? { onlineUrl: req.body.onlineUrl } : {}),
      ...(req.body.capacity !== undefined ? { capacity: req.body.capacity } : {}),
      ...(req.body.visibility ? { visibility: req.body.visibility } : {}),
    },
  })
  if (req.body.status === 'PUBLISHED' || req.body.status === 'REGISTRATION') {
    const users = await prisma.user.findMany({ where: { role: 'STUDENT', isActive: true, deletedAt: null }, select: { id: true } })
    await notifyUsers(users.map((user) => user.id), {
      type: 'EVENT',
      title: `Новое мероприятие: ${updated.title}`,
      body: updated.description.slice(0, 240),
      data: { kind: 'community_event', eventId: updated.id },
    })
  }
  if (req.body.status === 'CANCELLED' && event.status !== 'CANCELLED') {
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId: event.id, status: { in: ['REGISTERED', 'WAITLIST'] } },
      select: { userId: true },
    })
    if (registrations.length > 0) {
      await notifyUsers(registrations.map((item) => item.userId), {
        type: 'EVENT_CANCELLED',
        title: `Мероприятие отменено: ${updated.title}`,
        body: `«${updated.title}» отменено. Регистрация закрыта.`,
        data: { kind: 'community_event_cancelled', eventId: updated.id },
      })
    }
  }
  res.json(updated)
})

communityRouter.post('/events/:id/register', requireAuth, async (req, res) => {
  const event = await assertEventAccess(String(req.params.id), req.auth!)
  if (!['STUDENT', 'PARENT'].includes(req.auth!.role)) throw forbidden('Регистрация доступна ученикам и родителям')
  if (!['PUBLISHED', 'REGISTRATION'].includes(event.status)) throw badRequest('Регистрация закрыта')
  if (event.registrationDeadline && event.registrationDeadline < new Date()) throw badRequest('Срок регистрации истёк')
  const current = await prisma.eventRegistration.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: req.auth!.userId } },
    select: { status: true },
  })
  const registered = await prisma.eventRegistration.count({ where: { eventId: event.id, status: 'REGISTERED' } })
  // Повторная регистрация уже подтверждённого участника не должна отправлять его в лист ожидания.
  const status =
    current?.status === 'REGISTERED'
      ? 'REGISTERED'
      : event.capacity && registered >= event.capacity
        ? 'WAITLIST'
        : 'REGISTERED'
  const registration = await prisma.$transaction(async (tx) => {
    const saved = await tx.eventRegistration.upsert({
      where: { eventId_userId: { eventId: event.id, userId: req.auth!.userId } },
      create: { eventId: event.id, userId: req.auth!.userId, status },
      update: { status },
    })
    // Участие ученика в мероприятии даёт фиксированную награду один раз.
    if (status === 'REGISTERED' && req.auth!.role === 'STUDENT') {
      await awardCoins(tx, {
        userId: req.auth!.userId,
        amount: COIN_RULES.eventParticipation,
        reason: `Участие в мероприятии: ${event.title}`,
        sourceType: 'EVENT',
        sourceId: event.id,
      })
    }
    return saved
  })
  if (status === 'REGISTERED' && req.auth!.role === 'STUDENT') {
    void evaluateAchievements(req.auth!.userId).catch((error) => console.warn('[achievements]', error))
  }
  res.status(201).json(registration)
})

communityRouter.delete('/events/:id/register', requireAuth, async (req, res) => {
  const event = await assertEventAccess(String(req.params.id), req.auth!)
  await prisma.eventRegistration.updateMany({
    where: { eventId: event.id, userId: req.auth!.userId },
    data: { status: 'CANCELLED' },
  })
  res.json({ ok: true })
})

communityRouter.post('/events/:id/tasks', requireAuth, validate(eventTaskSchema), async (req, res) => {
  if (!['ADMIN', 'MANAGER'].includes(req.auth!.role)) throw forbidden('Задания мероприятия создаёт администратор или менеджер')
  const event = await prisma.communityEvent.findUnique({ where: { id: String(req.params.id) }, select: { id: true } })
  if (!event) throw notFound('Мероприятие не найдено')
  const task = await prisma.eventTask.create({
    data: {
      eventId: event.id,
      title: req.body.title,
      description: req.body.description ?? null,
      dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
      maxScore: req.body.maxScore ?? null,
      position: req.body.position,
    },
  })
  res.status(201).json(task)
})

communityRouter.post('/events/:id/results', requireAuth, validate(eventResultSchema), async (req, res) => {
  if (!['ADMIN', 'MANAGER', 'TEACHER'].includes(req.auth!.role)) throw forbidden('Результаты вносит администратор, менеджер или наставник')
  // Наставник вносит результаты только в доступные ему мероприятия.
  const event = await assertEventAccess(String(req.params.id), req.auth!)
  if (!event) throw notFound('Мероприятие не найдено')

  const registration = await prisma.eventRegistration.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: req.body.userId } },
    select: { status: true },
  })
  if (!registration || registration.status === 'CANCELLED') {
    throw badRequest('Сначала зарегистрируйте участника в мероприятии')
  }
  if (req.body.taskId) {
    const task = await prisma.eventTask.findFirst({
      where: { id: req.body.taskId, eventId: event.id },
      select: { id: true },
    })
    if (!task) throw badRequest('Задание не относится к этому мероприятию')
  }

  const existing = await prisma.eventResult.findFirst({
    where: { eventId: event.id, userId: req.body.userId, taskId: req.body.taskId ?? null },
  })
  const data = {
    score: req.body.score ?? null,
    place: req.body.place ?? null,
    comment: req.body.comment ?? null,
    publishedAt: req.body.publish ? (existing?.publishedAt ?? new Date()) : null,
    createdById: req.auth!.userId,
  }
  const result = existing
    ? await prisma.eventResult.update({ where: { id: existing.id }, data })
    : await prisma.eventResult.create({ data: { ...data, eventId: event.id, userId: req.body.userId, taskId: req.body.taskId ?? null } })
  if (req.body.publish) {
    const placeReward = eventPlaceCoinReward(req.body.place)
    if (placeReward > 0) {
      await prisma.$transaction((tx) => awardCoins(tx, {
        userId: req.body.userId,
        amount: placeReward,
        reason: `Призовое место в мероприятии: ${event.title}`,
        sourceType: 'EVENT',
        sourceId: `event-prize:${event.id}:${req.body.userId}`,
        awardedById: req.auth!.userId,
      }))
    }
    void evaluateAchievements(req.body.userId).catch((error) => console.warn('[achievements]', error))
    await notifyUsers([req.body.userId], {
      type: 'CONTEST',
      title: 'Опубликован результат мероприятия',
      body: req.body.place ? `Ваше место: ${req.body.place}` : `Ваш результат: ${req.body.score ?? '—'}`,
      data: { kind: 'event_result', eventId: event.id },
    })
  }
  res.status(201).json(result)
})

communityRouter.get('/events/:id/ranking', requireAuth, async (req, res) => {
  const event = await assertEventAccess(String(req.params.id), req.auth!)
  const ranking = await eventRanking(event.id, !['ADMIN', 'MANAGER', 'TEACHER'].includes(req.auth!.role))
  res.json({ eventId: event.id, title: event.title, type: event.type, items: ranking, note: 'Рейтинг относится только к участникам этого мероприятия.' })
})

communityRouter.post('/events/:id/awards', requireAuth, validate(eventAwardSchema), async (req, res) => {
  if (!['ADMIN', 'MANAGER'].includes(req.auth!.role)) throw forbidden('Награды выдаёт администратор или менеджер')
  const event = await prisma.communityEvent.findUnique({ where: { id: String(req.params.id) }, select: { id: true } })
  if (!event) throw notFound('Мероприятие не найдено')
  if (req.body.userId) {
    const registration = await prisma.eventRegistration.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.body.userId } },
      select: { status: true },
    })
    if (!registration || registration.status === 'CANCELLED') {
      throw badRequest('Награду можно выдать только зарегистрированному участнику')
    }
  }
  const award = await prisma.eventAward.create({
    data: {
      eventId: event.id,
      userId: req.body.userId ?? null,
      title: req.body.title,
      description: req.body.description ?? null,
      place: req.body.place ?? null,
      createdById: req.auth!.userId,
    },
  })
  if (req.body.userId) {
    await notifyUsers([req.body.userId], {
      type: 'CONTEST',
      title: `Награда: ${req.body.title}`,
      body: req.body.description ?? 'Награда мероприятия',
      data: { kind: 'event_award', eventId: event.id, awardId: award.id },
    })
  }
  res.status(201).json(award)
})
