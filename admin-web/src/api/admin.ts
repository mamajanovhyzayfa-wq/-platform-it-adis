import { http } from './client'

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'

export interface Dashboard {
  users: { students: number; teachers: number; admins: number; total: number }
  courses: { active: number; draft: number; completedEnrollments: number }
  upcomingLessons: number
  homeworkTotal: number
  activity: { newUsers: number; activeLastWeek: number }
  recentAudit: Array<{ id: string; action: string; entity: string; createdAt: string; actor: string }>
}

export interface AdminUser {
  id: string
  email: string
  phone: string | null
  firstName: string
  lastName: string
  role: Role
  isActive: boolean
  emailVerified: boolean
  lastLoginAt: string | null
  createdAt: string
  courses: number
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export interface AdminCourse {
  id: string
  title: string
  description: string
  level: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  startDate: string | null
  createdAt: string
  teacher: string
  enrollments: number
  modules: number
}

export interface AuditEntry {
  id: string
  action: string
  entity: string
  entityId: string | null
  metadata: unknown
  ip: string | null
  createdAt: string
  actor: string
  actorEmail: string | null
}

export interface AdminSubmission {
  id: string
  status: 'SUBMITTED' | 'REVIEWED' | 'RETURNED'
  attempt: number
  score: number | null
  submittedAt: string
  text: string | null
  projectUrl: string | null
  files: Array<{ name: string; url: string }> | null
  student: { id: string; firstName: string; lastName: string; email: string }
  homework: { id: string; title: string; maxScore: number; course: { id: string; title: string } }
  review: { score: number; comment: string | null; createdAt: string } | null
}

export interface AdminTestAttempt {
  id: string
  status: string
  score: number | null
  passed: boolean | null
  startedAt: string
  submittedAt: string | null
  student: { id: string; firstName: string; lastName: string; email: string }
  test: { id: string; title: string; passingScore: number; course: { id: string; title: string } }
}

export interface AdminCoinTransaction {
  id: string
  amount: number
  reason: string
  sourceType: 'HOMEWORK' | 'TEST' | 'ATTENDANCE' | 'ACHIEVEMENT' | 'SHOP' | 'MANUAL' | null
  sourceId: string | null
  createdAt: string
  user: { id: string; firstName: string; lastName: string; email: string }
}

export interface AdminScheduleItem {
  id: string
  title: string
  startsAt: string
  endsAt: string
  status: string
  hasRoom: boolean
  course: { id: string; title: string }
  teacher: string
}

export interface AdminShopOrder {
  id: string
  status: 'NEW' | 'APPROVED' | 'ISSUED' | 'REJECTED'
  comment: string | null
  createdAt: string
  product: { id: string; title: string; priceCoins: number; category: string }
  user: { id: string; firstName: string; lastName: string; email: string }
}

export interface Analytics {
  enrollments: Record<string, number>
  submissions: Record<string, number>
  testAttempts: { total: number; averageScore: number }
  attendance: { sessions: number; totalMinutes: number }
  activeStudents: number
  popularCourses: Array<{ id: string; title: string; status: string; enrollments: number }>
}

export const adminApi = {
  login: (identifier: string, password: string) =>
    http
      .post('/auth/login', { identifier, password })
      .then((response) => response.data as { user: { id: string; email: string; firstName: string; lastName: string; role: Role }; tokens: { accessToken: string } }),

  dashboard: () => http.get<Dashboard>('/admin/dashboard').then((response) => response.data),

  users: (params: { page: number; limit: number; search?: string; role?: Role | '' }) =>
    http
      .get<Paginated<AdminUser>>('/admin/users', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.search ? { search: params.search } : {}),
          ...(params.role ? { role: params.role } : {}),
        },
      })
      .then((response) => response.data),

  updateUser: (id: string, payload: { role?: Role; isActive?: boolean }) =>
    http.patch(`/admin/users/${id}`, payload).then((response) => response.data),

  courses: (params: { page: number; limit: number; search?: string; status?: string }) =>
    http
      .get<Paginated<AdminCourse>>('/admin/courses', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.search ? { search: params.search } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
      })
      .then((response) => response.data),

  analytics: () => http.get<Analytics>('/admin/analytics').then((response) => response.data),

  submissions: (params: { page: number; limit: number; status: 'SUBMITTED' | 'REVIEWED' | 'RETURNED' | 'ALL'; search?: string }) =>
    http
      .get<Paginated<AdminSubmission>>('/admin/submissions', {
        params: {
          page: params.page,
          limit: params.limit,
          status: params.status,
          ...(params.search ? { search: params.search } : {}),
        },
      })
      .then((response) => response.data),

  testAttempts: (params: { page: number; limit: number }) =>
    http
      .get<Paginated<AdminTestAttempt>>('/admin/test-attempts', { params })
      .then((response) => response.data),

  coinTransactions: (params: {
    page: number
    limit: number
    sourceType?: AdminCoinTransaction['sourceType'] | ''
    search?: string
  }) =>
    http
      .get<Paginated<AdminCoinTransaction> & { totals: { awarded: number; spent: number } }>('/admin/coin-transactions', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.sourceType ? { sourceType: params.sourceType } : {}),
          ...(params.search ? { search: params.search } : {}),
        },
      })
      .then((response) => response.data),

  schedule: (params: { from: string; to: string }) =>
    http
      .get<{ items: AdminScheduleItem[]; range: { from: string; to: string } }>('/admin/schedule', { params })
      .then((response) => response.data),

  shopOrders: (params: { page: number; limit: number; status: 'NEW' | 'APPROVED' | 'ISSUED' | 'REJECTED' | 'ALL' }) =>
    http
      .get<Paginated<AdminShopOrder>>('/admin/shop-orders', { params })
      .then((response) => response.data),

  /** Модерация заявки: при отклонении сервер сам возвращает монеты и остаток. */
  updateShopOrder: (id: string, status: 'APPROVED' | 'ISSUED' | 'REJECTED') =>
    http.patch(`/shop/orders/${id}`, { status }).then((response) => response.data),

  auditLogs: (params: { page: number; limit: number; action?: string; entity?: string }) =>
    http
      .get<Paginated<AuditEntry>>('/admin/audit-logs', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.action ? { action: params.action } : {}),
          ...(params.entity ? { entity: params.entity } : {}),
        },
      })
      .then((response) => response.data),
}
