import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { homeworkSubmissionAvailability } from '../../lib/homework-rules.js'

export const homeworkRouter = Router()

const fileUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => /^(https?:\/\/|\/)/i.test(value), 'Нужна http(s)-ссылка или путь от корня')

const submitSchema = z
  .object({
    text: z.string().trim().max(20000).optional(),
    projectUrl: fileUrl.optional(),
    files: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(255),
          url: fileUrl,
          type: z.string().trim().max(120).optional(),
          size: z.number().int().min(0).max(200_000_000).optional(),
        }),
      )
      .max(20)
      .optional(),
    comment: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .refine(
    (data) => Boolean(data.text?.trim() || data.projectUrl || (data.files && data.files.length > 0)),
    { message: 'Добавьте текст решения, ссылку на проект или файлы', path: ['text'] },
  )

const isStaff = (role: string) => role === 'ADMIN' || role === 'MANAGER' || role === 'TEACHER'

/** Список заданий: ученик видит только выданные ему задания доступных курсов. */
homeworkRouter.get('/', requireAuth, async (req, res) => {
  const auth = req.auth!
  if (!isStaff(auth.role) && auth.role !== 'STUDENT') throw forbidden('Задания доступны ученикам и сотрудникам')

  const where =
    auth.role === 'STUDENT'
      ? {
          AND: [
            { course: { enrollments: { some: { studentId: auth.userId } } } },
            { OR: [{ assignAll: true }, { targets: { some: { studentId: auth.userId } } }] },
          ],
        }
      : auth.role === 'TEACHER'
        ? { OR: [{ teacherId: auth.userId }, { course: { teacherId: auth.userId } }] }
        : {}

  const items = await prisma.homework.findMany({
    where,
    include: {
      course: { select: { id: true, title: true } },
      _count: { select: { submissions: true } },
      submissions:
        auth.role === 'STUDENT'
          ? { where: { studentId: auth.userId }, orderBy: { attempt: 'desc' }, include: { review: true } }
          : false,
    },
    orderBy: { dueAt: 'asc' },
    take: 100,
  })

  res.json({
    items: items.map((item) => {
      const submissions = 'submissions' in item && item.submissions ? item.submissions : []
      const availability = homeworkSubmissionAvailability(item, submissions)
      const latest = submissions[0]
      return {
        id: item.id,
        title: item.title,
        description: item.description,
        dueAt: item.dueAt,
        maxScore: item.maxScore,
        maxAttempts: item.maxAttempts,
        allowResubmit: item.allowResubmit,
        allowLate: item.allowLate,
        latePenalty: item.latePenalty,
        course: item.course,
        submissions: item._count.submissions,
        attemptsUsed: availability.attemptsUsed,
        attemptsLeft: availability.attemptsLeft,
        canSubmit: availability.canSubmit,
        submitBlockedReason: availability.reason,
        submission: latest
          ? { id: latest.id, status: latest.status, score: latest.score, submittedAt: latest.submittedAt }
          : null,
        mySubmission: latest
          ? { id: latest.id, status: latest.status, score: latest.score, submittedAt: latest.submittedAt }
          : null,
      }
    }),
  })
})

/** Детали задания и все версии работы ученика. */
homeworkRouter.get('/:id', requireAuth, async (req, res) => {
  const auth = req.auth!
  if (!isStaff(auth.role) && auth.role !== 'STUDENT') throw forbidden('Задание недоступно')

  const homework = await prisma.homework.findUnique({
    where: { id: String(req.params.id) },
    include: {
      course: { select: { id: true, title: true, teacherId: true } },
      targets: { select: { studentId: true } },
    },
  })
  if (!homework) throw notFound('Задание не найдено')

  if (auth.role === 'STUDENT') {
    const enrolled = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: homework.courseId, studentId: auth.userId } },
      select: { id: true },
    })
    if (!enrolled) throw notFound('Задание не найдено')
    if (!homework.assignAll) {
      const target = homework.targets.some((item) => item.studentId === auth.userId)
      if (!target) throw notFound('Задание не найдено')
    }
  } else if (auth.role === 'TEACHER' && homework.teacherId !== auth.userId && homework.course.teacherId !== auth.userId) {
    throw forbidden('Задание относится к другому преподавателю')
  }

  const submissions = await prisma.homeworkSubmission.findMany({
    where: {
      homeworkId: homework.id,
      ...(auth.role === 'STUDENT' ? { studentId: auth.userId } : {}),
    },
    orderBy: { attempt: 'asc' },
    include: { review: true },
  })
  const availability = homeworkSubmissionAvailability(homework, submissions)
  const latest = submissions[submissions.length - 1]

  res.json({
    id: homework.id,
    title: homework.title,
    description: homework.description,
    dueAt: homework.dueAt,
    maxScore: homework.maxScore,
    materials: homework.materials,
    criteria: homework.criteria,
    maxAttempts: homework.maxAttempts,
    allowResubmit: homework.allowResubmit,
    allowLate: homework.allowLate,
    latePenalty: homework.latePenalty,
    assignAll: homework.assignAll,
    course: { id: homework.course.id, title: homework.course.title },
    lessonId: homework.lessonId,
    mySubmissions: submissions,
    mySubmission: latest ?? null,
    attemptsUsed: availability.attemptsUsed,
    attemptsLeft: availability.attemptsLeft,
    canSubmit: availability.canSubmit,
    submitBlockedReason: availability.reason,
    late: availability.late,
    ...(isStaff(auth.role) ? { submissions } : {}),
  })
})

/** Отправка новой версии. Правила совпадают с веб-кабинетом. */
homeworkRouter.post('/:id/submit', requireAuth, validate(submitSchema), async (req, res) => {
  const auth = req.auth!
  if (auth.role !== 'STUDENT') throw badRequest('Отправлять решения может только ученик')

  const homework = await prisma.homework.findUnique({
    where: { id: String(req.params.id) },
    include: { targets: { select: { studentId: true } } },
  })
  if (!homework) throw notFound('Задание не найдено')

  const enrolled = await prisma.courseEnrollment.findUnique({
    where: { courseId_studentId: { courseId: homework.courseId, studentId: auth.userId } },
    select: { id: true },
  })
  if (!enrolled) throw notFound('Задание не найдено')
  if (!homework.assignAll && !homework.targets.some((item) => item.studentId === auth.userId)) {
    throw forbidden('Задание не выдано этому ученику')
  }

  // Повторная отправка того же запроса возвращает уже созданную версию.
  const existing = await prisma.homeworkSubmission.findUnique({
    where: { idempotencyKey: req.body.idempotencyKey },
    select: { id: true, status: true, attempt: true, studentId: true, homeworkId: true },
  })
  if (existing) {
    if (existing.studentId !== auth.userId || existing.homeworkId !== homework.id) {
      throw badRequest('Ключ идемпотентности уже использован для другой работы')
    }
    res.status(200).json({ id: existing.id, status: existing.status, attempt: existing.attempt, repeated: true })
    return
  }

  const submissions = await prisma.homeworkSubmission.findMany({
    where: { homeworkId: homework.id, studentId: auth.userId },
    orderBy: { attempt: 'asc' },
    select: { attempt: true, status: true },
  })
  const availability = homeworkSubmissionAvailability(homework, submissions)
  if (!availability.canSubmit) throw badRequest(availability.reason ?? 'Отправка новой версии недоступна')

  const now = new Date()
  const attempt = (submissions[submissions.length - 1]?.attempt ?? 0) + 1
  const submission = await prisma.homeworkSubmission.create({
    data: {
      homeworkId: homework.id,
      studentId: auth.userId,
      attempt,
      text: req.body.text ?? null,
      projectUrl: req.body.projectUrl ?? null,
      files: (req.body.files ?? []) as never,
      comments: req.body.comment
        ? ([{ author: 'STUDENT', text: req.body.comment, at: now.toISOString() }] as never)
        : undefined,
      idempotencyKey: req.body.idempotencyKey,
    },
  })

  await notifyUsers([homework.teacherId], {
    type: 'HOMEWORK_REVIEWED',
    title: 'Новая работа на проверку',
    body: `Версия ${attempt} по заданию «${homework.title}»`,
    data: { kind: 'homework_submission', homeworkId: homework.id, submissionId: submission.id },
  }).catch((error) => console.warn('[homework] уведомление не создано', error))

  await prisma.assessmentEvent
    .create({
      data: {
        entityType: 'HOMEWORK',
        entityId: homework.id,
        actorId: auth.userId,
        type: 'SUBMITTED',
        message: `Версия ${attempt} отправлена${availability.late ? ' (после срока)' : ''}`,
        data: {
          submissionId: submission.id,
          attempt,
          late: availability.late,
          files: req.body.files?.length ?? 0,
          hasText: Boolean(req.body.text?.trim()),
          hasLink: Boolean(req.body.projectUrl),
        },
      },
    })
    .catch((error) => console.warn('[homework] событие не записано', error))

  await writeAudit({
    actorId: auth.userId,
    action: 'homework.submitted',
    entity: 'homework_submission',
    entityId: submission.id,
    metadata: { homeworkId: homework.id, attempt, late: availability.late },
  })

  res.status(201).json({
    id: submission.id,
    status: submission.status,
    attempt: submission.attempt,
    late: availability.late,
  })
})
