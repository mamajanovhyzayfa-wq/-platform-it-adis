import { z } from 'zod'

export const awardSchema = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().int().positive().max(100_000),
  reason: z.string().trim().min(3).max(300),
  sourceType: z.enum(['HOMEWORK', 'TEST', 'ATTENDANCE', 'ACHIEVEMENT', 'COURSE', 'MANUAL', 'QUEST', 'STREAK', 'SEASON', 'EVENT', 'LEVEL', 'ADJUSTMENT']).optional(),
  sourceId: z.string().max(120).optional(),
})

export const penaltySchema = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().int().positive().max(100_000),
  reason: z.string().trim().min(3).max(300),
})

export const appealSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
})

export const appealReviewSchema = z.object({
  approve: z.boolean(),
  resolution: z.string().trim().max(1000).optional(),
})

export const rulesSchema = z.object({
  dailyAwardLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  weeklyAwardLimit: z.coerce.number().int().min(1).max(500_000).optional(),
  teacherDailyLimit: z.coerce.number().int().min(0).max(100_000).optional(),
  maxManualAward: z.coerce.number().int().min(1).max(100_000).optional(),
  suspiciousAmount: z.coerce.number().int().min(1).max(500_000).optional(),
  penaltyApprovalThreshold: z.coerce.number().int().min(0).max(100_000).optional(),
  streakMinDailyActions: z.coerce.number().int().min(1).max(20).optional(),
  streakBonusEvery: z.coerce.number().int().min(1).max(100).optional(),
  streakBonusCoins: z.coerce.number().int().min(0).max(10_000).optional(),
})

export const achievementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(1000),
  rarity: z.enum(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']),
  category: z.string().trim().min(2).max(40),
  collection: z.string().trim().max(80).optional(),
  conditionType: z.string().trim().min(2).max(60),
  targetValue: z.coerce.number().int().positive().max(100_000),
  rewardCoins: z.coerce.number().int().min(0).max(10_000).default(0),
  iconUrl: z.string().url().max(500).optional(),
})

export const productSchema = z.object({
  title: z.string().trim().min(2).max(150),
  description: z.string().trim().min(3).max(2000),
  category: z.enum(['DIGITAL', 'DISCOUNT', 'MATERIAL', 'PRIVILEGE', 'PHYSICAL']),
  priceCoins: z.coerce.number().int().min(1).max(1_000_000),
  kind: z.enum(['DIGITAL', 'PHYSICAL']).default('DIGITAL'),
  fulfillment: z.enum(['AUTOMATIC', 'MANUAL']).optional(),
  imageUrl: z.string().url().max(500).optional(),
  terms: z.string().trim().max(2000).optional(),
  deliveryUrl: z.string().url().max(500).optional(),
  unlimitedStock: z.boolean().default(true),
  stock: z.coerce.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
})

export const productUpdateSchema = productSchema.partial()

export const orderSchema = z.object({
  productId: z.string().uuid(),
  comment: z.string().trim().max(500).optional(),
  deliveryDetails: z.string().trim().max(1000).optional(),
})

export const orderUpdateSchema = z.object({
  status: z.enum(['APPROVED', 'READY', 'ISSUED', 'REJECTED', 'CANCELLED']),
  deliveryDetails: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(500).optional(),
})
