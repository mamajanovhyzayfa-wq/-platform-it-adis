import { z } from 'zod'

export const supportCreateSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(2).max(40).default('OTHER'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
})

export const supportUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  resolution: z.string().trim().max(2000).nullable().optional(),
})

export const supportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  search: z.string().trim().max(120).optional(),
})

export type SupportCreateInput = z.infer<typeof supportCreateSchema>
export type SupportUpdateInput = z.infer<typeof supportUpdateSchema>
