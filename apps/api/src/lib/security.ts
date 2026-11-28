import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import type { RoleName } from '@prisma/client'

const BCRYPT_ROUNDS = 12

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

interface PasswordCheck {
  valid: boolean
  problems: string[]
}

/** Требования к паролю: длина, регистр, цифра. Используется и на клиенте, и на сервере. */
export function checkPasswordStrength(password: string): PasswordCheck {
  const problems: string[] = []
  if (password.length < 8) problems.push('Минимум 8 символов')
  if (!/[a-zа-яё]/i.test(password)) problems.push('Хотя бы одна буква')
  if (!/[A-ZА-ЯЁ]/.test(password)) problems.push('Хотя бы одна заглавная буква')
  if (!/\d/.test(password)) problems.push('Хотя бы одна цифра')
  return { valid: problems.length === 0, problems }
}

interface AccessTokenPayload {
  sub: string
  role: RoleName
  email: string
  /** Филиал, в БД которого существует пользователь. Старые токены могут не содержать поле. */
  branchId?: string
}

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
}

interface PlatformTokenPayload {
  scope: 'platform'
  email: string
}

/** Отдельный токен консоли главного администратора: не даёт доступа к данным филиалов. */
export function signPlatformToken(email: string) {
  return jwt.sign({ scope: 'platform', email }, env.JWT_ACCESS_SECRET, { expiresIn: '4h' })
}

export function verifyPlatformToken(token: string): PlatformTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as Partial<PlatformTokenPayload>
  if (payload.scope !== 'platform' || typeof payload.email !== 'string') {
    throw new Error('Токен не является токеном консоли')
  }
  return { scope: 'platform', email: payload.email }
}

interface StepUpPayload {
  scope: 'step-up'
  sub: string
}

/** Короткоживущее подтверждение личности для важных операций (10 минут). */
export function signStepUpToken(userId: string) {
  return jwt.sign({ scope: 'step-up', sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' })
}

export function verifyStepUpToken(token: string): string {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as Partial<StepUpPayload>
  if (payload.scope !== 'step-up' || typeof payload.sub !== 'string') {
    throw new Error('Токен подтверждения недействителен')
  }
  return payload.sub
}

/** Время жизни подписанной ссылки на вложение. */
export const FILE_TOKEN_TTL = '15m'

interface FileTokenPayload {
  scope: 'file'
  name: string
  /** Владелец файла: ссылка действительна только для его вложения. */
  sub: string
}

/**
 * Короткоживущая подпись ссылки на вложение: привязана к имени файла и владельцу.
 *
 * 15 минут достаточно, чтобы открыть файл сразу после загрузки, а утёкшая
 * ссылка перестаёт работать и не даёт вечного доступа (раньше было 365 дней).
 */
export function signFileToken(fileName: string, ownerId: string) {
  return jwt.sign({ scope: 'file', name: fileName, sub: ownerId }, env.JWT_ACCESS_SECRET, {
    expiresIn: FILE_TOKEN_TTL,
  })
}

/**
 * Проверяет подпись, срок и имя файла. Возвращает владельца из `sub` либо null.
 * Токены старого формата (без `sub`) отклоняются: их нельзя привязать к владельцу.
 */
export function verifyFileToken(token: string, fileName: string): FileTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as Partial<FileTokenPayload>
    if (payload.scope !== 'file' || payload.name !== fileName) return null
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    return { scope: 'file', name: payload.name, sub: payload.sub }
  } catch {
    return null
  }
}

/** Промежуточный токен после пароля, когда включена двухфакторная аутентификация. */
export function signTwoFactorChallenge(userId: string) {
  return jwt.sign({ scope: '2fa', sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' })
}

export function verifyTwoFactorChallenge(token: string): string {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as Partial<{ scope: string; sub: string }>
  if (payload.scope !== '2fa' || typeof payload.sub !== 'string') {
    throw new Error('Запрос двухфакторной проверки недействителен')
  }
  return payload.sub
}

export function newRefreshToken() {
  return randomBytes(48).toString('base64url')
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function refreshExpiryDate() {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export function safeCompare(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
