import { describe, expect, it } from 'vitest'
import { clearFailedLogins, isLoginLocked, recordFailedLogin } from '../src/lib/captcha.js'
import { decryptSensitive, encryptSensitive } from '../src/lib/crypto.js'
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

describe('защита от перебора', () => {
  it('блокирует вход после десяти ошибок и снимает блокировку после успеха', () => {
    const key = `test:${Date.now()}:${Math.random()}`
    for (let attempt = 0; attempt < 9; attempt += 1) recordFailedLogin(key)
    expect(isLoginLocked(key)).toBe(false)
    recordFailedLogin(key)
    expect(isLoginLocked(key)).toBe(true)
    clearFailedLogins(key)
    expect(isLoginLocked(key)).toBe(false)
  })
})

describe('шифрование чувствительных полей', () => {
  it('не хранит значение открытым и расшифровывает обратно', () => {
    const encrypted = encryptSensitive('+996700000000')
    expect(encrypted).not.toContain('+996700000000')
    expect(encrypted).toMatch(/^enc:v1:/)
    expect(decryptSensitive(encrypted)).toBe('+996700000000')
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
