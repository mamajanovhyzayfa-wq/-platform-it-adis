import { describe, expect, it } from 'vitest'
import { homeworkSubmissionAvailability, type HomeworkPolicy, type SubmissionSummary } from '../src/lib/homework-rules.js'

const now = new Date('2026-11-20T12:00:00.000Z')
const base: HomeworkPolicy = {
  dueAt: new Date('2026-11-21T12:00:00.000Z'),
  maxAttempts: 2,
  allowLate: false,
  allowResubmit: false,
}

const submission = (attempt: number, status: SubmissionSummary['status']): SubmissionSummary => ({ attempt, status })

describe('правила версий домашнего задания', () => {
  it('разрешает первую отправку до срока', () => {
    const result = homeworkSubmissionAvailability(base, [], now)
    expect(result.canSubmit).toBe(true)
    expect(result.attemptsLeft).toBe(2)
  })

  it('не разрешает отправку после срока без allowLate', () => {
    const result = homeworkSubmissionAvailability({ ...base, dueAt: new Date('2026-11-19T12:00:00.000Z') }, [], now)
    expect(result.canSubmit).toBe(false)
    expect(result.reason).toContain('Срок')
  })

  it('разрешает исправление после возврата даже после срока', () => {
    const result = homeworkSubmissionAvailability(
      { ...base, dueAt: new Date('2026-11-19T12:00:00.000Z') },
      [submission(1, 'RETURNED')],
      now,
    )
    expect(result.canSubmit).toBe(true)
    expect(result.late).toBe(true)
  })

  it('не разрешает вторую версию, пока работа на проверке', () => {
    const result = homeworkSubmissionAvailability(base, [submission(1, 'SUBMITTED')], now)
    expect(result.canSubmit).toBe(false)
    expect(result.reason).toContain('ждёт проверки')
  })

  it('не разрешает новую версию после принятия без allowResubmit', () => {
    const result = homeworkSubmissionAvailability(base, [submission(1, 'REVIEWED')], now)
    expect(result.canSubmit).toBe(false)
    expect(result.reason).toContain('принята')
  })

  it('разрешает повторную сдачу после принятия с allowResubmit', () => {
    const result = homeworkSubmissionAvailability({ ...base, allowResubmit: true }, [submission(1, 'REVIEWED')], now)
    expect(result.canSubmit).toBe(true)
  })

  it('лимит версий важнее статуса', () => {
    const result = homeworkSubmissionAvailability({ ...base, allowResubmit: true }, [submission(1, 'RETURNED'), submission(2, 'RETURNED')], now)
    expect(result.canSubmit).toBe(false)
    expect(result.reason).toContain('все версии')
  })
})
