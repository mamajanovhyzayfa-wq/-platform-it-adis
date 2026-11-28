import { z } from 'zod'

export const backupRunSchema = z
  .object({
    branchId: z.string().min(1).optional(),
    kind: z.enum(['DATABASE', 'FILES']),
  })
  .strict()

export const backupSettingsSchema = z
  .object({
    backupEnabled: z.boolean().optional(),
    backupFrequencyHours: z.number().int().min(1).max(168).optional(),
    backupRetentionDays: z.number().int().min(1).max(365).optional(),
    backupIncludeFiles: z.boolean().optional(),
    fileMaxSizeMb: z.number().int().min(1).max(512).optional(),
    fileQuotaMb: z.number().int().min(1).max(1_048_576).optional(),
  })
  .refine(
    (value) =>
      value.fileMaxSizeMb === undefined ||
      value.fileQuotaMb === undefined ||
      value.fileQuotaMb >= value.fileMaxSizeMb,
    { message: 'Квота филиала не может быть меньше лимита одного файла', path: ['fileQuotaMb'] },
  )

export const backupRestoreSchema = z
  .object({
    branchId: z.string().min(1).optional(),
    backupId: z.string().min(1),
    filesBackupId: z.string().min(1).optional(),
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict()

export const backupApprovalSchema = z.object({
  phrase: z.string().trim().min(1).max(200),
})

export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>
