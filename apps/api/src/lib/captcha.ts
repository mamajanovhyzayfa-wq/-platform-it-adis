import { randomUUID } from 'node:crypto'

/**
 * Локальная CAPTCHA для подозрительной активности.
 * Хранится в памяти процесса: это защита от простого перебора, а не замена WAF.
 */
interface Challenge {
  answer: string
  expiresAt: number
}

const challenges = new Map<string, Challenge>()
const failures = new Map<string, { count: number; firstAt: number }>()
const CAPTCHA_AFTER = 5
const LOCKOUT_AFTER = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const CHALLENGE_TTL_MS = 10 * 60 * 1000

function cleanup(now = Date.now()) {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt < now) challenges.delete(id)
  }
  for (const [key, record] of failures) {
    if (now - record.firstAt > FAILURE_WINDOW_MS) failures.delete(key)
  }
}

export function createCaptcha(): { id: string; question: string; expiresInSeconds: number } {
  cleanup()
  const left = 2 + Math.floor(Math.random() * 8)
  const right = 1 + Math.floor(Math.random() * 8)
  const plus = Math.random() > 0.5
  const answer = plus ? left + right : Math.max(left, right) - Math.min(left, right)
  const id = randomUUID()
  challenges.set(id, { answer: String(answer), expiresAt: Date.now() + CHALLENGE_TTL_MS })
  return {
    id,
    question: plus
      ? `Сколько будет ${left} + ${right}?`
      : `Сколько будет ${Math.max(left, right)} − ${Math.min(left, right)}?`,
    expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  }
}

/** Проверка одноразовая: после успешной проверки challenge удаляется. */
export function verifyCaptcha(id: string | undefined, answer: string | undefined): boolean {
  if (!id || !answer) return false
  cleanup()
  const challenge = challenges.get(id)
  if (!challenge) return false
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(id)
    return false
  }
  if (challenge.answer !== answer.trim()) return false
  challenges.delete(id)
  return true
}

export function failedLoginKey(ip: string | null | undefined, identifier: string): string {
  return `${ip ?? 'unknown'}:${identifier.trim().toLowerCase()}`
}

export function recordFailedLogin(key: string): number {
  cleanup()
  const now = Date.now()
  const current = failures.get(key)
  if (!current || now - current.firstAt > FAILURE_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now })
    return 1
  }
  current.count += 1
  return current.count
}

export function clearFailedLogins(key: string) {
  failures.delete(key)
}

/** После серии ошибок вход требует CAPTCHA. */
export function isCaptchaRequired(key: string): boolean {
  cleanup()
  const current = failures.get(key)
  if (!current) return false
  return current.count >= CAPTCHA_AFTER
}

/**
 * После десяти ошибок вход временно блокируется. Ключ без IP не даёт обойти
 * защиту сменой адреса; CAPTCHA при этом остаётся отдельным барьером.
 */
export function isLoginLocked(key: string): boolean {
  cleanup()
  const current = failures.get(key)
  if (!current) return false
  return current.count >= LOCKOUT_AFTER
}

export function accountFailureKey(identifier: string): string {
  return `account:${identifier.trim().toLowerCase()}`
}
