import { Router } from 'express'
import { z } from 'zod'
import type { QuestionType } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { awardCoins, testCoinReward } from '../../lib/coins.js'
import { evaluateAchievements } from '../achievements/evaluate.js'
import { gradeAttempt, type GradableQuestion } from './grading.js'

export const testsRouter = Router()

const submitSchema = z.object({
  attemptId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
      }),
    )
    .max(200),
})

const TEST_GRACE_MS = 60_000

async function loadTestForUser(testId: string, userId: string, role: string) {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    include: {
      course: { select: { id: true, title: true, teacherId: true } },
      questions: { include: { options: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
    },
  })
  if (!test) throw notFound('Тест не найден')

  if (role === 'STUDENT') {
    if (!test.isPublished) throw notFound('Тест не найден')
    const enrolled = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: test.course.id, studentId: userId } },
    })
    if (!enrolled) throw notFound('Тест не найден')
  }
  if (role === 'TEACHER' && test.course.teacherId !== userId) {
    throw forbidden('Тест принадлежит другому курсу')
  }

  return test
}

/** Вопрос без правильных ответов — клиент не должен получать ключи. */
function publicQuestion(question: {
  id: string
  type: QuestionType
  prompt: string
  points: number
  matchPairs: unknown
  options: Array<{ id: string; text: string; position: number }>
}) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    points: question.points,
    matchPairsLeft:
      question.type === 'MATCHING' && Array.isArray(question.matchPairs)
        ? (question.matchPairs as Array<{ left: string; right: string }>).map((pair) => pair.left)
        : null,
    matchPairsRight:
      question.type === 'MATCHING' && Array.isArray(question.matchPairs)
        ? shuffle((question.matchPairs as Array<{ left: string; right: string }>).map((pair) => pair.right))
        : null,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const current = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = current
  }
  return copy
}

testsRouter.get('/', requireAuth, async (req, res) => {
  const auth = req.auth!

  const where =
    auth.role === 'TEACHER'
      ? { course: { teacherId: auth.userId } }
      : auth.role === 'ADMIN'
        ? {}
        : { isPublished: true, course: { enrollments: { some: { studentId: auth.userId } } } }

  const tests = await prisma.test.findMany({
    where,
    include: {
      course: { select: { id: true, title: true } },
      _count: { select: { questions: true } },
      attempts:
        auth.role === 'STUDENT'
          ? { where: { studentId: auth.userId }, select: { id: true, status: true, score: true } }
          : false,
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json({
    items: tests.map((test) => {
      const attempts = 'attempts' in test ? test.attempts ?? [] : []
      const bestScore = attempts.reduce((best, attempt) => Math.max(best, attempt.score ?? 0), 0)
      return {
        id: test.id,
        title: test.title,
        description: test.description,
        course: test.course,
        timeLimitMinutes: test.timeLimitMinutes,
        passingScore: test.passingScore,
        attemptsAllowed: test.attemptsAllowed,
        questionsCount: test._count.questions,
        isPublished: test.isPublished,
        myAttempts: attempts.length,
        bestScore,
        hasActiveAttempt: attempts.some((attempt) => attempt.status === 'IN_PROGRESS'),
      }
    }),
  })
})

testsRouter.get('/:id', requireAuth, async (req, res) => {
  const auth = req.auth!
  const test = await loadTestForUser(String(req.params.id), auth.userId, auth.role)

  const attempts = await prisma.testAttempt.findMany({
    where: { testId: test.id, ...(auth.role === 'STUDENT' ? { studentId: auth.userId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: auth.role === 'STUDENT' ? 20 : 200,
    include: { answers: { select: { questionId: true, isCorrect: true, pointsAwarded: true } } },
  })

  const isStudent = auth.role === 'STUDENT'

  res.json({
    id: test.id,
    title: test.title,
    description: test.description,
    course: test.course,
    timeLimitMinutes: test.timeLimitMinutes,
    passingScore: test.passingScore,
    attemptsAllowed: test.attemptsAllowed,
    questions: test.questions.map(publicQuestion),
    attemptsLeft: isStudent
      ? Math.max(test.attemptsAllowed - attempts.filter((attempt) => attempt.status !== 'IN_PROGRESS').length, 0)
      : null,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      answers: attempt.answers,
    })),
  })
})

testsRouter.post('/:id/start', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const auth = req.auth!
  const test = await loadTestForUser(String(req.params.id), auth.userId, auth.role)

  const active = await prisma.testAttempt.findFirst({
    where: { testId: test.id, studentId: auth.userId, status: 'IN_PROGRESS' },
    include: { answers: true },
  })
  if (active && active.expiresAt.getTime() > Date.now()) {
    return res.json({
      attemptId: active.id,
      expiresAt: active.expiresAt,
      resumed: true,
      questions: test.shuffleQuestions ? test.questions.map(publicQuestion) : test.questions.map(publicQuestion),
      savedAnswers: active.answers.map((answer) => ({ questionId: answer.questionId, value: answer.answer })),
    })
  }
  if (active) {
    await prisma.testAttempt.update({ where: { id: active.id }, data: { status: 'EXPIRED' } })
  }

  const finished = await prisma.testAttempt.count({
    where: { testId: test.id, studentId: auth.userId, status: { in: ['SUBMITTED', 'EXPIRED'] } },
  })
  if (finished >= test.attemptsAllowed) {
    throw conflict('Попытки закончились')
  }

  const attempt = await prisma.testAttempt.create({
    data: {
      testId: test.id,
      studentId: auth.userId,
      expiresAt: new Date(Date.now() + test.timeLimitMinutes * 60_000),
    },
  })

  const ordered = test.shuffleQuestions ? shuffle(test.questions) : test.questions
  const questions = ordered.map((question) =>
    test.shuffleOptions
      ? publicQuestion({ ...question, options: shuffle(question.options) })
      : publicQuestion(question),
  )

  res.status(201).json({
    attemptId: attempt.id,
    expiresAt: attempt.expiresAt,
    resumed: false,
    questions,
    savedAnswers: [],
  })
})

testsRouter.post('/:id/submit', requireAuth, requireRole('STUDENT'), validate(submitSchema), async (req, res) => {
  const auth = req.auth!
  const test = await loadTestForUser(String(req.params.id), auth.userId, auth.role)

  const attempt = await prisma.testAttempt.findUnique({ where: { id: req.body.attemptId } })
  if (!attempt || attempt.testId !== test.id) throw notFound('Попытка не найдена')
  if (attempt.studentId !== auth.userId) throw forbidden('Попытка принадлежит другому ученику')
  if (attempt.status !== 'IN_PROGRESS') throw badRequest('Попытка уже завершена')

  const questions = test.questions as GradableQuestion[]
  const submitted = new Map<string, unknown>(
    req.body.answers.map((answer: { questionId: string; value: unknown }) => [answer.questionId, answer.value]),
  )

  const { score, maxScore, review } = gradeAttempt(questions, submitted)
  const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100)

  // Академический балл и IT Coins разделены, но завершённый тест даёт фиксированную награду.
  await prisma.$transaction(async (tx) => {
    for (const question of questions) {
      const value = submitted.get(question.id) ?? null
      const verdict = review.find((item) => item.questionId === question.id)
      const isCorrect = verdict?.isCorrect ?? false
      const pointsAwarded = verdict?.pointsAwarded ?? 0

      await tx.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
        create: {
          attemptId: attempt.id,
          questionId: question.id,
          answer: value === null ? { value: null } : { value },
          isCorrect,
          pointsAwarded,
        },
        update: { answer: value === null ? { value: null } : { value }, isCorrect, pointsAwarded },
      })
    }

    const expired = Date.now() > attempt.expiresAt.getTime() + TEST_GRACE_MS
    await tx.testAttempt.update({
      where: { id: attempt.id },
      data: {
        status: expired ? 'EXPIRED' : 'SUBMITTED',
        submittedAt: new Date(),
        score,
        maxScore,
        percent,
        needsManualReview: false,
      },
    })
    if (!expired) {
      await awardCoins(tx, {
        userId: auth.userId,
        amount: testCoinReward(percent),
        reason: `Тест: ${test.title}`,
        sourceType: 'TEST',
        sourceId: test.id,
      })
    }
  })

  const correctCount = review.filter((item) => item.isCorrect).length

  void evaluateAchievements(auth.userId).catch((error) => console.warn('[achievements]', error))

  res.json({
    attemptId: attempt.id,
    score,
    maxScore,
    percent,
    passed: percent >= test.passingScore,
    correctCount,
    incorrectCount: questions.length - correctCount,
    totalQuestions: questions.length,
    review,
  })
})

testsRouter.get('/:id/results', requireAuth, async (req, res) => {
  const auth = req.auth!
  const test = await loadTestForUser(String(req.params.id), auth.userId, auth.role)

  const attempts = await prisma.testAttempt.findMany({
    where: { testId: test.id, ...(auth.role === 'STUDENT' ? { studentId: auth.userId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: 200,
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      answers: { select: { questionId: true, isCorrect: true, pointsAwarded: true } },
    },
  })

  res.json({
    items: attempts.map((attempt) => ({
      id: attempt.id,
      student: attempt.student,
      status: attempt.status,
      score: attempt.score,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      correctCount: attempt.answers.filter((answer) => answer.isCorrect).length,
      answersCount: attempt.answers.length,
    })),
  })
})
