import { describe, expect, it } from 'vitest'
import {
  checkPasswordStrength,
  hashPassword,
  newRefreshToken,
  sha256,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from '../src/lib/security.js'

describe('политика паролей', () => {
  it('отклоняет короткий пароль', () => {
    const result = checkPasswordStrength('Ab1')
    expect(result.valid).toBe(false)
    expect(result.problems).toContain('Минимум 8 символов')
  })

  it('требует заглавную букву и цифру', () => {
    expect(checkPasswordStrength('passwordonly').problems).toEqual(
      expect.arrayContaining(['Хотя бы одна заглавная буква', 'Хотя бы одна цифра']),
    )
  })

  it('принимает сложный пароль', () => {
    expect(checkPasswordStrength('ITadis2026')).toEqual({ valid: true, problems: [] })
  })
})

describe('хеширование пароля', () => {
  it('не хранит пароль в открытом виде и проверяет его', async () => {
    const hash = await hashPassword('ITadis2026')
    expect(hash).not.toContain('ITadis2026')
    expect(await verifyPassword('ITadis2026', hash)).toBe(true)
    expect(await verifyPassword('wrong-pass1', hash)).toBe(false)
  })
})

describe('токены', () => {
  it('выпускает и проверяет access-токен', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'STUDENT', email: 'student@itadis.kg' })
    expect(verifyAccessToken(token)).toMatchObject({ sub: 'user-1', role: 'STUDENT' })
  })

  it('не принимает испорченный токен', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'STUDENT', email: 'student@itadis.kg' })
    expect(() => verifyAccessToken(`${token}x`)).toThrow()
  })

  it('генерирует уникальные refresh-токены и стабильный хеш', () => {
    const a = newRefreshToken()
    const b = newRefreshToken()
    expect(a).not.toBe(b)
    expect(sha256(a)).toBe(sha256(a))
    expect(sha256(a)).not.toBe(a)
  })
})
