/** Общие контракты клиентов и API. Не импортируют Prisma или React. */

export const ROLES = ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'] as const
export type Role = (typeof ROLES)[number]

export const MODULE_NAMES = [
  'Auth',
  'Users',
  'Roles',
  'Branches',
  'Students',
  'Mentors',
  'Managers',
  'Parents',
  'Groups',
  'Courses',
  'Lessons',
  'Materials',
  'Homework',
  'Tests',
  'Exams',
  'Schedule',
  'Classrooms',
  'Attendance',
  'LiveDigital',
  'AIHub',
  'AIAutomation',
  'ITCoins',
  'RewardsStore',
  'Achievements',
  'Competitions',
  'Payments',
  'Finance',
  'Invoices',
  'Expenses',
  'Messaging',
  'Notifications',
  'Certificates',
  'Analytics',
  'Files',
  'Audit',
  'Consent',
  'Cookie',
  'Support',
  'Reports',
  'Backup',
  'Integrations',
] as const
export type ModuleName = (typeof MODULE_NAMES)[number]

export interface Paginated<T> {
  data: T[]
  page: number
  limit: number
  total: number
  pages: number
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Array<{ path: string; message: string }>
  }
}

export interface AuthUser {
  userId: string
  role: Role
  email: string
}

export type FileCategory = 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF' | 'PRESENTATION' | 'ARCHIVE' | 'OTHER'
export type BackupStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type SupportTicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
