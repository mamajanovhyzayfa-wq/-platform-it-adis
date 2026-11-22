import type { QuestionType } from '@prisma/client'

export type GradableOption = { id: string; text: string; isCorrect: boolean }

export type GradableQuestion = {
  id: string
  type: QuestionType
  points: number
  matchPairs: unknown
  correctNumber: number | null
  correctBoolean: boolean | null
  correctText?: string | null
  options: GradableOption[]
}

/**
 * Проверка ответа ученика. Клиент присылает только значения, правильность и баллы
 * определяются здесь, на сервере.
 */
export function gradeAnswer(question: GradableQuestion, value: unknown): boolean {
  switch (question.type) {
    case 'SINGLE': {
      const option = question.options.find((item) => item.id === value)
      return Boolean(option?.isCorrect)
    }
    case 'MULTIPLE': {
      if (!Array.isArray(value)) return false
      const selected = new Set(value.filter((item): item is string => typeof item === 'string'))
      const correct = new Set(question.options.filter((option) => option.isCorrect).map((option) => option.id))
      if (selected.size !== correct.size) return false
      return [...selected].every((id) => correct.has(id))
    }
    case 'TEXT': {
      if (typeof value !== 'string') return false
      const normalized = value.trim().toLowerCase()
      const accepted = [
        ...(question.correctText ? [question.correctText] : []),
        ...question.options.filter((option) => option.isCorrect).map((option) => option.text),
      ]
      return accepted.some((item) => item.trim().toLowerCase() === normalized)
    }
    case 'NUMBER': {
      const numeric = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numeric) || question.correctNumber === null) return false
      return Math.abs(numeric - question.correctNumber) < 1e-6
    }
    case 'BOOLEAN':
      return typeof value === 'boolean' && value === question.correctBoolean
    case 'MATCHING': {
      if (!Array.isArray(value) || !Array.isArray(question.matchPairs)) return false
      const correctPairs = question.matchPairs as Array<{ left: string; right: string }>
      if (value.length !== correctPairs.length) return false
      const submitted = new Map<string, string>()
      for (const pair of value) {
        if (typeof pair !== 'string') return false
        const [left, right] = pair.split('::')
        if (!left || !right) return false
        submitted.set(left, right)
      }
      return correctPairs.every((pair) => submitted.get(pair.left) === pair.right)
    }
    default:
      return false
  }
}

/** Итог теста: сумма баллов и разбор по вопросам. */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Map<string, unknown>,
): {
  score: number
  maxScore: number
  review: Array<{ questionId: string; isCorrect: boolean; pointsAwarded: number }>
} {
  let score = 0
  let maxScore = 0
  const review: Array<{ questionId: string; isCorrect: boolean; pointsAwarded: number }> = []

  for (const question of questions) {
    maxScore += question.points
    const isCorrect = gradeAnswer(question, answers.get(question.id) ?? null)
    const pointsAwarded = isCorrect ? question.points : 0
    score += pointsAwarded
    review.push({ questionId: question.id, isCorrect, pointsAwarded })
  }

  return { score, maxScore, review }
}
