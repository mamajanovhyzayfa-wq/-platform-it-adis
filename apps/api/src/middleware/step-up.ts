import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'
import { verifyStepUpToken } from '../lib/security.js'

/**
 * Подтверждение личности для необратимых действий. Токен выдаётся после
 * повторного ввода пароля/2FA и живёт 10 минут; обычный access-токен не подходит.
 */
export function requireStepUp(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHORIZED', 'Требуется авторизация'))
    return
  }
  const token = req.headers['x-step-up-token']
  if (typeof token !== 'string' || !token) {
    next(new AppError(403, 'STEP_UP_REQUIRED', 'Подтвердите действие паролем или кодом 2FA'))
    return
  }
  try {
    if (verifyStepUpToken(token) !== req.auth.userId) {
      next(new AppError(403, 'STEP_UP_INVALID', 'Подтверждение не совпадает с текущим пользователем'))
      return
    }
    next()
  } catch {
    next(new AppError(403, 'STEP_UP_INVALID', 'Подтверждение истекло, повторите ввод пароля'))
  }
}
