import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type AttemptStatus, type QuestionType, type RoleName } from '@prisma/client'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, testCoinReward } from '../../lib/coins.js'
import { notifyUsers } from '../../lib/notify.js'
import { evaluateAchievements } from '../achievements/evaluate.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { z } from 'zod'
import type {
  aiGenerateSchema,
  attemptReviewSchema,
  questionSchema,
  testCreateSchema,
  testUpdateSchema,
} from '../../modules/assessment/assessment.schemas.js'
import { aiJson } from '../assessment/ai.service.js'

type TestCreate = z.infer<typeof testCreateSchema>
type TestUpdate = z.infer<typeof testUpdateSchema>
type QuestionInput = z.infer<typeof questionSchema>
type AttemptReview = z.infer<typeof attemptReviewSchema>
type AiGenerate = z.infer<typeof aiGenerateSchema>

type QuestionRow = {
  id: string
  type: QuestionType
  prompt: string
  points: number
  position: number
  matchPairs: Prisma.JsonValue
  correctNumber: number | null
  correctBoolean: boolean | null
  correctText: string | null
  explanation: string | null
  topic: string | null
  timeLimitSeconds: number | null
  options: Array<{ id: string; text: string; isCorrect: boolean; position: number }>
}

const ATTEMPT_GRACE_MS = 60_000

function shuffle<T>(items: T[], seed = 0): T[] {
  const copy = [...items]
  let state = seed || 1
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280
    const swap = Math.floor((state / 233280) * (index + 1))
    const current = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = current
  }
  return copy
}

function seedFrom(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 233280
  return hash || 7
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseDeadlines(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/**
 * Движок тестирования: конструктор, банк вопросов, прохождение с таймерами,
 * автоматическая проверка, ручная проверка текстовых ответов и разбор ошибок.
 */
@Injectable()
export class TestingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  private async testForManage(testId: string, userId: string, role: RoleName) {
    const test = await this.prisma.client.test.findUnique({
      where: { id: testId },
      include: {
        course: { select: { id: true, title: true, teacherId: true } },
        questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
        gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
        _count: { select: { attempts: true } },
      },
    })
    if (!test) throw notFound('Тест не найден')
    if (!this.isManager(role) && test.teacherId !== userId && test.course.teacherId !== userId) {
      throw forbidden('Тест принадлежит другому наставнику')
    }
    return test
  }

  private async testForStudent(testId: string, userId: string) {
    const test = await this.prisma.client.test.findUnique({
      where: { id: testId },
      include: {
        course: { select: { id: true, title: true } },
        questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
        gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
      },
    })
    if (!test || !test.isPublished) throw notFound('Тест не найден')
    const enrolled = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: test.courseId, studentId: userId } },
      select: { id: true },
    })
    if (!enrolled) throw notFound('Тест не найден')
    return test
  }

  async list(userId: string, role: RoleName) {
    const where: Prisma.TestWhereInput =
      role === 'STUDENT'
        ? { isPublished: true, course: { enrollments: { some: { studentId: userId } } } }
        : role === 'TEACHER'
          ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] }
          : {}

    const tests = await this.prisma.client.test.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        course: { select: { id: true, title: true } },
        lesson: { select: { id: true, title: true } },
        _count: { select: { questions: true, attempts: true } },
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

    return {
      items: tests.map((test) => {
        const attempts = 'attempts' in test ? test.attempts ?? [] : []
        const finished = attempts.filter((attempt) => attempt.status !== 'IN_PROGRESS')
        const best = finished.reduce((max, attempt) => Math.max(max, attempt.percent ?? 0), 0)
        return {
          id: test.id,
          title: test.title,
          description: test.description,
          course: test.course,
          lesson: test.lesson,
          timeLimitMinutes: test.timeLimitMinutes,
          questionTimeLimitSeconds: test.questionTimeLimitSeconds,
          passingScore: test.passingScore,
          attemptsAllowed: test.attemptsAllowed,
          questions: test._count.questions,
          submissions: test._count.attempts,
          isPublished: test.isPublished,
          shuffleQuestions: test.shuffleQuestions,
          shuffleOptions: test.shuffleOptions,
          myAttempts: attempts.length,
          bestPercent: best,
          hasActiveAttempt: attempts.some((attempt) => attempt.status === 'IN_PROGRESS'),
          attemptHistory: attempts,
        }
      }),
    }
  }

  async detail(testId: string, userId: string, role: RoleName) {
    if (role === 'STUDENT') {
      const test = await this.testForStudent(testId, userId)
      const attempts = await this.prisma.client.testAttempt.findMany({
        where: { testId, studentId: userId },
        orderBy: { startedAt: 'desc' },
        select: { id: true, status: true, startedAt: true, submittedAt: true, score: true, maxScore: true, percent: true, needsManualReview: true },
      })
      return {
        id: test.id,
        title: test.title,
        description: test.description,
        course: test.course,
        timeLimitMinutes: test.timeLimitMinutes,
        questionTimeLimitSeconds: test.questionTimeLimitSeconds,
        passingScore: test.passingScore,
        attemptsAllowed: test.attemptsAllowed,
        questionsCount: test.questions.length,
        attemptsLeft: Math.max(test.attemptsAllowed - attempts.filter((attempt) => attempt.status !== 'IN_PROGRESS').length, 0),
        attempts,
        gradingScale: test.gradingScale ? { id: test.gradingScale.id, name: test.gradingScale.name, bands: test.gradingScale.bands } : null,
      }
    }

    const test = await this.testForManage(testId, userId, role)
    return {
      id: test.id,
      title: test.title,
      description: test.description,
      course: test.course,
      lesson: test.lessonId,
      teacherId: test.teacherId,
      timeLimitMinutes: test.timeLimitMinutes,
      questionTimeLimitSeconds: test.questionTimeLimitSeconds,
      passingScore: test.passingScore,
      attemptsAllowed: test.attemptsAllowed,
      shuffleQuestions: test.shuffleQuestions,
      shuffleOptions: test.shuffleOptions,
      showExplanations: test.showExplanations,
      showCorrectAnswers: test.showCorrectAnswers,
      gradingScaleId: test.gradingScaleId,
      isPublished: test.isPublished,
      attempts: test._count.attempts,
      questions: test.questions.map((question) => ({
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        points: question.points,
        position: question.position,
        explanation: question.explanation,
        topic: question.topic,
        timeLimitSeconds: question.timeLimitSeconds,
        correctText: question.correctText,
        matchPairs: question.matchPairs,
        correctNumber: question.correctNumber,
        correctBoolean: question.correctBoolean,
        options: question.options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect })),
      })),
    }
  }

  async create(input: TestCreate, userId: string, role: RoleName) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, teacherId: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (!this.isManager(role) && course.teacherId !== userId) throw forbidden('Курс принадлежит другому наставнику')
    if (input.lessonId) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: input.lessonId, module: { courseId: course.id } },
        select: { id: true },
      })
      if (!lesson) throw badRequest('Урок относится к другому курсу')
    }

    const test = await this.prisma.client.test.create({
      data: {
        courseId: course.id,
        lessonId: input.lessonId ?? null,
        teacherId: userId,
        title: input.title,
        description: input.description ?? null,
        timeLimitMinutes: input.timeLimitMinutes,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds ?? null,
        passingScore: input.passingScore,
        attemptsAllowed: input.attemptsAllowed,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
        showExplanations: input.showExplanations,
        showCorrectAnswers: input.showCorrectAnswers,
        gradingScaleId: input.gradingScaleId ?? null,
      },
      select: { id: true, title: true },
    })
    await this.event(test.id, userId, 'CREATED', `Тест создан: ${test.title}`)
    await writeAudit({ actorId: userId, action: 'test.create', entity: 'Test', entityId: test.id })
    return test
  }

  async update(testId: string, input: TestUpdate, userId: string, role: RoleName) {
    await this.testForManage(testId, userId, role)
    if (input.lessonId) {
      const test = await this.prisma.client.test.findUnique({ where: { id: testId }, select: { courseId: true } })
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: input.lessonId, module: { courseId: test?.courseId ?? '' } },
        select: { id: true },
      })
      if (!lesson) throw badRequest('Урок относится к другому курсу')
    }
    const updated = await this.prisma.client.test.update({
      where: { id: testId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
        ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
        ...(input.questionTimeLimitSeconds !== undefined ? { questionTimeLimitSeconds: input.questionTimeLimitSeconds } : {}),
        ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
        ...(input.attemptsAllowed !== undefined ? { attemptsAllowed: input.attemptsAllowed } : {}),
        ...(input.shuffleQuestions !== undefined ? { shuffleQuestions: input.shuffleQuestions } : {}),
        ...(input.shuffleOptions !== undefined ? { shuffleOptions: input.shuffleOptions } : {}),
        ...(input.showExplanations !== undefined ? { showExplanations: input.showExplanations } : {}),
        ...(input.showCorrectAnswers !== undefined ? { showCorrectAnswers: input.showCorrectAnswers } : {}),
        ...(input.gradingScaleId !== undefined ? { gradingScaleId: input.gradingScaleId } : {}),
      },
    })
    await this.event(testId, userId, 'UPDATED', 'Настройки теста обновлены')
    return updated
  }

  async publish(testId: string, userId: string, role: RoleName, published: boolean) {
    const existing = await this.testForManage(testId, userId, role)
    if (published && existing.questions.length === 0) throw badRequest('Добавьте хотя бы один вопрос перед публикацией')
    const test = await this.prisma.client.test.update({
      where: { id: testId },
      data: { isPublished: published },
      select: { id: true, isPublished: true },
    })
    await this.event(testId, userId, published ? 'PUBLISHED' : 'UNPUBLISHED', published ? 'Тест опубликован' : 'Тест снят с публикации')
    if (published) {
      const students = await this.prisma.client.courseEnrollment.findMany({
        where: { courseId: existing.courseId, status: 'ACTIVE' },
        select: { studentId: true },
      })
      if (students.length > 0) {
        await notifyUsers(students.map((item) => item.studentId), {
          type: 'TEST_ASSIGNED',
          title: 'Новый тест',
          body: `«${existing.title}» по курсу «${existing.course.title}»`,
          data: { kind: 'test', testId },
        })
      }
    }
    return test
  }

  async remove(testId: string, userId: string, role: RoleName) {
    await this.testForManage(testId, userId, role)
    await this.prisma.client.test.delete({ where: { id: testId } })
    await writeAudit({ actorId: userId, action: 'test.delete', entity: 'Test', entityId: testId })
  }

  private normalizeQuestionInput(input: QuestionInput) {
    const options = input.options ?? []
    const pairs = input.matchPairs ?? []
    if (input.type === 'SINGLE') {
      if (options.length < 2) throw badRequest('Нужно минимум два варианта ответа')
      if (options.filter((option) => option.isCorrect).length !== 1) throw badRequest('Выберите один правильный вариант')
    }
    if (input.type === 'MULTIPLE') {
      if (options.length < 2) throw badRequest('Нужно минимум два варианта ответа')
      if (!options.some((option) => option.isCorrect)) throw badRequest('Отметьте хотя бы один правильный вариант')
    }
    if (input.type === 'MATCHING' && pairs.length < 2) throw badRequest('Нужно минимум две пары для сопоставления')
    if (input.type === 'NUMBER' && input.correctNumber === undefined) throw badRequest('Укажите правильное число')
    if (input.type === 'BOOLEAN' && input.correctBoolean === undefined) throw badRequest('Укажите правильный ответ да/нет')
    return { options, pairs }
  }

  async addQuestion(testId: string, input: QuestionInput, userId: string, role: RoleName) {
    await this.testForManage(testId, userId, role)
    const { options, pairs } = this.normalizeQuestionInput(input)
    const last = await this.prisma.client.testQuestion.aggregate({ where: { testId }, _max: { position: true } })
    const question = await this.prisma.client.testQuestion.create({
      data: {
        testId,
        type: input.type,
        prompt: input.prompt,
        points: input.points,
        position: (last._max.position ?? -1) + 1,
        explanation: input.explanation ?? null,
        topic: input.topic ?? null,
        timeLimitSeconds: input.timeLimitSeconds ?? null,
        correctText: input.correctText ?? null,
        correctNumber: input.correctNumber ?? null,
        correctBoolean: input.correctBoolean ?? null,
        matchPairs: pairs.length ? (pairs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        options: {
          create: options.map((option, position) => ({ text: option.text, isCorrect: option.isCorrect, position })),
        },
      },
      include: { options: { orderBy: { position: 'asc' } } },
    })
    await this.event(testId, userId, 'QUESTION_ADDED', `Добавлен вопрос: ${input.prompt.slice(0, 80)}`)
    return question
  }

  async updateQuestion(questionId: string, input: QuestionInput, userId: string, role: RoleName) {
    const question = await this.prisma.client.testQuestion.findUnique({
      where: { id: questionId },
      select: { testId: true },
    })
    if (!question) throw notFound('Вопрос не найден')
    await this.testForManage(question.testId, userId, role)
    const { options, pairs } = this.normalizeQuestionInput(input)

    return this.prisma.client.$transaction(async (tx) => {
      await tx.testOption.deleteMany({ where: { questionId } })
      return tx.testQuestion.update({
        where: { id: questionId },
        data: {
          type: input.type,
          prompt: input.prompt,
          points: input.points,
          explanation: input.explanation ?? null,
          topic: input.topic ?? null,
          timeLimitSeconds: input.timeLimitSeconds ?? null,
          correctText: input.correctText ?? null,
          correctNumber: input.correctNumber ?? null,
          correctBoolean: input.correctBoolean ?? null,
          matchPairs: pairs.length ? (pairs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          options: { create: options.map((option, position) => ({ text: option.text, isCorrect: option.isCorrect, position })) },
        },
        include: { options: { orderBy: { position: 'asc' } } },
      })
    })
  }

  async removeQuestion(questionId: string, userId: string, role: RoleName) {
    const question = await this.prisma.client.testQuestion.findUnique({
      where: { id: questionId },
      select: { testId: true },
    })
    if (!question) throw notFound('Вопрос не найден')
    await this.testForManage(question.testId, userId, role)
    await this.prisma.client.testQuestion.delete({ where: { id: questionId } })
  }

  private publicQuestion(question: QuestionRow, attemptSeed: string, optionOrder: Record<string, string[]> | null) {
    const order = optionOrder?.[question.id]
    let options = question.options
    if (order) {
      const map = new Map(options.map((option) => [option.id, option]))
      options = order.map((id) => map.get(id)).filter((option): option is QuestionRow['options'][number] => Boolean(option))
    }

    const pairs = Array.isArray(question.matchPairs) ? (question.matchPairs as Array<{ left: string; right: string }>) : []
    return {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      points: question.points,
      timeLimitSeconds: question.timeLimitSeconds,
      options: options.map((option) => ({ id: option.id, text: option.text })),
      matchPairsLeft: pairs.map((pair) => pair.left),
      matchPairsRight: shuffle(pairs.map((pair) => pair.right), seedFrom(`${attemptSeed}:${question.id}`)),
    }
  }

  async start(testId: string, userId: string, examId?: string) {
    let expiresAtLimit: Date | null = null
    let attemptsAllowed = 0
    let test: Awaited<ReturnType<TestingService['testForStudent']>>

    if (examId) {
      const exam = await this.prisma.client.exam.findUnique({
        where: { id: examId },
        include: { test: { include: { course: { select: { id: true, title: true } }, questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } } } } },
      })
      if (!exam || !exam.isPublished) throw notFound('Экзамен не найден')
      if (exam.testId !== testId) throw badRequest('Тест не относится к экзамену')
      const registration = await this.prisma.client.examRegistration.findUnique({
        where: { examId_studentId: { examId, studentId: userId } },
      })
      if (!registration || registration.status !== 'REGISTERED') throw forbidden('Вы не зарегистрированы на экзамен')
      const now = Date.now()
      if (now < exam.startsAt.getTime()) throw badRequest('Экзамен ещё не начался')
      if (now > exam.endsAt.getTime()) throw badRequest('Экзамен завершён')
      expiresAtLimit = new Date(Math.min(now + exam.durationMinutes * 60_000, exam.endsAt.getTime()))
      attemptsAllowed = exam.maxAttempts
      test = exam.test
    } else {
      test = await this.testForStudent(testId, userId)
      attemptsAllowed = test.attemptsAllowed
    }

    if (test.questions.length === 0) throw badRequest('В тесте нет вопросов')

    const active = await this.prisma.client.testAttempt.findFirst({
      where: { testId, studentId: userId, examId: examId ?? null, status: 'IN_PROGRESS' },
      include: { answers: true },
    })
    if (active && active.expiresAt.getTime() > Date.now()) {
      return this.attemptPayload(active, test, true)
    }
    if (active) {
      await this.prisma.client.testAttempt.update({ where: { id: active.id }, data: { status: 'EXPIRED' } })
    }

    const finished = await this.prisma.client.testAttempt.count({
      where: { testId, studentId: userId, ...(examId ? { examId } : {}), status: { in: ['SUBMITTED', 'EXPIRED'] } },
    })
    if (finished >= attemptsAllowed) throw conflict('Попытки закончились')

    const expiresAt = expiresAtLimit ?? new Date(Date.now() + test.timeLimitMinutes * 60_000)
    const questionOrder = test.shuffleQuestions
      ? shuffle(test.questions.map((question) => question.id), seedFrom(`${userId}:${Date.now()}`))
      : test.questions.map((question) => question.id)
    const optionOrder = test.shuffleOptions
      ? Object.fromEntries(
          test.questions.map((question) => [
            question.id,
            shuffle(question.options.map((option) => option.id), seedFrom(`${userId}:${question.id}`)),
          ]),
        )
      : null

    const firstQuestion = test.questions.find((question) => question.id === questionOrder[0])
    const firstQuestionSeconds = firstQuestion?.timeLimitSeconds ?? test.questionTimeLimitSeconds
    const firstQuestionExpiresAt = firstQuestionSeconds ? new Date(Date.now() + firstQuestionSeconds * 1000) : null
    const attempt = await this.prisma.client.testAttempt.create({
      data: {
        testId,
        studentId: userId,
        examId: examId ?? null,
        expiresAt,
        questionOrder: questionOrder as unknown as Prisma.InputJsonValue,
        optionOrder: optionOrder ? (optionOrder as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        currentQuestionId: questionOrder[0] ?? null,
        questionExpiresAt: firstQuestionExpiresAt,
        questionDeadlines:
          firstQuestion && firstQuestionExpiresAt
            ? ({ [firstQuestion.id]: firstQuestionExpiresAt.toISOString() } as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
      include: { answers: true },
    })
    await this.event(testId, userId, 'ATTEMPT_STARTED', examId ? 'Начата попытка экзамена' : 'Начата попытка теста', {
      attemptId: attempt.id,
      examId: examId ?? null,
    })
    return this.attemptPayload(attempt, test, false)
  }

  private attemptPayload(
    attempt: {
      id: string
      expiresAt: Date
      questionOrder: Prisma.JsonValue
      optionOrder: Prisma.JsonValue
      currentQuestionId: string | null
      questionExpiresAt: Date | null
      answers: Array<{ questionId: string; answer: Prisma.JsonValue }>
    },
    test: { questions: QuestionRow[]; shuffleQuestions: boolean; questionTimeLimitSeconds: number | null },
    resumed: boolean,
  ) {
    const order = Array.isArray(attempt.questionOrder) ? (attempt.questionOrder as string[]) : null
    const byId = new Map(test.questions.map((question) => [question.id, question]))
    const ordered = order ? order.map((id) => byId.get(id)).filter((question): question is QuestionRow => Boolean(question)) : test.questions
    const optionOrder =
      attempt.optionOrder && typeof attempt.optionOrder === 'object' && !Array.isArray(attempt.optionOrder)
        ? (attempt.optionOrder as Record<string, string[]>)
        : null

    return {
      attemptId: attempt.id,
      expiresAt: attempt.expiresAt,
      resumed,
      currentQuestionId: attempt.currentQuestionId,
      questionExpiresAt: attempt.questionExpiresAt,
      questionTimeLimitSeconds: test.questionTimeLimitSeconds,
      questions: ordered.map((question) => this.publicQuestion(question, attempt.id, optionOrder)),
      savedAnswers: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        value: (answer.answer as { value?: unknown })?.value ?? null,
      })),
    }
  }

  async focus(attemptId: string, userId: string, questionId: string) {
    const attempt = await this.prisma.client.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: { select: { questionTimeLimitSeconds: true } } },
    })
    if (!attempt || attempt.studentId !== userId) throw notFound('Попытка не найдена')
    if (attempt.status !== 'IN_PROGRESS') throw badRequest('Попытка завершена')

    const question = await this.prisma.client.testQuestion.findFirst({
      where: { id: questionId, testId: attempt.testId },
      select: { timeLimitSeconds: true },
    })
    if (!question) throw badRequest('Вопрос относится к другому тесту')

    // Не продлеваем таймер, если клиент повторно сообщает о том же вопросе.
    const deadlines = parseDeadlines(attempt.questionDeadlines)
    const storedDeadline = deadlines[questionId]
    if (storedDeadline) {
      const questionExpiresAt = new Date(storedDeadline)
      await this.prisma.client.testAttempt.update({
        where: { id: attemptId },
        data: { currentQuestionId: questionId, questionExpiresAt },
      })
      return { questionId, questionExpiresAt }
    }
    if (attempt.currentQuestionId === questionId && attempt.questionExpiresAt) {
      return { questionId, questionExpiresAt: attempt.questionExpiresAt }
    }

    const seconds = question.timeLimitSeconds ?? attempt.test.questionTimeLimitSeconds
    const questionExpiresAt = seconds ? new Date(Date.now() + seconds * 1000) : null
    const nextDeadlines = questionExpiresAt
      ? ({ ...deadlines, [questionId]: questionExpiresAt.toISOString() } as Prisma.InputJsonValue)
      : (deadlines as Prisma.InputJsonValue)

    await this.prisma.client.testAttempt.update({
      where: { id: attemptId },
      data: { currentQuestionId: questionId, questionExpiresAt, ...(questionExpiresAt ? { questionDeadlines: nextDeadlines } : {}) },
    })
    return { questionId, questionExpiresAt }
  }

  async saveProgress(attemptId: string, userId: string, answers: Array<{ questionId: string; value: unknown }>) {
    const attempt = await this.prisma.client.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        studentId: true,
        testId: true,
        status: true,
        currentQuestionId: true,
        questionDeadlines: true,
        test: { select: { questionTimeLimitSeconds: true, questions: { select: { id: true, timeLimitSeconds: true } } } },
      },
    })
    if (!attempt || attempt.studentId !== userId) throw notFound('Попытка не найдена')
    if (attempt.status !== 'IN_PROGRESS') throw badRequest('Попытка завершена')

    const valid = await this.prisma.client.testQuestion.findMany({
      where: { testId: attempt.testId, id: { in: answers.map((answer) => answer.questionId) } },
      select: { id: true, timeLimitSeconds: true },
    })
    const allowed = new Map(valid.map((question) => [question.id, question]))
    const deadlines = parseDeadlines(attempt.questionDeadlines)
    const now = Date.now()
    const accepted = answers.filter((answer) => {
      const question = allowed.get(answer.questionId)
      if (!question) return false
      const seconds = question.timeLimitSeconds ?? attempt.test.questionTimeLimitSeconds
      if (!seconds) return true
      const deadline = deadlines[answer.questionId]
      if (!deadline) return answer.questionId === attempt.currentQuestionId
      return now <= new Date(deadline).getTime() + 5_000
    })

    await this.prisma.client.$transaction(
      accepted.map((answer) =>
        this.prisma.client.testAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: answer.questionId } },
          create: { attemptId, questionId: answer.questionId, answer: { value: answer.value } as Prisma.InputJsonValue },
          update: { answer: { value: answer.value } as Prisma.InputJsonValue },
        }),
      ),
    )
    return { savedAt: new Date(), saved: accepted.length, skipped: answers.length - accepted.length }
  }

  private isAnswerCorrect(question: QuestionRow, value: unknown): { correct: boolean | null; manual: boolean } {
    switch (question.type) {
      case 'SINGLE': {
        const option = question.options.find((item) => item.id === value)
        return { correct: Boolean(option?.isCorrect), manual: false }
      }
      case 'MULTIPLE': {
        if (!Array.isArray(value)) return { correct: false, manual: false }
        const selected = new Set(value.filter((item): item is string => typeof item === 'string'))
        const correct = new Set(question.options.filter((option) => option.isCorrect).map((option) => option.id))
        return { correct: selected.size === correct.size && [...selected].every((id) => correct.has(id)), manual: false }
      }
      case 'TEXT': {
        if (typeof value !== 'string') {
          return question.correctText || question.options.some((option) => option.isCorrect)
            ? { correct: false, manual: false }
            : { correct: null, manual: true }
        }
        const accepted = [
          ...(question.correctText ? [question.correctText] : []),
          ...question.options.filter((option) => option.isCorrect).map((option) => option.text),
        ]
        if (accepted.length === 0) return { correct: null, manual: true }
        return { correct: accepted.some((item) => normalize(item) === normalize(value)), manual: false }
      }
      case 'NUMBER': {
        const numeric = typeof value === 'number' ? value : Number(value)
        return { correct: Number.isFinite(numeric) && question.correctNumber !== null && Math.abs(numeric - question.correctNumber) < 1e-6, manual: false }
      }
      case 'BOOLEAN':
        return { correct: typeof value === 'boolean' && value === question.correctBoolean, manual: false }
      case 'MATCHING': {
        if (!Array.isArray(value)) return { correct: false, manual: false }
        const expected = Array.isArray(question.matchPairs) ? (question.matchPairs as Array<{ left: string; right: string }>) : []
        if (value.length !== expected.length) return { correct: false, manual: false }
        const submitted = new Map<string, string>()
        for (const pair of value) {
          if (!pair || typeof pair !== 'object') return { correct: false, manual: false }
          const { left, right } = pair as { left?: unknown; right?: unknown }
          if (typeof left !== 'string' || typeof right !== 'string') return { correct: false, manual: false }
          submitted.set(left, right)
        }
        return { correct: expected.every((pair) => submitted.get(pair.left) === pair.right), manual: false }
      }
      default:
        return { correct: false, manual: false }
    }
  }

  async submit(attemptId: string, userId: string, answers: Array<{ questionId: string; value: unknown }>) {
    const attempt = await this.prisma.client.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          include: {
            questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
            course: { select: { id: true, title: true, teacherId: true } },
          },
        },
        answers: true,
      },
    })
    if (!attempt || attempt.studentId !== userId) throw notFound('Попытка не найдена')
    if (attempt.status !== 'IN_PROGRESS') throw badRequest('Попытка уже завершена')

    const existing = new Map<string, unknown>(
      attempt.answers.map((answer) => [answer.questionId, (answer.answer as { value?: unknown })?.value ?? null]),
    )
    const deadlines = parseDeadlines(attempt.questionDeadlines)
    const now = Date.now()
    const overallExpired = now > attempt.expiresAt.getTime() + ATTEMPT_GRACE_MS
    for (const answer of answers) {
      // После общего дедлайна принимаем только ранее сохранённый прогресс.
      if (overallExpired) continue
      const deadline = deadlines[answer.questionId]
      // Ответы, отправленные после индивидуального дедлайна, не подменяют сохранённые вовремя.
      if (deadline && now > new Date(deadline).getTime() + 5_000) continue
      existing.set(answer.questionId, answer.value)
    }

    let score = 0
    let maxScore = 0
    let needsManualReview = false

    const graded = attempt.test.questions.map((question) => {
      const value = existing.get(question.id) ?? null
      const verdict = this.isAnswerCorrect(question, value)
      if (verdict.manual) needsManualReview = true
      const pointsAwarded = verdict.correct ? question.points : 0
      score += pointsAwarded
      maxScore += question.points
      return { question, value, verdict, pointsAwarded }
    })

    const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100)
    const expired = overallExpired

    await this.prisma.client.$transaction(async (tx) => {
      for (const item of graded) {
        await tx.testAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: item.question.id } },
          create: {
            attemptId,
            questionId: item.question.id,
            answer: { value: item.value } as Prisma.InputJsonValue,
            isCorrect: item.verdict.correct,
            pointsAwarded: item.pointsAwarded,
          },
          update: {
            answer: { value: item.value } as Prisma.InputJsonValue,
            isCorrect: item.verdict.correct,
            pointsAwarded: item.pointsAwarded,
          },
        })
      }
      await tx.testAttempt.update({
        where: { id: attemptId },
        data: {
          status: (expired ? 'EXPIRED' : 'SUBMITTED') as AttemptStatus,
          submittedAt: new Date(),
          score,
          maxScore,
          percent,
          needsManualReview,
        },
      })
      // Работа с текстовыми ответами получит монеты после проверки наставником.
      if (!expired && !needsManualReview) {
        await awardCoins(tx, {
          userId,
          amount: testCoinReward(percent),
          reason: `Тест: ${attempt.test.title}`,
          sourceType: 'TEST',
          sourceId: attempt.testId,
        })
      }
    })

    void evaluateAchievements(userId).catch((error) => console.warn('[achievements]', error))

    if (needsManualReview) {
      await notifyUsers([attempt.test.course.teacherId], {
        type: 'GRADE_RECEIVED',
        title: attempt.examId ? 'Экзамен ждёт ручной проверки' : 'Тест ждёт ручной проверки',
        body: `«${attempt.test.title}»: есть текстовые ответы для проверки`,
        data: { kind: attempt.examId ? 'exam_review' : 'test_review', testId: attempt.testId, attemptId, examId: attempt.examId },
      }).catch(() => undefined)
    } else {
      await notifyUsers([attempt.studentId], {
        type: attempt.examId ? 'EXAM_RESULT' : 'TEST_RESULT',
        title: attempt.examId ? 'Результат экзамена' : 'Результат теста',
        body: `«${attempt.test.title}»: ${score} из ${maxScore} (${percent}%)`,
        data: { kind: attempt.examId ? 'exam_result' : 'test_result', testId: attempt.testId, attemptId, examId: attempt.examId },
      }).catch(() => undefined)
    }

    await this.event(attempt.testId, userId, 'ATTEMPT_SUBMITTED', 'Попытка завершена', {
      attemptId,
      percent,
      needsManualReview,
    })

    return this.result(attemptId, userId, 'STUDENT')
  }

  async result(attemptId: string, userId: string, role: RoleName) {
    const attempt = await this.prisma.client.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          include: {
            questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
            course: { select: { id: true, title: true, teacherId: true } },
            gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
          },
        },
        exam: {
          select: {
            id: true,
            title: true,
            passingScore: true,
            createdById: true,
            gradingScale: { include: { bands: { orderBy: { position: 'asc' } } } },
          },
        },
        answers: true,
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })
    if (!attempt) throw notFound('Попытка не найдена')
    const manager =
      this.isManager(role) ||
      (role === 'TEACHER' && (attempt.test.course.teacherId === userId || attempt.exam?.createdById === userId))
    if (!manager && attempt.studentId !== userId) throw forbidden('Попытка принадлежит другому ученику')

    const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer]))
    const showAnswers = manager || attempt.test.showCorrectAnswers
    const showExplanations = manager || attempt.test.showExplanations

    const questions = attempt.test.questions.map((question) => {
      const answer = answers.get(question.id)
      const value = (answer?.answer as { value?: unknown })?.value ?? null
      const pairs = Array.isArray(question.matchPairs) ? (question.matchPairs as Array<{ left: string; right: string }>) : []
      let given: unknown = value
      let correct: unknown = null
      if (['SINGLE', 'MULTIPLE', 'TEXT'].includes(question.type)) {
        given = Array.isArray(value)
          ? question.options.filter((option) => value.includes(option.id)).map((option) => option.text)
          : question.options.find((option) => option.id === value)?.text ?? (typeof value === 'string' ? value : null)
        correct =
          question.type === 'TEXT'
            ? question.correctText ?? question.options.filter((option) => option.isCorrect).map((option) => option.text)
            : question.options.filter((option) => option.isCorrect).map((option) => option.text)
      } else if (question.type === 'MATCHING') {
        given = Array.isArray(value) ? value : []
        correct = pairs
      } else if (question.type === 'NUMBER') {
        correct = question.correctNumber
      } else if (question.type === 'BOOLEAN') {
        correct = question.correctBoolean
      }

      return {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        topic: question.topic,
        points: question.points,
        pointsAwarded: answer?.pointsAwarded ?? 0,
        isCorrect: answer?.isCorrect ?? null,
        answer: given,
        correctAnswer: showAnswers ? correct : null,
        explanation: showExplanations ? question.explanation : null,
        comment: answer?.comment ?? null,
      }
    })

    const topics = new Map<string, { topic: string; total: number; errors: number }>()
    for (const question of questions) {
      const topic = question.topic?.trim() || 'Без темы'
      const current = topics.get(topic) ?? { topic, total: 0, errors: 0 }
      current.total += 1
      if (question.isCorrect === false) current.errors += 1
      topics.set(topic, current)
    }
    const recommendations = [...topics.values()]
      .filter((topic) => topic.errors > 0)
      .sort((a, b) => b.errors - a.errors)
      .map((topic) => ({
        topic: topic.topic,
        errors: topic.errors,
        total: topic.total,
        advice: `Повторите тему «${topic.topic}»: ошибок ${topic.errors} из ${topic.total}.`,
      }))

    const gradingScale = attempt.exam?.gradingScale ?? attempt.test.gradingScale
    const passingScore = attempt.exam?.passingScore ?? attempt.test.passingScore
    const band =
      gradingScale?.bands.find(
        (item) => (attempt.percent ?? 0) >= item.minPercent && (attempt.percent ?? 0) <= item.maxPercent,
      ) ?? null

    return {
      attemptId: attempt.id,
      examId: attempt.examId,
      test: { id: attempt.test.id, title: attempt.exam?.title ?? attempt.test.title, course: attempt.test.course },
      student: {
        id: attempt.student.id,
        name: `${attempt.student.firstName} ${attempt.student.lastName}`.trim(),
        email: attempt.student.email,
      },
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      expiresAt: attempt.expiresAt,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percent: attempt.percent,
      passed: (attempt.percent ?? 0) >= passingScore,
      passingScore,
      needsManualReview: attempt.needsManualReview,
      gradedAt: attempt.gradedAt,
      questions,
      recommendations,
      grade: band ? { label: band.label, description: band.description } : null,
      scale: gradingScale ? { id: gradingScale.id, name: gradingScale.name, bands: gradingScale.bands } : null,
    }
  }

  async review(attemptId: string, userId: string, role: RoleName, input: AttemptReview) {
    const attempt = await this.prisma.client.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          include: {
            questions: { include: { options: { orderBy: { position: 'asc' } } } },
            course: { select: { teacherId: true } },
          },
        },
        answers: true,
      },
    })
    if (!attempt) throw notFound('Попытка не найдена')
    await this.testForManage(attempt.testId, userId, role)
    if (attempt.status === 'IN_PROGRESS') throw badRequest('Сначала ученик должен завершить попытку')

    const questionMap = new Map(attempt.test.questions.map((question) => [question.id, question]))
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]))

    await this.prisma.client.$transaction(async (tx) => {
      for (const item of input.answers) {
        const question = questionMap.get(item.questionId)
        if (!question) continue
        const points = Math.min(item.pointsAwarded, question.points)
        const isCorrect = points >= question.points
        await tx.testAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: item.questionId } },
          create: {
            attemptId,
            questionId: item.questionId,
            answer: answerMap.get(item.questionId)?.answer ?? ({ value: null } as Prisma.InputJsonValue),
            pointsAwarded: points,
            isCorrect,
            comment: item.comment ?? null,
            reviewedById: userId,
            reviewedAt: new Date(),
          },
          update: {
            pointsAwarded: points,
            isCorrect,
            comment: item.comment ?? null,
            reviewedById: userId,
            reviewedAt: new Date(),
          },
        })
      }
    })

    const updatedAnswers = await this.prisma.client.testAnswer.findMany({ where: { attemptId } })
    const score = updatedAnswers.reduce((sum, answer) => sum + answer.pointsAwarded, 0)
    const maxScore = attempt.test.questions.reduce((sum, question) => sum + question.points, 0)
    const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100)
    const unresolved = attempt.test.questions.some((question) => {
      if (question.type !== 'TEXT') return false
      const answer = updatedAnswers.find((item) => item.questionId === question.id)
      // Непроверенный или отсутствующий текстовый ответ оставляет попытку в очереди.
      return !answer || answer.isCorrect === null
    })

    const saved = await this.prisma.client.testAttempt.update({
      where: { id: attemptId },
      data: {
        score,
        maxScore,
        percent,
        needsManualReview: unresolved,
        gradedById: userId,
        gradedAt: new Date(),
      },
    })
    if (!unresolved) {
      await this.prisma.client.$transaction((tx) => awardCoins(tx, {
        userId: attempt.studentId,
        amount: testCoinReward(percent),
        reason: `Тест: ${attempt.test.title}`,
        sourceType: 'TEST',
        sourceId: attempt.testId,
        awardedById: userId,
      }))
    }

    await notifyUsers([attempt.studentId], {
      type: attempt.examId ? 'EXAM_RESULT' : 'TEST_RESULT',
      title: attempt.examId ? 'Результат экзамена обновлён' : 'Результат теста обновлён',
      body: `«${attempt.test.title}»: ${score} из ${maxScore} (${percent}%)`,
      data: { kind: attempt.examId ? 'exam_result' : 'test_result', testId: attempt.testId, attemptId, examId: attempt.examId },
    }).catch(() => undefined)

    await this.event(attempt.testId, userId, 'ATTEMPT_REVIEWED', input.comment ?? 'Ручная проверка теста', {
      attemptId,
      percent,
    })
    await writeAudit({ actorId: userId, action: 'test.review', entity: 'TestAttempt', entityId: attemptId })
    if (!unresolved) {
      await evaluateAchievements(attempt.studentId).catch((error) => console.warn('[achievements]', error))
    }
    if (role === 'TEACHER') {
      await evaluateAchievements(userId).catch((error) => console.warn('[achievements]', error))
    }
    return { attemptId, score, maxScore, percent, needsManualReview: unresolved, status: saved.status }
  }

  async results(testId: string, userId: string, role: RoleName) {
    await this.testForManage(testId, userId, role)
    const attempts = await this.prisma.client.testAttempt.findMany({
      where: { testId },
      orderBy: { startedAt: 'desc' },
      take: 500,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        answers: { select: { isCorrect: true, pointsAwarded: true } },
      },
    })
    return {
      items: attempts.map((attempt) => ({
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
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        correct: attempt.answers.filter((answer) => answer.isCorrect).length,
        answers: attempt.answers.length,
      })),
    }
  }

  // ---------- банк вопросов ----------

  async banks(userId: string, role: RoleName) {
    const banks = await this.prisma.client.questionBank.findMany({
      where: this.isManager(role) ? {} : { teacherId: userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        teacher: { select: { firstName: true, lastName: true } },
        _count: { select: { questions: true } },
      },
    })
    return {
      items: banks.map((bank) => ({
        id: bank.id,
        title: bank.title,
        description: bank.description,
        questions: bank._count.questions,
        teacher: `${bank.teacher.firstName} ${bank.teacher.lastName}`.trim(),
        updatedAt: bank.updatedAt,
      })),
    }
  }

  async createBank(input: { title: string; description?: string }, userId: string) {
    return this.prisma.client.questionBank.create({
      data: { teacherId: userId, title: input.title, description: input.description ?? null },
      select: { id: true, title: true },
    })
  }

  private async bankForManage(bankId: string, userId: string, role: RoleName) {
    const bank = await this.prisma.client.questionBank.findUnique({ where: { id: bankId }, select: { id: true, teacherId: true } })
    if (!bank) throw notFound('Банк вопросов не найден')
    if (!this.isManager(role) && bank.teacherId !== userId) throw forbidden('Банк принадлежит другому наставнику')
    return bank
  }

  async bankDetail(bankId: string, userId: string, role: RoleName) {
    await this.bankForManage(bankId, userId, role)
    const bank = await this.prisma.client.questionBank.findUnique({
      where: { id: bankId },
      include: { questions: { orderBy: { createdAt: 'desc' }, include: { options: { orderBy: { position: 'asc' } } } } },
    })
    return bank
  }

  async addBankQuestion(bankId: string, input: QuestionInput, userId: string, role: RoleName) {
    await this.bankForManage(bankId, userId, role)
    const { options, pairs } = this.normalizeQuestionInput(input)
    return this.prisma.client.bankQuestion.create({
      data: {
        bankId,
        type: input.type,
        prompt: input.prompt,
        points: input.points,
        explanation: input.explanation ?? null,
        topic: input.topic ?? null,
        correctText: input.correctText ?? null,
        correctNumber: input.correctNumber ?? null,
        correctBoolean: input.correctBoolean ?? null,
        matchPairs: pairs.length ? (pairs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        options: { create: options.map((option, position) => ({ text: option.text, isCorrect: option.isCorrect, position })) },
      },
      include: { options: true },
    })
  }

  async removeBankQuestion(questionId: string, userId: string, role: RoleName) {
    const question = await this.prisma.client.bankQuestion.findUnique({
      where: { id: questionId },
      include: { bank: { select: { id: true, teacherId: true } } },
    })
    if (!question) throw notFound('Вопрос не найден')
    if (!this.isManager(role) && question.bank.teacherId !== userId) throw forbidden('Вопрос принадлежит другому наставнику')
    await this.prisma.client.bankQuestion.delete({ where: { id: questionId } })
  }

  async importQuestions(testId: string, questionIds: string[], userId: string, role: RoleName) {
    await this.testForManage(testId, userId, role)
    const questions = await this.prisma.client.bankQuestion.findMany({
      where: {
        id: { in: questionIds },
        ...(this.isManager(role) ? {} : { bank: { teacherId: userId } }),
      },
      include: { options: { orderBy: { position: 'asc' } } },
    })
    if (questions.length === 0) throw badRequest('Не выбрано ни одного своего вопроса')

    const last = await this.prisma.client.testQuestion.aggregate({ where: { testId }, _max: { position: true } })
    let position = (last._max.position ?? -1) + 1
    for (const question of questions) {
      await this.prisma.client.testQuestion.create({
        data: {
          testId,
          type: question.type,
          prompt: question.prompt,
          points: question.points,
          position,
          explanation: question.explanation,
          topic: question.topic,
          correctText: question.correctText,
          correctNumber: question.correctNumber,
          correctBoolean: question.correctBoolean,
          matchPairs: question.matchPairs ?? Prisma.JsonNull,
          options: {
            create: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect, position: option.position })),
          },
        },
      })
      position += 1
    }
    await this.event(testId, userId, 'BANK_IMPORT', `Импортировано вопросов: ${questions.length}`)
    return { imported: questions.length }
  }

  // ---------- AI ----------

  async generate(input: AiGenerate, userId: string, role: RoleName) {
    if (input.testId) await this.testForManage(input.testId, userId, role)
    const typeHints: Record<string, string> = {
      SINGLE: 'один правильный ответ',
      MULTIPLE: 'несколько правильных ответов',
      TEXT: 'текстовый ответ',
      MATCHING: 'сопоставление пар',
    }
    const system = [
      'Ты — методист образовательной платформы ITadis. Составь тестовые вопросы и верни ТОЛЬКО JSON.',
      'Формат: {"questions":[{"type":"SINGLE|MULTIPLE|TEXT|MATCHING","prompt":"...","points":1,',
      '"options":["..."],"correctOptions":[0],"correctText":"...","matchPairs":[{"left":"...","right":"..."}],',
      '"explanation":"...","topic":"..."}]}',
      'Для SINGLE/MULTIPLE используй options и correctOptions (индексы с нуля).',
      'Для TEXT — эталон в correctText. Для MATCHING — 2–6 пар в matchPairs и пустой options.',
      'Объяснение должно быть коротким и учить, а не только называть ответ.',
    ].join('\n')

    const topicLabel = input.topic?.trim() || 'по предоставленным учебным материалам'
    const user = [
      `Тема: ${topicLabel}`,
      `Сложность: ${input.difficulty}`,
      `Количество вопросов: ${input.count}`,
      `Типы: ${input.types.map((type) => typeHints[type]).join(', ')}`,
      input.material ? `Учебный материал:\n${input.material}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const data = await aiJson<{ questions?: unknown[] }>(system, user, 2400)
    const raw = Array.isArray(data.questions) ? data.questions.slice(0, input.count) : []
    if (raw.length === 0) throw badRequest('AI не вернул вопросы, попробуйте переформулировать тему')

    const questions: QuestionInput[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const type = (typeof row.type === 'string' && input.types.includes(row.type as never) ? row.type : input.types[0]) as QuestionInput['type']
      const prompt = typeof row.prompt === 'string' ? row.prompt.trim().slice(0, 5000) : ''
      if (prompt.length < 3) continue
      const optionsRaw = Array.isArray(row.options) ? row.options.filter((text): text is string => typeof text === 'string') : []
      const correctIndexes = Array.isArray(row.correctOptions)
        ? row.correctOptions.filter((index): index is number => typeof index === 'number')
        : []
      const pairsRaw = Array.isArray(row.matchPairs) ? row.matchPairs : []
      const pairs = pairsRaw
        .map((pair) => pair as { left?: unknown; right?: unknown })
        .filter((pair) => typeof pair.left === 'string' && typeof pair.right === 'string')
        .map((pair) => ({ left: String(pair.left).slice(0, 300), right: String(pair.right).slice(0, 300) }))

      questions.push({
        type,
        prompt,
        points: Math.min(10, Math.max(1, Number(row.points) || 1)),
        explanation: typeof row.explanation === 'string' ? row.explanation.slice(0, 2000) : undefined,
        topic:
          typeof row.topic === 'string'
            ? row.topic.slice(0, 120)
            : (input.topic?.trim() || input.material?.trim().slice(0, 120) || 'Без темы'),
        options:
          type === 'SINGLE' || type === 'MULTIPLE'
            ? optionsRaw.slice(0, 10).map((text, index) => ({ text: text.slice(0, 500), isCorrect: correctIndexes.includes(index) }))
            : undefined,
        correctText: type === 'TEXT' && typeof row.correctText === 'string' ? row.correctText.slice(0, 1000) : undefined,
        matchPairs: type === 'MATCHING' ? pairs.slice(0, 20) : undefined,
      })
    }

    const valid = questions.filter((question) => {
      try {
        this.normalizeQuestionInput(question)
        return true
      } catch {
        return false
      }
    })
    if (valid.length === 0) throw badRequest('AI вернул вопросы без корректных правильных ответов')

    let saved = 0
    if (input.testId) {
      for (const question of valid) {
        await this.addQuestion(input.testId, question, userId, role)
        saved += 1
      }
    }
    return { questions: valid, saved, testId: input.testId ?? null }
  }

  private async event(
    entityId: string,
    actorId: string,
    type: string,
    message?: string,
    data?: Prisma.InputJsonValue,
  ) {
    await this.prisma.client.assessmentEvent
      .create({
        data: {
          entityType: 'TEST',
          entityId,
          actorId,
          type,
          message: message ?? null,
          data: data ?? Prisma.JsonNull,
        },
      })
      .catch((error) => console.warn('[testing] событие не записано', error))
  }
}
