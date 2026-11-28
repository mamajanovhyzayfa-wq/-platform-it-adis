import { Injectable, type PipeTransform } from '@nestjs/common'
import { z, ZodError } from 'zod'
import { AppError } from '../../lib/errors.js'

/**
 * Валидация тела/параметров запроса zod-схемой.
 *
 * Проект описывает контракты через zod (те же схемы использует мобильное
 * приложение), поэтому zod-схемы переиспользуются в Nest вместо class-validator.
 * Некорректные данные дают 422 с перечнем полей — формат совпадает с Express-слоем.
 */
@Injectable()
class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Проверьте правильность заполнения полей',
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        )
      }
      throw error
    }
  }
}

/** Короткая форма: `@Body(zodBody(loginSchema)) body: LoginInput`. */
export const zodBody = (schema: z.ZodType) => new ZodValidationPipe(schema)
