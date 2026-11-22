import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName, type SubmissionStatus } from '@prisma/client'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, homeworkCoinReward } from '../../lib/coins.js'
import { notifyUsers } from '../../lib/notify.js'
import { evaluateAchievements } from '../achievements/evaluate.js'
import { homeworkSubmissionAvailability } from '../../lib/homework-rules.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { AiCenterService } from '../ai-center/ai-center.service.js'
import type { z } from 'zod'
import type { homeworkCreateSchema, homeworkReviewSchema, homeworkSubmitSchema, homeworkUpdateSchema } from '../../modules/assessment/assessment.schemas.js'
import { aiJson } from '../assessment/ai.service.js'

type HomeworkCreate = z.infer<typeof homeworkCreateSchema>
type HomeworkUpdate = z.infer<typeof homeworkUpdateSchema>
type HomeworkSubmit = z.infer<typeof homeworkSubmitSchema>
type HomeworkReviewInput = z.infer<typeof homeworkReviewSchema>

type ManageCourse = { id: string; teacherId: string; title: string }

function studentName(student: { firstName: string; lastName: string }) {
  return `${student.firstName} ${student.lastName}`.trim()
}

/**
 * Домашние задания: создание, адресная выдача, версии отправок, проверка и AI-предпроверка.
 * Академический балл и IT Coins не смешиваются: здесь только баллы задания.
 */
@Injectable()
export class HomeworkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiCenterService) private readonly ai: AiCenterService,
  ) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  private async courseForManage(courseId: string, userId: string, role: RoleName): Promise<ManageCourse> {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true, title: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (!this.isManager(role) && course.teacherId !== userId) {
      const author = await this.prisma.client.course.findFirst({
        where: { id: courseId, authorId: userId },
        select: { id: true },
      })
      if (!author) throw forbidden('Курс принадлежит другому наставнику')
    }
    return course
  }

  private async homeworkForManage(homeworkId: string, userId: string, role: RoleName) {
    const homework = await this.prisma.client.homework.findUnique({
      where: { id: homeworkId },
      include: {
        course: { select: { id: true, title: true, teacherId: true } },
        lesson: { select: { id: true, title: true } },
        targets: { select: { studentId: true } },
        gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
      },
    })
    if (!homework) throw notFound('Задание не найдено')
    if (!this.isManager(role) && homework.teacherId !== userId && homework.course.teacherId !== userId) {
      throw forbidden('Задание принадлежит другому наставнику')
    }
    return homework
  }

  private async notify(
    userId: string,
    type: 'HOMEWORK_ASSIGNED' | 'HOMEWORK_REVIEWED' | 'GRADE_RECEIVED',
    title: string,
    body: string,
    data: Prisma.InputJsonValue,
  ) {
    await notifyUsers([userId], { type, title, body, data: data as Record<string, unknown> })
      .catch((error) => console.warn('[homework] уведомление не создано', error))
  }

  private async event(
    homeworkId: string,
    actorId: string,
    type: string,
    message?: string,
    data?: Prisma.InputJsonValue,
  ) {
    await this.prisma.client.assessmentEvent
      .create({
        data: { entityType: 'HOMEWORK', entityId: homeworkId, actorId, type, message: message ?? null, data: data ?? Prisma.JsonNull },
      })
      .catch((error) => console.warn('[homework] событие не записано', error))
  }

  private async enrolled(courseId: string, studentId: string) {
    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
      select: { id: true },
    })
    if (!enrollment) throw forbidden('Нет доступа к курсу: нет записи')
  }

  private async ensureTarget(homeworkId: string, studentId: string, assignAll: boolean) {
    if (assignAll) return
    const target = await this.prisma.client.homeworkTarget.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId } },
      select: { id: true },
    })
    if (!target) throw forbidden('Задание не выдано этому ученику')
  }

  /** Нельзя выдать задание пользователю, который не записан на курс. */
  private async assertEnrolledStudents(courseId: string, studentIds: string[]) {
    const unique = [...new Set(studentIds)]
    if (unique.length === 0) throw badRequest('Выберите хотя бы одного ученика')
    const enrolled = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId, studentId: { in: unique } },
      select: { studentId: true },
    })
    if (enrolled.length !== unique.length) {
      throw badRequest('Некоторые ученики не записаны на этот курс')
    }
    return unique
  }

  async list(userId: string, role: RoleName) {
    const where: Prisma.HomeworkWhereInput =
      role === 'STUDENT'
        ? {
            AND: [
              { course: { enrollments: { some: { studentId: userId } } } },
              { OR: [{ assignAll: true }, { targets: { some: { studentId: userId } } }] },
            ],
          }
        : role === 'TEACHER'
          ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] }
          : {}

    const items = await this.prisma.client.homework.findMany({
      where,
      orderBy: { dueAt: 'desc' },
      take: 200,
      include: {
        course: { select: { id: true, title: true } },
        lesson: { select: { id: true, title: true } },
        _count: { select: { submissions: true, targets: true } },
        submissions:
          role === 'STUDENT'
            ? { where: { studentId: userId }, orderBy: { attempt: 'desc' }, take: 1, include: { review: true } }
            : false,
      },
    })

    return {
      items: items.map((homework) => {
        const mine = (
          'submissions' in homework ? homework.submissions?.[0] : undefined
        ) as Prisma.HomeworkSubmissionGetPayload<{ include: { review: true } }> | undefined
        return {
          id: homework.id,
          title: homework.title,
          description: homework.description,
          dueAt: homework.dueAt,
          maxScore: homework.maxScore,
          maxAttempts: homework.maxAttempts,
          allowResubmit: homework.allowResubmit,
          allowLate: homework.allowLate,
          latePenalty: homework.latePenalty,
          assignAll: homework.assignAll,
          course: homework.course,
          lesson: homework.lesson,
          submissions: homework._count.submissions,
          targets: homework._count.targets,
          overdue: homework.dueAt.getTime() < Date.now(),
          mySubmission: mine
            ? {
                id: mine.id,
                attempt: mine.attempt,
                status: mine.status,
                score: mine.score,
                submittedAt: mine.submittedAt,
                review: mine.review
                  ? {
                      score: mine.review.score,
                      comment: mine.review.comment,
                      returnForRevision: mine.review.returnForRevision,
                      createdAt: mine.review.createdAt,
                    }
                  : null,
              }
            : null,
        }
      }),
    }
  }

  async detail(homeworkId: string, userId: string, role: RoleName) {
    const homework = await this.prisma.client.homework.findUnique({
      where: { id: homeworkId },
      include: {
        course: { select: { id: true, title: true, teacherId: true } },
        lesson: { select: { id: true, title: true } },
        teacher: { select: { id: true, firstName: true, lastName: true } },
        gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
        targets: { include: { student: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
    })
    if (!homework) throw notFound('Задание не найдено')

    const base = {
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
      course: homework.course,
      lesson: homework.lesson,
      teacher: { id: homework.teacher.id, name: studentName(homework.teacher) },
      gradingScale: homework.gradingScale
        ? { id: homework.gradingScale.id, name: homework.gradingScale.name, bands: homework.gradingScale.bands }
        : null,
      targets: homework.targets.map((target) => ({
        id: target.student.id,
        name: studentName(target.student),
        email: target.student.email,
      })),
    }

    if (role === 'STUDENT') {
      await this.enrolled(homework.courseId, userId)
      await this.ensureTarget(homework.id, userId, homework.assignAll)
      const submissions = await this.prisma.client.homeworkSubmission.findMany({
        where: { homeworkId, studentId: userId },
        orderBy: { attempt: 'asc' },
        include: { review: true },
      })
      const availability = homeworkSubmissionAvailability(homework, submissions)
      return {
        ...base,
        // Ученик не должен видеть адресный список других учеников и их почту.
        targets: homework.targets
          .filter((target) => target.studentId === userId)
          .map((target) => ({ id: target.student.id, name: studentName(target.student), email: target.student.email })),
        mySubmissions: submissions.map((submission) => this.mapSubmission(submission)),
        attemptsUsed: availability.attemptsUsed,
        attemptsLeft: availability.attemptsLeft,
        canSubmit: availability.canSubmit,
        submitBlockedReason: availability.reason,
        latestStatus: availability.latestStatus,
        late: availability.late,
      }
    }

    await this.homeworkForManage(homeworkId, userId, role)
    const [submissions, enrollments] = await Promise.all([
      this.prisma.client.homeworkSubmission.findMany({
        where: { homeworkId },
        orderBy: [{ submittedAt: 'desc' }],
        include: {
          student: { select: { id: true, firstName: true, lastName: true, email: true } },
          review: true,
        },
      }),
      this.prisma.client.courseEnrollment.findMany({
        where: { courseId: homework.courseId },
        select: { student: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
    ])

    const byStudent = new Map<string, typeof submissions>()
    for (const submission of submissions) {
      const list = byStudent.get(submission.studentId) ?? []
      list.push(submission)
      byStudent.set(submission.studentId, list)
    }

    const students = enrollments
      .filter((enrollment) => homework.assignAll || homework.targets.some((target) => target.studentId === enrollment.student.id))
      .map((enrollment) => {
        const versions = (byStudent.get(enrollment.student.id) ?? []).slice().sort((a, b) => a.attempt - b.attempt)
        const latest = versions[versions.length - 1]
        return {
          id: enrollment.student.id,
          name: studentName(enrollment.student),
          email: enrollment.student.email,
          versions: versions.length,
          status: latest?.status ?? 'NOT_SUBMITTED',
          score: latest?.score ?? null,
          submittedAt: latest?.submittedAt ?? null,
          latestSubmissionId: latest?.id ?? null,
        }
      })

    return {
      ...base,
      submissions: submissions.map((submission) => ({
        ...this.mapSubmission(submission),
        student: {
          id: submission.student.id,
          name: studentName(submission.student),
          email: submission.student.email,
        },
      })),
      students,
      stats: {
        assigned: students.length,
        submitted: students.filter((student) => student.status !== 'NOT_SUBMITTED').length,
        reviewed: students.filter((student) => student.status === 'REVIEWED').length,
        returned: students.filter((student) => student.status === 'RETURNED').length,
        pending: students.filter((student) => student.status === 'SUBMITTED').length,
      },
    }
  }

  private mapSubmission(submission: {
    id: string
    attempt: number
    text: string | null
    projectUrl: string | null
    files: Prisma.JsonValue
    comments: Prisma.JsonValue
    status: SubmissionStatus
    submittedAt: Date
    reviewedAt: Date | null
    score: number | null
    aiFeedback: Prisma.JsonValue
    aiReviewedAt: Date | null
    review: {
      id: string
      score: number
      comment: string | null
      returnForRevision: boolean
      criteriaScores: Prisma.JsonValue
      aiFeedback: Prisma.JsonValue
      createdAt: Date
    } | null
  }) {
    return {
      id: submission.id,
      attempt: submission.attempt,
      text: submission.text,
      projectUrl: submission.projectUrl,
      files: submission.files,
      comments: submission.comments,
      status: submission.status,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
      score: submission.score,
      aiFeedback: submission.aiFeedback,
      aiReviewedAt: submission.aiReviewedAt,
      review: submission.review
        ? {
            id: submission.review.id,
            score: submission.review.score,
            comment: submission.review.comment,
            returnForRevision: submission.review.returnForRevision,
            criteriaScores: submission.review.criteriaScores,
            aiFeedback: submission.review.aiFeedback,
            createdAt: submission.review.createdAt,
          }
        : null,
    }
  }

  async create(input: HomeworkCreate, userId: string, role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') {
      throw forbidden('Создавать задания может администратор, менеджер или наставник')
    }
    const course = await this.courseForManage(input.courseId, userId, role)
    if (input.dueAt.getTime() < Date.now()) throw badRequest('Срок задания должен быть в будущем')
    if (input.lessonId) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: input.lessonId, module: { courseId: course.id } },
        select: { id: true },
      })
      if (!lesson) throw badRequest('Урок относится к другому курсу')
    }

    const studentIds = input.assignAll ? [] : await this.assertEnrolledStudents(course.id, input.studentIds ?? [])

    const homework = await this.prisma.client.homework.create({
      data: {
        courseId: course.id,
        lessonId: input.lessonId ?? null,
        teacherId: userId,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        maxScore: input.maxScore,
        materials: (input.materials ?? []) as unknown as Prisma.InputJsonValue,
        criteria: (input.criteria ?? []) as unknown as Prisma.InputJsonValue,
        maxAttempts: input.maxAttempts,
        allowLate: input.allowLate,
        latePenalty: input.latePenalty,
        allowResubmit: input.allowResubmit,
        assignAll: input.assignAll,
        gradingScaleId: input.gradingScaleId ?? null,
        targets: studentIds.length > 0 ? { createMany: { data: studentIds.map((studentId) => ({ studentId })) } } : undefined,
      },
      select: { id: true, title: true, dueAt: true },
    })

    const recipients = input.assignAll
      ? await this.prisma.client.courseEnrollment.findMany({ where: { courseId: course.id }, select: { studentId: true } })
      : studentIds.map((studentId) => ({ studentId }))

    await Promise.all(
      recipients.map((recipient) =>
        this.notify(
          recipient.studentId,
          'HOMEWORK_ASSIGNED',
          'Новое домашнее задание',
          `«${homework.title}» по курсу «${course.title}», срок ${homework.dueAt.toLocaleString('ru-RU')}`,
          { kind: 'homework', homeworkId: homework.id },
        ),
      ),
    )

    await writeAudit({ actorId: userId, action: 'homework.create', entity: 'Homework', entityId: homework.id })
    await this.event(homework.id, userId, 'CREATED', `Задание создано: ${homework.title}`, {
      courseId: course.id,
      lessonId: input.lessonId ?? null,
      dueAt: input.dueAt.toISOString(),
      maxScore: input.maxScore,
      maxAttempts: input.maxAttempts,
      allowLate: input.allowLate,
      allowResubmit: input.allowResubmit,
      assignAll: input.assignAll,
      targetStudentIds: studentIds,
      materials: input.materials?.length ?? 0,
      criteria: input.criteria?.length ?? 0,
    })
    return homework
  }

  async update(homeworkId: string, input: HomeworkUpdate, userId: string, role: RoleName) {
    const homework = await this.homeworkForManage(homeworkId, userId, role)
    const studentIds = input.studentIds
    const assignAll = input.assignAll ?? homework.assignAll

    if (input.dueAt && input.dueAt.getTime() < Date.now()) {
      throw badRequest('Новый срок задания должен быть в будущем')
    }
    if (!assignAll) {
      if (studentIds !== undefined) {
        await this.assertEnrolledStudents(homework.courseId, studentIds)
      } else if (homework.targets.length === 0) {
        throw badRequest('Выберите хотя бы одного ученика')
      }
    }

    const before = {
      title: homework.title,
      description: homework.description,
      dueAt: homework.dueAt.toISOString(),
      maxScore: homework.maxScore,
      materials: homework.materials,
      criteria: homework.criteria,
      maxAttempts: homework.maxAttempts,
      allowLate: homework.allowLate,
      latePenalty: homework.latePenalty,
      allowResubmit: homework.allowResubmit,
      assignAll: homework.assignAll,
      lessonId: homework.lessonId,
      gradingScaleId: homework.gradingScaleId,
      studentIds: homework.targets.map((target) => target.studentId).sort(),
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.homework.update({
        where: { id: homeworkId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.maxScore !== undefined ? { maxScore: input.maxScore } : {}),
          ...(input.materials !== undefined ? { materials: input.materials as unknown as Prisma.InputJsonValue } : {}),
          ...(input.criteria !== undefined ? { criteria: input.criteria as unknown as Prisma.InputJsonValue } : {}),
          ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
          ...(input.allowLate !== undefined ? { allowLate: input.allowLate } : {}),
          ...(input.latePenalty !== undefined ? { latePenalty: input.latePenalty } : {}),
          ...(input.allowResubmit !== undefined ? { allowResubmit: input.allowResubmit } : {}),
          ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
          ...(input.gradingScaleId !== undefined ? { gradingScaleId: input.gradingScaleId } : {}),
          assignAll,
        },
      })

      if (studentIds !== undefined || input.assignAll === true) {
        await tx.homeworkTarget.deleteMany({ where: { homeworkId } })
        if (!assignAll && studentIds && studentIds.length > 0) {
          await tx.homeworkTarget.createMany({
            data: studentIds.map((studentId) => ({ homeworkId, studentId })),
            skipDuplicates: true,
          })
        }
      }
    })

    const after = {
      ...before,
      ...input,
      dueAt: input.dueAt?.toISOString() ?? before.dueAt,
      materials: input.materials ?? before.materials,
      criteria: input.criteria ?? before.criteria,
      lessonId: input.lessonId !== undefined ? input.lessonId : before.lessonId,
      gradingScaleId: input.gradingScaleId !== undefined ? input.gradingScaleId : before.gradingScaleId,
      studentIds: assignAll ? [] : (studentIds ?? before.studentIds).slice().sort(),
    }
    const labels: Record<string, string> = {
      title: 'название',
      description: 'описание',
      dueAt: 'срок',
      maxScore: 'максимальный балл',
      materials: 'материалы',
      criteria: 'критерии',
      maxAttempts: 'лимит версий',
      allowLate: 'приём после срока',
      latePenalty: 'штраф за просрочку',
      allowResubmit: 'повторная сдача',
      assignAll: 'выдача всей группе',
      studentIds: 'список учеников',
      lessonId: 'привязка к уроку',
      gradingScaleId: 'шкала оценивания',
    }
    const changed = Object.keys(input).filter((key) => {
      const typed = key as keyof typeof input
      return JSON.stringify(input[typed]) !== JSON.stringify(before[key as keyof typeof before])
    })
    await this.event(
      homeworkId,
      userId,
      'UPDATED',
      changed.length > 0
        ? `Изменены: ${changed.map((key) => labels[key] ?? key).join(', ')}`
        : 'Настройки сохранены без изменений',
      { changed, before, after },
    )
    await writeAudit({ actorId: userId, action: 'homework.update', entity: 'Homework', entityId: homeworkId })
    return this.homeworkForManage(homeworkId, userId, role)
  }

  async submit(homeworkId: string, userId: string, input: HomeworkSubmit) {
    const homework = await this.prisma.client.homework.findUnique({
      where: { id: homeworkId },
      include: { course: { select: { id: true, title: true, teacherId: true } } },
    })
    if (!homework) throw notFound('Задание не найдено')
    await this.enrolled(homework.courseId, userId)
    await this.ensureTarget(homework.id, userId, homework.assignAll)

    // Идемпотентность проверяем до правил версий: повтор сетевого запроса должен
    // вернуть уже созданную работу, а не упираться в лимит или статус проверки.
    if (input.idempotencyKey) {
      const existing = await this.prisma.client.homeworkSubmission.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, attempt: true, status: true, studentId: true, homeworkId: true },
      })
      if (existing) {
        if (existing.studentId !== userId || existing.homeworkId !== homeworkId) {
          throw badRequest('Ключ идемпотентности уже использован для другой работы')
        }
        return { id: existing.id, attempt: existing.attempt, status: existing.status, repeated: true }
      }
    }

    const submissions = await this.prisma.client.homeworkSubmission.findMany({
      where: { homeworkId, studentId: userId },
      orderBy: { attempt: 'asc' },
      select: { attempt: true, status: true },
    })
    const availability = homeworkSubmissionAvailability(homework, submissions)
    if (!availability.canSubmit) {
      throw badRequest(availability.reason ?? 'Отправка новой версии недоступна')
    }

    const now = new Date()
    const late = availability.late
    const nextAttempt = (submissions[submissions.length - 1]?.attempt ?? 0) + 1

    const comments = input.comment
      ? ([{ author: 'STUDENT', text: input.comment, at: now.toISOString() }] as unknown as Prisma.InputJsonValue)
      : undefined

    const submission = await this.prisma.client.homeworkSubmission.create({
      data: {
        homeworkId,
        studentId: userId,
        attempt: nextAttempt,
        text: input.text ?? null,
        projectUrl: input.projectUrl ?? null,
        files: (input.files ?? []) as unknown as Prisma.InputJsonValue,
        comments,
        status: 'SUBMITTED',
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true, attempt: true, status: true, submittedAt: true },
    })

    await this.notify(
      homework.teacherId,
      'HOMEWORK_ASSIGNED',
      'Новая работа на проверку',
      `Версия ${submission.attempt} по заданию «${homework.title}»`,
      { kind: 'homework_submission', homeworkId, submissionId: submission.id },
    )
    await this.event(homeworkId, userId, 'SUBMITTED', `Версия ${submission.attempt} отправлена${late ? ' (после срока)' : ''}`, {
      submissionId: submission.id,
      attempt: submission.attempt,
      late,
      files: input.files?.length ?? 0,
      hasText: Boolean(input.text?.trim()),
      hasLink: Boolean(input.projectUrl),
      comment: input.comment ?? null,
    })
    await writeAudit({ actorId: userId, action: 'homework.submit', entity: 'HomeworkSubmission', entityId: submission.id })
    await this.ai.triggerEvent('PENDING_REVIEW', {
      homeworkId,
      submissionId: submission.id,
      studentId: userId,
      courseId: homework.courseId,
      role: 'TEACHER',
    }).catch((error) => console.warn('[homework] AI-автоматизация не запущена', error))
    return { ...submission, late }
  }

  async review(submissionId: string, userId: string, role: RoleName, input: HomeworkReviewInput) {
    const submission = await this.prisma.client.homeworkSubmission.findUnique({
      where: { id: submissionId },
      include: {
        homework: { include: { course: { select: { id: true, title: true, teacherId: true } } } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    if (!submission) throw notFound('Работа не найдена')
    await this.homeworkForManage(submission.homeworkId, userId, role)
    if (input.score > submission.homework.maxScore) {
      throw badRequest(`Балл не может превышать ${submission.homework.maxScore}`)
    }
    if (input.returnForRevision && !input.comment?.trim()) {
      throw badRequest('Опишите, что нужно исправить')
    }

    const late = submission.submittedAt.getTime() > submission.homework.dueAt.getTime()
    const penalty = late ? submission.homework.latePenalty : 0
    const finalScore = Math.max(0, Math.round(input.score * (1 - penalty / 100)))
    const status: SubmissionStatus = input.returnForRevision ? 'RETURNED' : 'REVIEWED'

    const review = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.homeworkReview.upsert({
        where: { submissionId },
        create: {
          submissionId,
          reviewerId: userId,
          score: finalScore,
          comment: input.comment ?? null,
          returnForRevision: input.returnForRevision,
          criteriaScores: (input.criteriaScores ?? []) as unknown as Prisma.InputJsonValue,
        },
        update: {
          reviewerId: userId,
          score: finalScore,
          comment: input.comment ?? null,
          returnForRevision: input.returnForRevision,
          criteriaScores: (input.criteriaScores ?? []) as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.homeworkSubmission.update({
        where: { id: submissionId },
        data: { status, score: finalScore, reviewedAt: new Date(), reviewerId: userId },
      })
      // IT Coins начисляются только за принятую работу; sourceId — задание,
      // поэтому повторная проверка и повторная сдача не создают вторую награду.
      if (status === 'REVIEWED') {
        await awardCoins(tx, {
          userId: submission.studentId,
          amount: homeworkCoinReward(finalScore, submission.homework.maxScore),
          reason: `Домашняя работа: ${submission.homework.title}`,
          sourceType: 'HOMEWORK',
          sourceId: submission.homeworkId,
          awardedById: userId,
        })
      }
      return saved
    })

    await this.notify(
      submission.studentId,
      input.returnForRevision ? 'HOMEWORK_REVIEWED' : 'GRADE_RECEIVED',
      input.returnForRevision ? 'Работа возвращена на доработку' : 'Работа проверена',
      input.returnForRevision
        ? `«${submission.homework.title}»: ${input.comment ?? 'исправьте замечания преподавателя'}`
        : `«${submission.homework.title}»: ${finalScore} из ${submission.homework.maxScore}${penalty ? ` (штраф за просрочку ${penalty}%)` : ''}`,
      { kind: 'homework_review', homeworkId: submission.homeworkId, submissionId },
    )
    await this.event(submission.homeworkId, userId, status === 'RETURNED' ? 'RETURNED' : 'REVIEWED', input.comment, {
      submissionId,
      attempt: submission.attempt,
      score: finalScore,
      rawScore: input.score,
      penalty,
      late,
      criteriaScores: input.criteriaScores ?? [],
    })
    await writeAudit({ actorId: userId, action: 'homework.review', entity: 'HomeworkReview', entityId: review.id })
    if (status === 'REVIEWED') {
      await evaluateAchievements(submission.studentId).catch((error) => console.warn('[achievements]', error))
    }

    return {
      id: review.id,
      score: finalScore,
      rawScore: input.score,
      penalty,
      status,
      comment: review.comment,
      student: `${submission.student.firstName} ${submission.student.lastName}`,
      maxScore: submission.homework.maxScore,
    }
  }

  async aiReview(submissionId: string, userId: string, role: RoleName, instructions?: string) {
    const submission = await this.prisma.client.homeworkSubmission.findUnique({
      where: { id: submissionId },
      include: {
        homework: { include: { course: { select: { title: true, teacherId: true } } } },
        student: { select: { firstName: true, lastName: true } },
      },
    })
    if (!submission) throw notFound('Работа не найдена')
    await this.homeworkForManage(submission.homeworkId, userId, role)

    const files = Array.isArray(submission.files)
      ? (submission.files as Array<{ name?: string }>).map((file) => file.name ?? 'файл').join(', ')
      : 'нет'

    const system = [
      'Ты — ассистент преподавателя образовательной платформы ITadis.',
      'Проверь домашнюю работу ученика и верни ТОЛЬКО JSON без пояснений.',
      'Формат: {"scoreSuggestion": число, "summary": строка, "strengths": [строки],',
      '"improvements": [строки], "criteria": [{"title": строка, "score": число, "comment": строка}],',
      '"risks": [строки], "confidence": число от 0 до 100}.',
      'Оценка предварительная: окончательное решение принимает преподаватель. Не выдумывай факты о работе.',
    ].join('\n')

    const user = [
      `Курс: ${submission.homework.course.title}`,
      `Задание: ${submission.homework.title}`,
      `Максимальный балл: ${submission.homework.maxScore}`,
      `Описание: ${submission.homework.description}`,
      `Критерии: ${JSON.stringify(submission.homework.criteria ?? [])}`,
      `Текст ученика: ${submission.text ?? '(нет текста)'}`,
      `Ссылка: ${submission.projectUrl ?? '(нет)'}`,
      `Файлы: ${files}`,
      instructions ? `Дополнительные указания преподавателя: ${instructions}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const suggestion = await aiJson<{
      scoreSuggestion?: number
      summary?: string
      strengths?: string[]
      improvements?: string[]
      criteria?: Array<{ title?: string; score?: number; comment?: string }>
      risks?: string[]
      confidence?: number
    }>(system, user)

    const score = Math.max(0, Math.min(submission.homework.maxScore, Math.round(Number(suggestion.scoreSuggestion) || 0)))
    const result = {
      scoreSuggestion: score,
      maxScore: submission.homework.maxScore,
      summary: suggestion.summary ?? '',
      strengths: Array.isArray(suggestion.strengths) ? suggestion.strengths.slice(0, 10) : [],
      improvements: Array.isArray(suggestion.improvements) ? suggestion.improvements.slice(0, 10) : [],
      criteria: Array.isArray(suggestion.criteria) ? suggestion.criteria.slice(0, 20) : [],
      risks: Array.isArray(suggestion.risks) ? suggestion.risks.slice(0, 10) : [],
      confidence: Math.max(0, Math.min(100, Math.round(Number(suggestion.confidence) || 0))),
      disclaimer: 'Предварительная проверка AI. Итоговый балл выставляет преподаватель.',
    }

    await this.prisma.client.homeworkSubmission.update({
      where: { id: submissionId },
      data: {
        aiFeedback: result as unknown as Prisma.InputJsonValue,
        aiReviewedAt: new Date(),
      },
    })
    await this.event(submission.homeworkId, userId, 'AI_REVIEW', 'Предварительная проверка AI', {
      submissionId,
      score: result.scoreSuggestion,
      confidence: result.confidence,
      summary: result.summary,
      disclaimer: result.disclaimer,
    })
    return result
  }

  async history(entityId: string, userId: string, role: RoleName) {
    let homeworkId = entityId

    if (role === 'STUDENT') {
      const homework = await this.prisma.client.homework.findUnique({
        where: { id: entityId },
        select: { id: true, courseId: true, assignAll: true },
      })
      if (homework) {
        await this.enrolled(homework.courseId, userId)
        await this.ensureTarget(homework.id, userId, homework.assignAll)
        homeworkId = homework.id
      } else {
        const submission = await this.prisma.client.homeworkSubmission.findFirst({
          where: { id: entityId, studentId: userId },
          select: { homeworkId: true },
        })
        if (!submission) throw notFound('Задание не найдено')
        homeworkId = submission.homeworkId
      }
    } else {
      const homework = await this.prisma.client.homework.findUnique({
        where: { id: entityId },
        select: { id: true },
      })
      if (homework) {
        await this.homeworkForManage(homework.id, userId, role)
      } else {
        const submission = await this.prisma.client.homeworkSubmission.findUnique({
          where: { id: entityId },
          select: { homeworkId: true },
        })
        if (!submission) throw notFound('Задание не найдено')
        await this.homeworkForManage(submission.homeworkId, userId, role)
        homeworkId = submission.homeworkId
      }
    }

    const events = await this.prisma.client.assessmentEvent.findMany({
      where: {
        entityType: 'HOMEWORK',
        entityId: homeworkId,
        // Предварительная AI-проверка — рабочий инструмент преподавателя, не оценка ученика.
        ...(role === 'STUDENT' ? { type: { not: 'AI_REVIEW' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { actor: { select: { firstName: true, lastName: true } } },
    })
    return {
      items: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        // Служебные данные содержат адресные списки и суммы; ученику они не нужны.
        data: role === 'STUDENT' ? null : event.data,
        createdAt: event.createdAt,
        actor: event.actor ? studentName(event.actor) : 'Система',
      })),
    }
  }
}
