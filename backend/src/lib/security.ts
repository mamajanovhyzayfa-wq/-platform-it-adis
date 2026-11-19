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

export interface PasswordCheck {
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

export interface AccessTokenPayload {
  sub: string
  role: RoleName
  email: string
}

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
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
