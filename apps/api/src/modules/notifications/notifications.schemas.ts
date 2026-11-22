import { z } from 'zod'

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})

export const notificationChannelSchema = z
  .object({
    inApp: z.boolean(),
    push: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
  })
  .partial()

export const notificationPreferenceSchema = z
  .object({
    settings: z.record(z.string(), notificationChannelSchema).optional(),
    digest: z.enum(['NONE', 'DAILY', 'WEEKLY']).optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
  })
  .strict()

export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceSchema>
