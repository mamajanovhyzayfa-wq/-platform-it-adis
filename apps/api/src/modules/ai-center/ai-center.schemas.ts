import { z } from 'zod'

export const aiRunSchema = z.object({
  feature: z.string().trim().min(3).max(100),
  message: z.string().trim().max(4000).optional(),
  courseId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  homeworkId: z.string().uuid().optional(),
  submissionId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  language: z.enum(['ru', 'ky', 'en']).optional(),
  externalUrls: z.array(z.string().url()).max(5).optional(),
  conversationId: z.string().max(100).optional(),
  voice: z.boolean().optional(),
})

export const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().trim().max(40).optional(),
  model: z.string().trim().max(80).optional(),
  dailyDefault: z.coerce.number().int().min(1).max(10000).optional(),
  maxTokens: z.coerce.number().int().min(100).max(100000).optional(),
  allowExternalSources: z.boolean().optional(),
  featurePermissions: z.record(z.string(), z.array(z.string())).optional(),
})

export const aiRoleLimitSchema = z.object({
  dailyRequests: z.coerce.number().int().min(0).max(100000).optional(),
  monthlyTokens: z.coerce.number().int().min(0).max(100000000).optional(),
  allowedFeatures: z.array(z.string()).optional(),
  model: z.string().trim().max(80).optional(),
})

export const aiUserLimitSchema = aiRoleLimitSchema.extend({
  dailyRequests: z.union([z.literal(''), z.coerce.number().int().min(0).max(100000)]).optional(),
  monthlyTokens: z.union([z.literal(''), z.coerce.number().int().min(0).max(100000000)]).optional(),
})

export const aiFlagSchema = z.object({
  feedback: z.string().trim().min(5).max(2000),
})

export const aiResolveSchema = z.object({
  resolution: z.string().trim().min(3).max(2000),
})

export const automationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional(),
  enabled: z.boolean().optional(),
  triggerType: z.enum(['MANUAL', 'LEAD_CREATED', 'LOW_ATTENDANCE', 'PENDING_REVIEW', 'SCHEDULE']).default('MANUAL'),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditions: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
  schedule: z.string().trim().max(100).optional(),
  requiresApproval: z.boolean().optional(),
})

export const automationUpdateSchema = automationSchema.partial()

export const automationRunSchema = z.object({
  approved: z.boolean().optional(),
})
