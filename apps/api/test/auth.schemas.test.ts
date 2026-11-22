import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from '../src/modules/auth/auth.schemas.js'
import { registrationApplySchema } from '../src/modules/access/access.schemas.js'

const base = {
  firstName: 'Адис',
  lastName: 'Исаков',
  email: 'Student@ITAdis.kg',
  birthDate: '1990-01-15',
  password: 'ITadis2026',
  passwordRepeat: 'ITadis2026',
  acceptTerms: true,
  acceptPrivacy: true,
  acceptDataProcessing: true,
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

  it('требует согласия с условиями, политикой и обработкой данных', () => {
    expect(registerSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, acceptPrivacy: false }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, acceptDataProcessing: false }).success).toBe(false)
  })

  it('требует дату рождения', () => {
    const { birthDate: _birthDate, ...withoutBirthDate } = base
    expect(registerSchema.safeParse(withoutBirthDate).success).toBe(false)
  })

  it('требует представителя и его подтверждение для несовершеннолетнего', () => {
    const birthDate = new Date()
    birthDate.setFullYear(birthDate.getFullYear() - 15)
    const withoutGuardian = registerSchema.safeParse({ ...base, birthDate })
    expect(withoutGuardian.success).toBe(false)

    const withoutConfirmation = registerSchema.safeParse({
      ...base,
      birthDate,
      guardianName: 'Исаков Адис',
      guardianPhone: '+996700000000',
    })
    expect(withoutConfirmation.success).toBe(false)

    const withGuardian = registerSchema.safeParse({
      ...base,
      birthDate,
      guardianName: 'Исаков Адис',
      guardianPhone: '+996700000000',
      guardianConsent: true,
    })
    expect(withGuardian.success).toBe(true)
  })

  it('отклоняет слабый пароль', () => {
    const result = registerSchema.safeParse({ ...base, password: 'weakpass', passwordRepeat: 'weakpass' })
    expect(result.success).toBe(false)
  })
})

describe('заявка на регистрацию', () => {
  it('принимает дату рождения строкой и требует представителя для несовершеннолетнего', () => {
    const birthDate = new Date()
    birthDate.setFullYear(birthDate.getFullYear() - 15)
    const isoDate = birthDate.toISOString().slice(0, 10)

    expect(registrationApplySchema.safeParse({ ...base, birthDate: isoDate }).success).toBe(false)
    expect(
      registrationApplySchema.safeParse({
        ...base,
        birthDate: isoDate,
        guardianName: 'Исаков Адис',
        guardianPhone: '+996700000000',
        guardianConsent: true,
      }).success,
    ).toBe(true)
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
