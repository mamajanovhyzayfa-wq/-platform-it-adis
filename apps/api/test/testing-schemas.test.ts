import { describe, expect, it } from 'vitest'
import { aiGenerateSchema, questionSchema, testUpdateSchema } from '../src/modules/assessment/assessment.schemas.js'

describe('схемы тестирования', () => {
  it('AI может построить тест по учебному материалу без отдельной темы', () => {
    const result = aiGenerateSchema.safeParse({
      material: 'Массивы хранят элементы, доступные по индексу.',
      count: 5,
      types: ['SINGLE', 'MULTIPLE'],
    })
    expect(result.success).toBe(true)
    expect(result.data?.topic).toBeUndefined()
  })

  it('AI-генерация требует тему или материал', () => {
    expect(aiGenerateSchema.safeParse({ count: 3 }).success).toBe(false)
    expect(aiGenerateSchema.safeParse({ topic: 'Массивы' }).success).toBe(true)
  })

  it('настройки теста можно очистить от таймера вопроса и шкалы', () => {
    expect(testUpdateSchema.safeParse({ questionTimeLimitSeconds: null, gradingScaleId: null }).success).toBe(true)
  })

  it('сопоставление требует пары, а баллы остаются положительными', () => {
    expect(
      questionSchema.safeParse({
        type: 'MATCHING',
        prompt: 'Сопоставьте элементы',
        points: 2,
        matchPairs: [{ left: 'A', right: '1' }],
      }).success,
    ).toBe(true)
    expect(questionSchema.safeParse({ type: 'TEXT', prompt: 'Ответ', points: 0 }).success).toBe(false)
  })
})
