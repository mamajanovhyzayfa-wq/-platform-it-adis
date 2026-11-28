import { http } from './client'

type CoinSource =
  | 'HOMEWORK' | 'TEST' | 'ATTENDANCE' | 'ACHIEVEMENT' | 'COURSE' | 'SHOP' | 'MANUAL'
  | 'QUEST' | 'STREAK' | 'SEASON' | 'EVENT' | 'PENALTY' | 'REFUND' | 'REVERSAL' | 'LEVEL' | 'ADJUSTMENT'

type CoinStatus = 'POSTED' | 'PENDING' | 'REJECTED' | 'REVERSED' | 'APPEALED'

interface CoinTransaction {
  id: string
  userId: string
  amount: number
  reason: string
  sourceType: CoinSource | null
  sourceId: string | null
  balanceAfter: number | null
  status: CoinStatus
  createdAt: string
  awardedById: string | null
  awardedBy?: { id: string; firstName: string; lastName: string } | null
  user?: { id: string; firstName: string; lastName: string; email: string; role?: string }
  appeal?: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string } | null
}

interface EconomyOverview {
  balance: number
  xp: number
  level: number
  levelTitle: string
  nextLevel: { title: string; thresholdXp: number } | null
  levelProgress: number
  streak: { current: number; best: number }
  profile: { lastActivityDate: string | null }
  recent: CoinTransaction[]
  achievements: Array<{ title: string; description: string; rarity: string; awardedAt: string }>
  quests: QuestItem[]
  season: Season | null
  unreadNotifications: number
}

export interface QuestItem {
  id: string
  code: string
  title: string
  description: string
  period: 'DAILY' | 'WEEKLY' | 'SEASON'
  progress: number
  target: number
  rewardCoins: number
  rewardXp: number
  completed: boolean
  claimedAt: string | null
  periodKey: string
}

interface Season {
  id: string
  title: string
  description: string
  theme: string
  startsAt: string
  endsAt: string
  points: number
  daysLeft: number
  quests: QuestItem[]
}

interface Achievement {
  id: string
  code: string
  title: string
  description: string
  iconUrl: string | null
  rarity: string
  category: string
  collection: string | null
  conditionType: string | null
  current: number
  target: number
  earnedAt: string | null
  rewardCoins: number
  level: string
}

interface LeaderboardGroup {
  courseId: string
  title: string
  members: Array<{ userId: string; name: string; earned: number; balance: number; level: number; rank: number }>
}

export interface ShopProduct {
  id: string
  title: string
  description: string
  imageUrl: string | null
  category: string
  priceCoins: number
  kind: 'DIGITAL' | 'PHYSICAL'
  fulfillment: 'AUTOMATIC' | 'MANUAL'
  unlimitedStock: boolean
  stock: number | null
  deliveryUrl: string | null
  terms: string | null
  isActive: boolean
  favorite: boolean
  available: boolean
}

export interface ShopOrder {
  id: string
  userId: string
  productId: string
  status: 'NEW' | 'APPROVED' | 'READY' | 'REJECTED' | 'ISSUED' | 'CANCELLED'
  priceCoins: number | null
  comment: string | null
  deliveryDetails: string | null
  rejectionReason: string | null
  createdAt: string
  product: ShopProduct
  user?: { id: string; firstName: string; lastName: string; email: string }
}

export interface CoinRules {
  dailyAwardLimit: number
  weeklyAwardLimit: number
  teacherDailyLimit: number
  maxManualAward: number
  suspiciousAmount: number
  penaltyApprovalThreshold: number
  streakMinDailyActions: number
  streakBonusEvery: number
  streakBonusCoins: number
}

interface ParentEconomy {
  student: { id: string; name: string }
  balance: number
  level: number
  xp: number
  streak: number
  achievements: number
  transactions: CoinTransaction[]
  total: number
  page: number
  limit: number
}

export const economyApi = {
  overview: () => http.get<EconomyOverview>('/economy/overview').then((r) => r.data),
  transactions: (params: Record<string, unknown>) =>
    http.get<{ items: CoinTransaction[]; total: number; page: number; limit: number; balance: number | null }>('/economy/transactions', { params }).then((r) => r.data),
  award: (payload: { userId: string; amount: number; reason: string }) =>
    http.post<CoinTransaction & { requiresApproval: boolean }>('/economy/awards', payload).then((r) => r.data),
  pending: () => http.get<CoinTransaction[]>('/economy/pending').then((r) => r.data),
  approve: (id: string) => http.post(`/economy/transactions/${id}/approve`).then((r) => r.data),
  reject: (id: string) => http.post(`/economy/transactions/${id}/reject`).then((r) => r.data),
  reverse: (id: string) => http.post(`/economy/transactions/${id}/reverse`).then((r) => r.data),
  penalty: (payload: { userId: string; amount: number; reason: string }) => http.post('/economy/penalties', payload).then((r) => r.data),
  appeal: (id: string, reason: string) => http.post(`/economy/transactions/${id}/appeal`, { reason }).then((r) => r.data),
  appeals: () => http.get<Array<{ id: string; reason: string; status: string; createdAt: string; transaction: CoinTransaction }>>('/economy/appeals').then((r) => r.data),
  reviewAppeal: (id: string, payload: { approve: boolean; resolution?: string }) => http.post(`/economy/appeals/${id}/review`, payload).then((r) => r.data),
  rules: () => http.get<CoinRules>('/economy/rules').then((r) => r.data),
  updateRules: (payload: Partial<CoinRules>) => http.patch<CoinRules>('/economy/rules', payload).then((r) => r.data),
  levels: () => http.get<Array<{ id: string; code: string; title: string; description: string; thresholdXp: number; position: number }>>('/economy/levels').then((r) => r.data),
  achievements: () => http.get<Achievement[]>('/economy/achievements').then((r) => r.data),
  checkAchievements: () => http.post<{ awarded: string[] }>('/economy/achievements/check').then((r) => r.data),
  createAchievement: (payload: Record<string, unknown>) => http.post('/economy/achievements', payload).then((r) => r.data),
  quests: () => http.get<{ quests: QuestItem[] }>('/economy/quests').then((r) => r.data),
  claimQuest: (id: string) => http.post(`/economy/quests/${id}/claim`).then((r) => r.data),
  season: () => http.get<Season | null>('/economy/season').then((r) => r.data),
  leaderboard: (courseId?: string) => http.get<{ groups: LeaderboardGroup[] }>('/economy/leaderboard', { params: { courseId } }).then((r) => r.data),
  parent: (studentId: string, page = 1) => http.get<ParentEconomy>(`/economy/parent/${studentId}`, { params: { page, limit: 25 } }).then((r) => r.data),
  products: (params: Record<string, unknown>) => http.get<ShopProduct[]>('/economy/shop/products', { params }).then((r) => r.data),
  favorite: (id: string) => http.post<{ favorite: boolean }>(`/economy/shop/products/${id}/favorite`).then((r) => r.data),
  createProduct: (payload: Record<string, unknown>) => http.post('/economy/shop/products', payload).then((r) => r.data),
  updateProduct: (id: string, payload: Record<string, unknown>) => http.patch(`/economy/shop/products/${id}`, payload).then((r) => r.data),
  orders: (params: Record<string, unknown>) =>
    http.get<{ items: ShopOrder[]; total: number; page: number; limit: number }>('/economy/shop/orders', { params }).then((r) => r.data),
  createOrder: (payload: { productId: string; comment?: string; deliveryDetails?: string }) => http.post<ShopOrder>('/economy/shop/orders', payload).then((r) => r.data),
  updateOrder: (id: string, payload: { status: string; deliveryDetails?: string; reason?: string }) => http.patch(`/economy/shop/orders/${id}`, payload).then((r) => r.data),
}
