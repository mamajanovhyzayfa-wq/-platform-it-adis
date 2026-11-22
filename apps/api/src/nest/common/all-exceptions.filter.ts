import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../../lib/errors.js'
import { sendAlert } from '../../lib/notify-alert.js'

/**
 * Приводит все ошибки Nest к единому формату API:
 * { error: { code, message, details } }.
 *
 * Тот же формат отдаёт Express-слой (`errorHandler`) для ещё не перенесённых
 * модулей, поэтому клиенты не видят разницы между Nest- и Express-маршрутами.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      })
      return
    }

    if (exception instanceof ZodError) {
      response.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте правильность заполнения полей',
          details: exception.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      })
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const payload = exception.getResponse()
      const details = typeof payload === 'object' ? payload : { message: payload }
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message)
      response.status(status).json({
        error: {
          code: CODE_BY_STATUS[status] ?? 'ERROR',
          message: Array.isArray(message) ? message.join('; ') : message,
          details: status === HttpStatus.NOT_FOUND ? undefined : details,
        },
      })
      return
    }

    const request = host.switchToHttp().getRequest<Request>()
    this.logger.error('Необработанная ошибка', exception instanceof Error ? exception.stack : String(exception))
    void sendAlert('Необработанная ошибка API', {
      method: request.method,
      path: request.path,
      error: exception instanceof Error ? exception.message : String(exception),
    })
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } })
  }
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
}
