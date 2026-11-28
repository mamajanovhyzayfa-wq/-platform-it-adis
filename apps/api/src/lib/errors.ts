import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { sendAlert } from './notify-alert.js'

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details)
export const unauthorized = (message = 'Требуется авторизация') => new AppError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'Недостаточно прав') => new AppError(403, 'FORBIDDEN', message)
export const notFound = (message = 'Не найдено') => new AppError(404, 'NOT_FOUND', message)
export const payloadTooLarge = (message = 'Файл слишком большой') => new AppError(413, 'PAYLOAD_TOO_LARGE', message)
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message)
export const tooManyRequests = (message = 'Слишком много попыток, попробуйте позже') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message)

/**
 * Ошибка body-parser на битом JSON: у неё есть `.body` и статус 400.
 * Наружу отдаём понятный текст без позиции парсера и имён полей.
 */
export function isJsonSyntaxError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    (error as { status?: unknown }).status === 400 &&
    typeof (error as { body?: unknown }).body !== 'undefined'
  )
}

/** Единый ответ на некорректный JSON: код и текст одинаковы для Nest и Express. */
export function sendJsonParseError(res: Response) {
  res.status(400).json({
    error: { code: 'BAD_REQUEST', message: 'Некорректный формат JSON' },
  })
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isJsonSyntaxError(error)) {
    sendJsonParseError(res)
    return
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    })
    return
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Проверьте правильность заполнения полей',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    })
    return
  }

  console.error('[unhandled]', error)
  void sendAlert('Необработанная ошибка API', {
    method: _req.method,
    path: _req.path,
    error: error instanceof Error ? error.message : String(error),
  })
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } })
}
