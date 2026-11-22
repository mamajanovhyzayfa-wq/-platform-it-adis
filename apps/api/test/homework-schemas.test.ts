import { describe, expect, it } from 'vitest'
import { homeworkReviewSchema, homeworkSubmitSchema } from '../src/modules/assessment/assessment.schemas.js'

describe('схемы домашнего задания', () => {
  it('требует комментарий при возврате на исправление', () => {
    expect(homeworkReviewSchema.safeParse({ score: 5, returnForRevision: true }).success).toBe(false)
    expect(homeworkReviewSchema.safeParse({ score: 5, returnForRevision: true, comment: 'Исправьте вывод' }).success).toBe(true)
  })

  it('не принимает javascript-ссылки в решении', () => {
    expect(homeworkSubmitSchema.safeParse({ projectUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(homeworkSubmitSchema.safeParse({ projectUrl: 'https://github.com/student/work' }).success).toBe(true)
  })

  it('требует текст, ссылку или файл', () => {
    expect(homeworkSubmitSchema.safeParse({}).success).toBe(false)
    expect(homeworkSubmitSchema.safeParse({ text: 'Готовое решение' }).success).toBe(true)
  })
})
