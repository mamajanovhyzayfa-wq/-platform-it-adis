import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'

type RequestPart = 'body' | 'query' | 'params'

/** Валидация входа: результат разбора заменяет req[part] (query/params — приводим к объекту). */
export function validate(schema: ZodType, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part])
    if (!result.success) {
      next(result.error)
      return
    }
    if (part === 'body') {
      req.body = result.data
    } else {
      Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true })
    }
    next()
  }
}
