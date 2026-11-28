import { http } from './client'

interface ReportPeriod {
  from: string
  to: string
}

interface OverviewReport {
  period: ReportPeriod
  users: Record<string, number>
  courses: Record<string, number>
  activeEnrollments: number
  /** Финансовые показатели приходят только администратору. */
  finance?: { revenue: number; expenses: number; margin: number; paymentsCount: number; expensesCount: number }
  certificatesIssued: number
  openSupportTickets: number
  attendance: Record<string, number>
}

interface FinanceReport {
  period: ReportPeriod
  payments: Array<{ method: string; amount: number; count: number }>
  expenses: Array<{ category: string; amount: number; count: number }>
  refunds: { amount: number; count: number }
  outstandingInvoices: { amount: number; count: number }
}

interface AcademicReport {
  period: ReportPeriod
  attendance: Record<string, number>
  submissions: Record<string, number>
  testAttempts: { averagePercent: number; count: number }
  publishedCourses: number
}

export const reportsApi = {
  overview: (params: { from: string; to: string }) =>
    http.get<OverviewReport>('/reports/overview', { params }).then((response) => response.data),

  finance: (params: { from: string; to: string }) =>
    http.get<FinanceReport>('/reports/finance', { params }).then((response) => response.data),

  academic: (params: { from: string; to: string }) =>
    http.get<AcademicReport>('/reports/academic', { params }).then((response) => response.data),
}
