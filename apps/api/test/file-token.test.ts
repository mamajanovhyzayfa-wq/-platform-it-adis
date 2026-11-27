import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'
import { FILE_TOKEN_TTL, signFileToken, verifyFileToken } from '../src/lib/security.js'

const fileName = 'homework.pdf'

function decode(token: string): jwt.JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload
}

describe('подписанная ссылка на вложение (S-2)', () => {
  it('живёт 15 минут, а не 365 дней', () => {
    expect(FILE_TOKEN_TTL).toBe('15m')
    const payload = decode(signFileToken(fileName, 'student-1'))
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(15 * 60)
  })

  it('содержит имя файла и владельца в sub', () => {
    const payload = decode(signFileToken(fileName, 'student-1'))
    expect(payload).toMatchObject({ scope: 'file', name: fileName, sub: 'student-1' })
  })

  it('проверяется вместе с именем файла', () => {
    expect(verifyFileToken(signFileToken(fileName, 'student-1'), fileName)).toMatchObject({ sub: 'student-1' })
    expect(verifyFileToken(signFileToken(fileName, 'student-1'), 'other.pdf')).toBeNull()
  })

  it('токен другого владельца возвращает его sub, а не подменяет текущего', () => {
    expect(verifyFileToken(signFileToken(fileName, 'student-2'), fileName)?.sub).toBe('student-2')
  })

  it('истёкшая ссылка отклоняется', () => {
    const expired = jwt.sign(
      { scope: 'file', name: fileName, sub: 'student-1' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '-1s' },
    )
    expect(verifyFileToken(expired, fileName)).toBeNull()
  })

  it('ссылка старого формата без sub отклоняется', () => {
    const legacy = jwt.sign({ scope: 'file', name: fileName }, env.JWT_ACCESS_SECRET, { expiresIn: '365d' })
    expect(verifyFileToken(legacy, fileName)).toBeNull()
  })

  it('токен другого назначения не принимается как файловый', () => {
    const stepUp = jwt.sign({ scope: 'step-up', sub: 'student-1', name: fileName }, env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
    })
    expect(verifyFileToken(stepUp, fileName)).toBeNull()
  })

  it('испорченная подпись отклоняется', () => {
    const token = signFileToken(fileName, 'student-1')
    expect(verifyFileToken(`${token}x`, fileName)).toBeNull()
  })
})
