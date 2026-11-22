import { describe, expect, it } from 'vitest'
import { CookiePolicyController } from '../src/modules/cookie/cookie-policy.controller.js'
import { groupsQuerySchema } from '../src/modules/groups/groups.dto.js'
import { reportRangeSchema } from '../src/modules/reports/reports.dto.js'
import { supportCreateSchema, supportUpdateSchema } from '../src/modules/support/support.dto.js'

describe('контракты доменных модулей', () => {
  it('support: принимает обращение и подставляет безопасные значения', () => {
    const parsed = supportCreateSchema.parse({
      subject: 'Не открывается урок',
      message: 'При переходе в урок появляется ошибка 500, помогите пожалуйста.',
    })
    expect(parsed.category).toBe('OTHER')
    expect(parsed.priority).toBe('NORMAL')
  })

  it('support: отклоняет пустое обращение и неизвестный статус', () => {
    expect(supportCreateSchema.safeParse({ subject: 'x', message: 'short' }).success).toBe(false)
    expect(supportUpdateSchema.safeParse({ status: 'DONE' }).success).toBe(false)
  })

  it('groups: валидирует пагинацию и статус курса', () => {
    expect(groupsQuerySchema.parse({})).toMatchObject({ page: 1, limit: 25 })
    expect(groupsQuerySchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false)
    expect(groupsQuerySchema.parse({ status: 'ACTIVE' }).status).toBe('ACTIVE')
  })

  it('reports: приводит ISO-даты и не принимает мусор', () => {
    const parsed = reportRangeSchema.parse({ from: '2026-11-01', to: '2026-11-20' })
    expect(parsed.from).toBeInstanceOf(Date)
    expect(parsed.to).toBeInstanceOf(Date)
    expect(reportRangeSchema.safeParse({ from: 'not-a-date' }).success).toBe(false)
  })

  it('cookie: публичная политика содержит все категории согласий', () => {
    const policy = new CookiePolicyController().policy()
    expect(policy.version).toBeTruthy()
    expect(policy.categories.map((item) => item.type)).toEqual([
      'COOKIES',
      'COOKIE_FUNCTIONAL',
      'COOKIE_ANALYTICS',
      'COOKIE_MARKETING',
    ])
    expect(policy.categories.filter((item) => item.required)).toHaveLength(1)
  })
})
