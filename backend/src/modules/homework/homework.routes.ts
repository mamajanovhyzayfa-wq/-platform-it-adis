import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'

export const homeworkRouter = Router()

const submitSchema = z
  .object({
    text: z.string().trim().max(20000).optional(),
    projectUrl: z.string().url().max(2048).optional(),
    files: z.array(z.object({ name: z.string().trim().min(1).max(255), url: z.string().url() })).max(10).optional(),
    idempotencyKey: z.string().min(8).max(120),
  })
  .refine(
    (data) => Boolean(data.text?.trim() || data.projectUrl || (data.files && data.files.length > 0)),
    { message: 'Добавьте текст решения, ссылку на проект или файлы', path: ['text'] },
  )

homeworkRouter.get('/', requireAuth, async (req, res) => {
  const auth = req.auth!

  const where =
    auth.role === 'TEACHER'
      ? { teacherId: auth.userId }
      : auth.role === 'ADMIN'
        ? {}
        : { course: { enrollments: { some: { studentId: auth.userId } } } }

  const items = await prisma.homework.findMany({
    where,
    include: {
      course: { select: { id: true, title: true } },
      submissions: auth.role === 'STUDENT' ? { where: { studentId: auth.userId }, orderBy: { attempt: 'desc' }, take: 1 } : false,
    },
    orderBy: { dueAt: 'asc' },
    take: 100,
  })

  res.json({
    items: items.map((item) => {
      const submission = 'submissions' in item ? item.submissions?.[0] : undefined
      return {
        id: item.id,
        title: item.title,
        description: item.description,
        dueAt: item.dueAt,
        maxScore: item.maxScore,
        allowResubmit: item.allowResubmit,
        course: item.course,
        submission: submission
          ? { id: submission.id, status: submission.status, score: submission.score, submittedAt: submission.submittedAt }
          : null,
      }
    }),
  })
})

homeworkRouter.get('/:id', requireAuth, async (req, res) => {
  const homework = await prisma.homework.findUnique({
    where: { id: String(req.params.id) },
    include: { course: { select: { id: true, title: true } } },
  })
  if (!homework) throw notFound('Задание не найдено')

  const auth = req.auth!
  if (auth.role === 'STUDENT') {
    const enrolled = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: homework.courseId, studentId: auth.userId } },
    })
    if (!enrolled) throw notFound('Задание не найдено')
  }

  const submission = await prisma.homeworkSubmission.findFirst({
    where: { homeworkId: homework.id, studentId: auth.userId },
    include: { review: true },
    orderBy: { attempt: 'desc' },
  })

  res.json({ ...homework, mySubmission: submission })
})

homeworkRouter.post('/:id/submit', requireAuth, validate(submitSchema), async (req, res) => {
  const auth = req.auth!
  if (auth.role !== 'STUDENT') throw badRequest('Отправлять решения может только ученик')

  const homework = await prisma.homework.findUnique({ where: { id: String(req.params.id) } })
  if (!homework) throw notFound('Задание не найдено')

  const enrolled = await prisma.courseEnrollment.findUnique({
    where: { courseId_studentId: { courseId: homework.courseId, studentId: auth.userId } },
  })
  if (!enrolled) throw notFound('Задание не найдено')

  // Идемпотентность: повторный запрос с тем же ключом вернёт уже созданную работу.
  const existing = await prisma.homeworkSubmission.findUnique({ where: { idempotencyKey: req.body.idempotencyKey } })
  if (existing) {
    res.status(200).json({ id: existing.id, status: existing.status, repeated: true })
    return
  }

  const previous = await prisma.homeworkSubmission.count({ where: { homeworkId: homework.id, studentId: auth.userId } })
  const latest = await prisma.homeworkSubmission.findFirst({
    where: { homeworkId: homework.id, studentId: auth.userId },
    orderBy: { attempt: 'desc' },
    select: { status: true },
  })

  // Работа, возвращённая преподавателем, всегда принимается повторно — это и есть доработка.
  const revisionRequested = latest?.status === 'RETURNED'
  if (!revisionRequested) {
    if (Date.now() > homework.dueAt.getTime() && !homework.allowResubmit) {
      throw badRequest('Срок сдачи задания истёк')
    }
    if (previous > 0 && !homework.allowResubmit) throw badRequest('Работа уже отправлена')
  }

  const submission = await prisma.homeworkSubmission.create({
    data: {
      homeworkId: homework.id,
      studentId: auth.userId,
      attempt: previous + 1,
      text: req.body.text,
      projectUrl: req.body.projectUrl,
      files: req.body.files as never,
      idempotencyKey: req.body.idempotencyKey,
    },
  })

  await writeAudit({
    actorId: auth.userId,
    action: 'homework.submitted',
    entity: 'homework_submission',
    entityId: submission.id,
    metadata: { homeworkId: homework.id },
  })

  res.status(201).json({ id: submission.id, status: submission.status, attempt: submission.attempt })
})
