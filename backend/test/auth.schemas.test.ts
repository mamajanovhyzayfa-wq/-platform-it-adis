import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from '../src/modules/auth/auth.schemas.js'

const base = {
  firstName: 'Адис',
  lastName: 'Исаков',
  email: 'Student@ITAdis.kg',
  password: 'ITadis2026',
  passwordRepeat: 'ITadis2026',
  acceptTerms: true,
  acceptPrivacy: true,
}

describe('схема регистрации', () => {
  it('приводит email к нижнему регистру', () => {
    const parsed = registerSchema.parse(base)
    expect(parsed.email).toBe('student@itadis.kg')
  })

  it('не принимает несовпадающие пароли', () => {
    const result = registerSchema.safeParse({ ...base, passwordRepeat: 'ITadis2027' })
    expect(result.success).toBe(false)
  })

  it('требует согласия с условиями и политикой', () => {
    expect(registerSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, acceptPrivacy: false }).success).toBe(false)
  })

  it('требует представителя для несовершеннолетнего', () => {
    const birthDate = new Date()
    birthDate.setFullYear(birthDate.getFullYear() - 15)
    const withoutGuardian = registerSchema.safeParse({ ...base, birthDate })
    expect(withoutGuardian.success).toBe(false)

    const withGuardian = registerSchema.safeParse({
      ...base,
      birthDate,
      guardianName: 'Исаков Адис',
      guardianPhone: '+996700000000',
    })
    expect(withGuardian.success).toBe(true)
  })

  it('отклоняет слабый пароль', () => {
    const result = registerSchema.safeParse({ ...base, password: 'weakpass', passwordRepeat: 'weakpass' })
    expect(result.success).toBe(false)
  })
})

describe('схема входа', () => {
  it('принимает email и пароль', () => {
    expect(loginSchema.safeParse({ identifier: 'student@itadis.kg', password: 'ITadis2026' }).success).toBe(true)
  })

  it('требует пароль', () => {
    expect(loginSchema.safeParse({ identifier: 'student@itadis.kg', password: '' }).success).toBe(false)
  })
})
