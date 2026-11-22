import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { z } from 'zod'
import type { examCreateSchema, examUpdateSchema } from '../../modules/assessment/assessment.schemas.js'
import { TestingService } from '../tests/testing.service.js'

type ExamCreate = z.infer<typeof examCreateSchema>
type ExamUpdate = z.infer<typeof examUpdateSchema>

/** Экзамены: расписание, регистрация, попытки, результаты и уведомления. */
@Injectable()
export class ExamService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TestingService) private readonly testing: TestingService,
  ) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  private async event(examId: string, actorId: string, type: string, message?: string, data?: Prisma.InputJsonValue) {
    await this.prisma.client.assessmentEvent
      .create({
        data: { entityType: 'EXAM', entityId: examId, actorId, type, message: message ?? null, data: data ?? Prisma.JsonNull },
      })
      .catch((error) => console.warn('[exam] событие не записано', error))
  }

  async list(userId: string, role: RoleName) {
    const where: Prisma.ExamWhereInput =
      role === 'STUDENT'
        ? {
            isPublished: true,
            OR: [{ courseId: null }, { course: { enrollments: { some: { studentId: userId } } } }],
          }
        : role === 'TEACHER'
          ? { OR: [{ createdById: userId }, { course: { teacherId: userId } }] }
          : {}

    const exams = await this.prisma.client.exam.findMany({
      where,
      orderBy: { startsAt: 'desc' },
      take: 200,
      include: {
        course: { select: { id: true, title: true } },
        test: { select: { id: true, title: true, timeLimitMinutes: true, passingScore: true, _count: { select: { questions: true } } } },
        _count: { select: { registrations: true, attempts: true } },
        registrations: role === 'STUDENT' ? { where: { studentId: userId }, select: { status: true, registeredAt: true } } : false,
        attempts:
          role === 'STUDENT'
            ? {
                where: { studentId: userId },
                orderBy: { startedAt: 'desc' },
                select: {
                  id: true,
                  status: true,
                  score: true,
                  maxScore: true,
                  percent: true,
                  needsManualReview: true,
                  startedAt: true,
                  submittedAt: true,
                },
              }
            : false,
      },
    })

    const now = Date.now()
    return {
      items: exams.map((exam) => {
        const registration = 'registrations' in exam ? exam.registrations?.[0] : undefined
        const attempts = 'attempts' in exam ? exam.attempts ?? [] : []
        return {
          id: exam.id,
          title: exam.title,
          description: exam.description,
          course: exam.course,
          test: { id: exam.test.id, title: exam.test.title, questions: exam.test._count.questions },
          startsAt: exam.startsAt,
          endsAt: exam.endsAt,
          durationMinutes: exam.durationMinutes,
          maxAttempts: exam.maxAttempts,
          passingScore: exam.passingScore,
          isPublished: exam.isPublished,
          allowLateRegistration: exam.allowLateRegistration,
          registrationOpen:
            exam.isPublished &&
            now < exam.endsAt.getTime() &&
            (now < exam.startsAt.getTime() || exam.allowLateRegistration),
          phase: now < exam.startsAt.getTime() ? 'UPCOMING' : now > exam.endsAt.getTime() ? 'FINISHED' : 'ACTIVE',
          registrations: exam._count.registrations,
          attempts: exam._count.attempts,
          myRegistration: registration?.status ?? null,
          myAttempts: attempts.length,
          myBestPercent: attempts.reduce((best, attempt) => Math.max(best, attempt.percent ?? 0), 0),
          hasActiveAttempt: attempts.some((attempt) => attempt.status === 'IN_PROGRESS'),
          myAttemptHistory: attempts,
        }
      }),
    }
  }

  async detail(examId: string, userId: string, role: RoleName) {
    const exam = await this.prisma.client.exam.findUnique({
      where: { id: examId },
      include: {
        course: { select: { id: true, title: true, teacherId: true } },
        test: {
          select: {
            id: true,
            title: true,
            timeLimitMinutes: true,
            passingScore: true,
            _count: { select: { questions: true } },
            questions: { orderBy: { position: 'asc' }, select: { id: true, prompt: true, topic: true, points: true } },
          },
        },
        gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
        registrations: {
          orderBy: { registeredAt: 'asc' },
          include: { student: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
        attempts: {
          orderBy: { startedAt: 'desc' },
          include: {
            student: { select: { id: true, firstName: true, lastName: true, email: true } },
            answers: { select: { questionId: true, isCorrect: true, pointsAwarded: true } },
          },
        },
      },
    })
    if (!exam) throw notFound('Экзамен не найден')

    const manager =
      this.isManager(role) ||
      (role === 'TEACHER' && (exam.createdById === userId || exam.course?.teacherId === userId))
    if (!manager && role !== 'STUDENT') throw forbidden('Экзамен создан другим сотрудником')
    if (!manager && role === 'STUDENT' && !exam.isPublished) throw notFound('Экзамен не найден')
    if (role === 'STUDENT' && exam.courseId) {
      const enrolled = await this.prisma.client.courseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: exam.courseId, studentId: userId } },
        select: { id: true },
      })
      if (!enrolled) throw forbidden('Экзамен доступен ученикам курса')
    }

    const myRegistration = exam.registrations.find((registration) => registration.student.id === userId)
    const now = Date.now()

    const finishedAttempts = exam.attempts.filter((attempt) => attempt.status !== 'IN_PROGRESS')
    const analysisQuestions = exam.test.questions.map((question) => {
      const answers = finishedAttempts
        .map((attempt) => attempt.answers.find((answer) => answer.questionId === question.id))
        .filter((answer): answer is NonNullable<typeof answer> => Boolean(answer))
      const correct = answers.filter((answer) => answer.isCorrect).length
      const answered = answers.filter((answer) => answer.isCorrect !== null).length
      return {
        id: question.id,
        prompt: question.prompt,
        topic: question.topic?.trim() || 'Без темы',
        points: question.points,
        attempts: finishedAttempts.length,
        answered,
        correct,
        percent: answered === 0 ? 0 : Math.round((correct / answered) * 100),
      }
    })
    const topicMap = new Map<string, { topic: string; correct: number; total: number }>()
    for (const question of analysisQuestions) {
      const current = topicMap.get(question.topic) ?? { topic: question.topic, correct: 0, total: 0 }
      current.correct += question.correct
      current.total += question.answered
      topicMap.set(question.topic, current)
    }
    const analysis = {
      questions: [...analysisQuestions].sort((a, b) => a.percent - b.percent),
      topics: [...topicMap.values()]
        .map((topic) => ({ ...topic, percent: topic.total === 0 ? 0 : Math.round((topic.correct / topic.total) * 100) }))
        .sort((a, b) => a.percent - b.percent),
      attempts: finishedAttempts.length,
    }

    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      instructions: exam.instructions,
      course: exam.course,
      test: { id: exam.test.id, title: exam.test.title, timeLimitMinutes: exam.test.timeLimitMinutes, passingScore: exam.test.passingScore, questions: exam.test._count.questions },
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      durationMinutes: exam.durationMinutes,
      maxAttempts: exam.maxAttempts,
      passingScore: exam.passingScore,
      allowLateRegistration: exam.allowLateRegistration,
      isPublished: exam.isPublished,
      phase: now < exam.startsAt.getTime() ? 'UPCOMING' : now > exam.endsAt.getTime() ? 'FINISHED' : 'ACTIVE',
      gradingScale: exam.gradingScale,
      analysis: manager ? analysis : undefined,
      myRegistration: myRegistration ? { status: myRegistration.status, registeredAt: myRegistration.registeredAt } : null,
      registrationOpen:
        exam.isPublished &&
        now < exam.endsAt.getTime() &&
        (now < exam.startsAt.getTime() || exam.allowLateRegistration),
      myAttempts: exam.attempts
        .filter((attempt) => attempt.student.id === userId)
        .map((attempt) => ({
          id: attempt.id,
          status: attempt.status,
          score: attempt.score,
          maxScore: attempt.maxScore,
          percent: attempt.percent,
          needsManualReview: attempt.needsManualReview,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt,
        })),
      registrations: manager
        ? exam.registrations.map((registration) => ({
            id: registration.id,
            student: {
              id: registration.student.id,
              name: `${registration.student.firstName} ${registration.student.lastName}`.trim(),
              email: registration.student.email,
            },
            status: registration.status,
            registeredAt: registration.registeredAt,
          }))
        : undefined,
      results: manager
        ? exam.attempts.map((attempt) => ({
            id: attempt.id,
            student: {
              id: attempt.student.id,
              name: `${attempt.student.firstName} ${attempt.student.lastName}`.trim(),
              email: attempt.student.email,
            },
            status: attempt.status,
            score: attempt.score,
            maxScore: attempt.maxScore,
            percent: attempt.percent,
            needsManualReview: attempt.needsManualReview,
            submittedAt: attempt.submittedAt,
            passed: attempt.percent !== null ? attempt.percent >= exam.passingScore : null,
          }))
        : undefined,
    }
  }

  async create(input: ExamCreate, userId: string, role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') throw forbidden('Экзамены создают сотрудники филиала')
    if (input.endsAt.getTime() <= input.startsAt.getTime()) throw badRequest('Окончание должно быть позже начала')

    const test = await this.prisma.client.test.findUnique({
      where: { id: input.testId },
      select: {
        id: true,
        title: true,
        teacherId: true,
        courseId: true,
        course: { select: { teacherId: true } },
        _count: { select: { questions: true } },
      },
    })
    if (!test) throw notFound('Тест не найден')
    if (!this.isManager(role) && test.teacherId !== userId && test.course.teacherId !== userId) {
      throw forbidden('Тест принадлежит другому наставнику')
    }
    if (test._count.questions === 0) throw badRequest('В тесте нет вопросов')
    if (input.courseId && input.courseId !== test.courseId) throw badRequest('Тест относится к другому курсу')

    const exam = await this.prisma.client.exam.create({
      data: {
        testId: test.id,
        courseId: input.courseId ?? test.courseId,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        durationMinutes: input.durationMinutes,
        maxAttempts: input.maxAttempts,
        passingScore: input.passingScore,
        allowLateRegistration: input.allowLateRegistration,
        gradingScaleId: input.gradingScaleId ?? null,
        createdById: userId,
      },
      select: { id: true, title: true },
    })
    await this.event(exam.id, userId, 'CREATED', `Экзамен создан: ${exam.title}`)
    await writeAudit({ actorId: userId, action: 'exam.create', entity: 'Exam', entityId: exam.id })
    return exam
  }

  async update(examId: string, input: ExamUpdate, userId: string, role: RoleName) {
    const exam = await this.prisma.client.exam.findUnique({
      where: { id: examId },
      select: {
        createdById: true,
        courseId: true,
        testId: true,
        startsAt: true,
        endsAt: true,
        test: { select: { courseId: true } },
        course: { select: { teacherId: true } },
      },
    })
    if (!exam) throw notFound('Экзамен не найден')
    if (!this.isManager(role) && exam.createdById !== userId && exam.course?.teacherId !== userId) {
      throw forbidden('Экзамен создан другим сотрудником')
    }
    if (input.testId && input.testId !== exam.testId) throw badRequest('Нельзя заменить тест после создания экзамена')
    if (input.courseId !== undefined && input.courseId !== exam.test.courseId) {
      throw badRequest('Экзамен должен относиться к курсу теста')
    }

    const startsAt = input.startsAt ?? exam.startsAt
    const endsAt = input.endsAt ?? exam.endsAt
    if (endsAt <= startsAt) throw badRequest('Окончание должно быть позже начала')

    const updated = await this.prisma.client.exam.update({
      where: { id: examId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
        ...(input.allowLateRegistration !== undefined ? { allowLateRegistration: input.allowLateRegistration } : {}),
        ...(input.gradingScaleId !== undefined ? { gradingScaleId: input.gradingScaleId } : {}),
        ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
      },
    })
    await this.event(examId, userId, 'UPDATED', 'Настройки экзамена обновлены')
    return updated
  }

  async publish(examId: string, userId: string, role: RoleName, published: boolean) {
    const exam = await this.prisma.client.exam.findUnique({
      where: { id: examId },
      select: {
        createdById: true,
        courseId: true,
        title: true,
        startsAt: true,
        test: { select: { _count: { select: { questions: true } } } },
        course: { select: { teacherId: true } },
      },
    })
    if (!exam) throw notFound('Экзамен не найден')
    if (!this.isManager(role) && exam.createdById !== userId && exam.course?.teacherId !== userId) {
      throw forbidden('Экзамен создан другим сотрудником')
    }
    if (published && exam.test._count.questions === 0) throw badRequest('В тесте экзамена нет вопросов')

    const saved = await this.prisma.client.exam.update({
      where: { id: examId },
      data: { isPublished: published },
      select: { id: true, isPublished: true },
    })

    if (published) {
      const recipients = exam.courseId
        ? await this.prisma.client.courseEnrollment.findMany({ where: { courseId: exam.courseId }, select: { studentId: true } })
        : await this.prisma.client.user.findMany({ where: { role: 'STUDENT', isActive: true, deletedAt: null }, select: { id: true } })
      await notifyUsers(
        recipients.map((recipient) => ('studentId' in recipient ? recipient.studentId : recipient.id)),
        {
          type: 'EXAM_PUBLISHED',
          title: 'Назначен экзамен',
          body: `«${exam.title}» начнётся ${exam.startsAt.toLocaleString('ru-RU')}. Зарегистрируйтесь заранее.`,
          data: { kind: 'exam', examId },
        },
      )
    }

    await this.event(examId, userId, published ? 'PUBLISHED' : 'UNPUBLISHED', published ? 'Экзамен опубликован' : 'Экзамен снят с публикации')
    return saved
  }

  async register(examId: string, userId: string) {
    const exam = await this.prisma.client.exam.findUnique({
      where: { id: examId },
      select: { isPublished: true, startsAt: true, endsAt: true, allowLateRegistration: true, courseId: true, title: true },
    })
    if (!exam || !exam.isPublished) throw notFound('Экзамен не найден')
    if (Date.now() > exam.endsAt.getTime()) throw badRequest('Экзамен завершён')
    if (Date.now() > exam.startsAt.getTime() && !exam.allowLateRegistration) {
      throw badRequest('Регистрация закрыта: экзамен уже начался')
    }
    if (exam.courseId) {
      const enrolled = await this.prisma.client.courseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: exam.courseId, studentId: userId } },
        select: { id: true },
      })
      if (!enrolled) throw forbidden('Экзамен доступен ученикам курса')
    }

    const registration = await this.prisma.client.examRegistration.upsert({
      where: { examId_studentId: { examId, studentId: userId } },
      create: { examId, studentId: userId, status: 'REGISTERED' },
      update: { status: 'REGISTERED' },
    })
    await notifyUsers([userId], {
      type: 'EXAM_REGISTERED',
      title: 'Регистрация на экзамен',
      body: `Вы записаны на «${exam.title}»`,
      data: { kind: 'exam', examId },
    }).catch(() => undefined)
    await this.event(examId, userId, 'REGISTERED', 'Ученик зарегистрирован')
    return { status: registration.status, registeredAt: registration.registeredAt }
  }

  async cancelRegistration(examId: string, userId: string) {
    const exam = await this.prisma.client.exam.findUnique({ where: { id: examId }, select: { startsAt: true } })
    if (!exam) throw notFound('Экзамен не найден')
    if (Date.now() > exam.startsAt.getTime()) throw badRequest('После начала экзамена отмена невозможна')
    await this.prisma.client.examRegistration.updateMany({
      where: { examId, studentId: userId },
      data: { status: 'CANCELLED' },
    })
    await this.event(examId, userId, 'REGISTRATION_CANCELLED', 'Регистрация отменена')
    return { status: 'CANCELLED' }
  }

  async start(examId: string, userId: string) {
    const exam = await this.prisma.client.exam.findUnique({ where: { id: examId }, select: { testId: true } })
    if (!exam) throw notFound('Экзамен не найден')
    return this.testing.start(exam.testId, userId, examId)
  }

  async results(examId: string, userId: string, role: RoleName) {
    const detail = await this.detail(examId, userId, role)
    return { items: detail.results ?? [] }
  }
}
