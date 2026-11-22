import { z } from 'zod'

/** Единый контракт пагинации для web, mobile и admin API. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
})

export const idSchema = z.string().uuid()
export const isoDateSchema = z.coerce.date()

export const dateRangeSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

export const emailSchema = z.string().trim().toLowerCase().email().max(254)
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Некорректный номер телефона')

export type PaginationInput = z.infer<typeof paginationSchema>
export type DateRangeInput = z.infer<typeof dateRangeSchema>
