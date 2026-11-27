import { describe, expect, it } from 'vitest'
import { sanitizePlainText } from '../src/lib/sanitize.js'
import { leadCreateSchema, leadUpdateSchema } from '../src/modules/leads/leads.service.js'

const base = {
  name: 'Айгуль Тестова',
  phone: '+996 700 123 456',
  consent: true,
}

describe('санитизация заявки (S-5)', () => {
  it('удаляет script вместе с содержимым', () => {
    expect(sanitizePlainText('<script>alert(1)</script>Иван')).toBe('Иван')
  })

  it('удаляет теги, оставляя текст', () => {
    expect(sanitizePlainText('<b>Айгуль</b> <img src=x onerror=alert(1)>Тестова')).toBe('Айгуль Тестова')
  })

  it('убирает угловые скобки и управляющие символы', () => {
    expect(sanitizePlainText('Иван\u0000 <Петров>')).toBe('Иван Петров')
  })

  it('не трогает обычный текст', () => {
    expect(sanitizePlainText('Нужна консультация по курсам')).toBe('Нужна консультация по курсам')
  })
})

describe('схема заявки с лендинга', () => {
  it('сохраняет имя и сообщение без HTML-разметки', () => {
    const parsed = leadCreateSchema.parse({
      ...base,
      name: '<script>alert(1)</script>Айгуль',
      message: '<img src=x onerror=alert(1)>Нужна консультация',
    })

    expect(parsed.name).toBe('Айгуль')
    expect(parsed.message).toBe('Нужна консультация')
  })

  it('отклоняет имя, состоящее только из разметки', () => {
    const result = leadCreateSchema.safeParse({ ...base, name: '<script>alert(1)</script>' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain('Минимум 2 символа')
  })

  it('санитизирует заметку менеджера', () => {
    const parsed = leadUpdateSchema.parse({ note: '<b>Позвонили</b> — <script>x</script>перезвонить завтра' })
    expect(parsed.note).toBe('Позвонили — перезвонить завтра')
  })

  it('оставляет пустую заметку пустой', () => {
    expect(leadUpdateSchema.parse({ note: null }).note).toBeNull()
  })
})
