import { describe, expect, it } from 'vitest'
import { gradeAnswer, gradeAttempt, type GradableQuestion } from '../src/modules/tests/grading.js'

const single: GradableQuestion = {
  id: 'q1',
  type: 'SINGLE',
  points: 2,
  matchPairs: null,
  correctNumber: null,
  correctBoolean: null,
  options: [
    { id: 'a', text: 'useState', isCorrect: false },
    { id: 'b', text: 'useEffect', isCorrect: true },
  ],
}

const multiple: GradableQuestion = {
  ...single,
  id: 'q2',
  type: 'MULTIPLE',
  options: [
    { id: 'a', text: 'View', isCorrect: true },
    { id: 'b', text: 'Text', isCorrect: true },
    { id: 'c', text: 'div', isCorrect: false },
  ],
}

const text: GradableQuestion = {
  ...single,
  id: 'q3',
  type: 'TEXT',
  options: [{ id: 'a', text: 'Promise', isCorrect: true }],
}

const numberQuestion: GradableQuestion = { ...single, id: 'q4', type: 'NUMBER', correctNumber: 42 }

const booleanQuestion: GradableQuestion = { ...single, id: 'q5', type: 'BOOLEAN', correctBoolean: true }

const matching: GradableQuestion = {
  ...single,
  id: 'q6',
  type: 'MATCHING',
  matchPairs: [
    { left: 'React', right: 'библиотека' },
    { left: 'Node.js', right: 'среда выполнения' },
  ],
}

describe('проверка ответов', () => {
  it('SINGLE: засчитывает только правильный вариант', () => {
    expect(gradeAnswer(single, 'b')).toBe(true)
    expect(gradeAnswer(single, 'a')).toBe(false)
    expect(gradeAnswer(single, 'unknown')).toBe(false)
  })

  it('MULTIPLE: требует точный набор вариантов', () => {
    expect(gradeAnswer(multiple, ['a', 'b'])).toBe(true)
    expect(gradeAnswer(multiple, ['b', 'a'])).toBe(true)
    expect(gradeAnswer(multiple, ['a'])).toBe(false)
    expect(gradeAnswer(multiple, ['a', 'b', 'c'])).toBe(false)
    expect(gradeAnswer(multiple, 'a')).toBe(false)
  })

  it('TEXT: сравнивает без учёта регистра и пробелов', () => {
    expect(gradeAnswer(text, ' promise ')).toBe(true)
    expect(gradeAnswer(text, 'PROMISE')).toBe(true)
    expect(gradeAnswer(text, 'callback')).toBe(false)
  })

  it('TEXT: использует эталон correctText из веб-конструктора', () => {
    expect(gradeAnswer({ ...text, options: [], correctText: 'Promise' }, ' promise ')).toBe(true)
    expect(gradeAnswer({ ...text, options: [], correctText: 'Promise' }, 'async')).toBe(false)
  })

  it('NUMBER: принимает число и строку, отклоняет мусор', () => {
    expect(gradeAnswer(numberQuestion, 42)).toBe(true)
    expect(gradeAnswer(numberQuestion, '42')).toBe(true)
    expect(gradeAnswer(numberQuestion, 41)).toBe(false)
    expect(gradeAnswer(numberQuestion, 'сорок два')).toBe(false)
  })

  it('BOOLEAN: строгое сравнение', () => {
    expect(gradeAnswer(booleanQuestion, true)).toBe(true)
    expect(gradeAnswer(booleanQuestion, false)).toBe(false)
    expect(gradeAnswer(booleanQuestion, 'true')).toBe(false)
  })

  it('MATCHING: требует все пары', () => {
    expect(gradeAnswer(matching, ['React::библиотека', 'Node.js::среда выполнения'])).toBe(true)
    expect(gradeAnswer(matching, ['React::среда выполнения', 'Node.js::библиотека'])).toBe(false)
    expect(gradeAnswer(matching, ['React::библиотека'])).toBe(false)
  })
})

describe('итог попытки', () => {
  it('суммирует баллы и формирует разбор', () => {
    const answers = new Map<string, unknown>([
      ['q1', 'b'],
      ['q2', ['a', 'b']],
      ['q3', 'promise'],
      ['q4', 41],
      ['q5', true],
      ['q6', ['React::библиотека', 'Node.js::среда выполнения']],
    ])

    const result = gradeAttempt([single, multiple, text, numberQuestion, booleanQuestion, matching], answers)

    expect(result.maxScore).toBe(12)
    expect(result.score).toBe(10)
    expect(result.review).toHaveLength(6)
    expect(result.review.find((item) => item.questionId === 'q4')).toEqual({
      questionId: 'q4',
      isCorrect: false,
      pointsAwarded: 0,
    })
  })

  it('не начисляет баллы за пропущенные вопросы', () => {
    const result = gradeAttempt([single, numberQuestion], new Map())
    expect(result.score).toBe(0)
    expect(result.maxScore).toBe(4)
    expect(result.review.every((item) => !item.isCorrect)).toBe(true)
  })
})
