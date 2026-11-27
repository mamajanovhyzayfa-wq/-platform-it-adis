import type { NextFunction, Request, Response } from 'express'
import { badRequest } from './errors.js'

/**
 * Отклоняет NUL-байт в теле, query и параметрах маршрута.
 *
 * PostgreSQL не принимает 0x00 внутри text/varchar: запрос падает с
 * `invalid byte sequence for encoding "UTF8": 0x00`, Prisma превращает это в
 * PrismaClientUnknownRequestError, и клиент получает 500 вместо 400 — плюс
 * каждый такой запрос поднимает алерт. Проверка стоит перед маршрутами, поэтому
 * закрывает весь класс полей сразу, а не только identifier во входе.
 *
 * Строки с NUL не бывают осмысленными ни в одном поле API: email, телефон,
 * имя, поиск, идентификатор филиала.
 */
const NUL = '\u0000'

export function containsNulByte(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof value === 'string') return value.includes(NUL)
  if (Array.isArray(value)) return value.some((item) => containsNulByte(item, depth + 1))
  if (value === null || typeof value !== 'object') return false
  // Буферы (raw-тело вебхуков) проверяются побайтно на вызывающей стороне.
  if (Buffer.isBuffer(value)) return value.includes(0)
  return Object.values(value).some((item) => containsNulByte(item, depth + 1))
}

export function rejectNulBytes(req: Request, _res: Response, next: NextFunction) {
  if (containsNulByte(req.body) || containsNulByte(req.query) || containsNulByte(req.params)) {
    next(badRequest('Запрос содержит недопустимый символ NUL'))
    return
  }
  next()
}
