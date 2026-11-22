import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { isSecretName } from '../../integrations/core/secrets.js'

/** Единый формат ошибки валидации API: 422 + список полей. */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Проверьте правильность заполнения полей',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/**
 * Настройка интеграции. Значения секретов сюда не передаются: только имена
 * переменных окружения, которые администратор задаёт на сервере.
 */
export const integrationUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    secretEnvVars: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'Ожидается имя переменной окружения'))
      .max(20)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Нужно хотя бы одно поле' })
  // Секреты живут в переменных окружения сервера: в settings допускаются
  // только несекретные параметры (регион, календарь, тестовый режим).
  .refine((value) => !value.settings || !Object.keys(value.settings).some(isSecretName), {
    message: 'Секреты задаются переменными окружения, а не в настройках',
    path: ['settings'],
  })

export const integrationEventsQuerySchema = z
  .object({
    provider: z.string().trim().max(60).optional(),
    status: z.enum(['OK', 'FAILED', 'SKIPPED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export const accountingEntrySchema = z
  .object({
    type: z.enum(['invoice', 'payment', 'refund', 'expense']),
    number: z.string().trim().min(1).max(60),
    amount: z.number().int().min(1),
    currency: z.literal('KGS').default('KGS'),
    occurredAt: z.string().datetime(),
    counterparty: z.string().trim().max(200).optional(),
    description: z.string().trim().max(500).optional(),
    externalId: z.string().uuid().optional(),
  })
  .strict()

export type IntegrationUpdateInput = z.infer<typeof integrationUpdateSchema>
export type IntegrationEventsQuery = z.infer<typeof integrationEventsQuerySchema>
export type AccountingEntryInput = z.infer<typeof accountingEntrySchema>
