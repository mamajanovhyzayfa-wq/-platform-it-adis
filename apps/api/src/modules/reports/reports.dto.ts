import { z } from 'zod'

export const reportRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type ReportRangeInput = z.infer<typeof reportRangeSchema>
