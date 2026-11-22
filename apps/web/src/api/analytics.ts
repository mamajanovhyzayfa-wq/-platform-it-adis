import { http } from './client'
import type { FinanceOverview } from './finance'

/** Аналитический центр: сервер уже применяет роль из access-токена. */
export interface AnalyticsTrendPoint {
  label: string
  attendanceRate: number | null
  averageScore: number | null
  applications?: number
}

export interface AnalyticsRiskStudent {
  userId: string
  name: string
  email: string
  attendanceRate?: number | null
  absenceRate?: number | null
  averageScore?: number | null
  reason: string
}

export interface AnalyticsOverview {
  role: 'STUDENT' | 'TEACHER' | 'MANAGER' | 'ADMIN'
  range: { from: string; to: string }
  metrics: Record<string, number>
  comparison?: Record<string, { current: number; previous: number; delta: number } | { from: string; to: string }>
  trend?: AnalyticsTrendPoint[]
  courses?: Array<{ id?: string; course?: string; title?: string; average?: number | null; attendanceRate?: number | null; progress?: number; students?: number; priceKgs?: number; income?: number }>
  groups?: Array<{ id: string; title: string; students: number; progress: number; lessons?: number; attendanceRate?: number }>
  students?: Array<{
    userId: string
    name: string
    email: string
    courses: string[]
    averageScore: number | null
    attendanceRate: number | null
  }>
  teachers?: Array<{ userId: string; name: string; email: string; isActive: boolean; lessonRateKgs?: number; lessons: number }>
  assignments?: Array<{ title: string; course: string; submittedAt: string; status: string; score: number | null; maxScore: number; percent: number | null }>
  achievements?: Array<{ title: string; description: string; iconUrl: string | null; awardedAt: string }>
  attendance?: { total: number; present: number; absent: number; late: number; rate: number }
  atRisk?: AnalyticsRiskStudent[]
  recommendations?: string[]
  strengths?: string[]
  weaknesses?: string[]
  needsSupport?: boolean
  supportReasons?: string[]
  applicationsByStatus?: Array<{ status: string; count: number }>
  finance?: FinanceOverview
  coins?: { total: number; note: string }
  forecast?: Record<string, number | string | null>
  profile?: { name: string; email: string; gradeLevel: number | null; schoolName: string | null } | null
}

export const analyticsApi = {
  overview: (params: { from: string; to: string }) =>
    http.get<AnalyticsOverview>('/analytics-center/overview', { params }).then((response) => response.data),
}
