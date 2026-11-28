import { http } from './client'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string | null
  href: string
}

interface StudentDashboard {
  courses: Array<{ id: string; title: string; coverUrl: string | null; level: string; progress: number; status: string }>
  upcoming: Array<{ id: string; title: string; course: string; startsAt: string; endsAt: string }>
  homework: Array<{ id: string; title: string; course: string; dueAt: string }>
  tests: Array<{ id: string; title: string; course: string; attempts: number; lastScore: number | null }>
  results: Array<{ id: string; kind: string; title: string; score: number; max: number; date: string | null }>
  progress: { lessonsCompleted: number; lessonsTotal: number; percent: number }
  coins: { balance: number; recent: Array<{ id: string; amount: number; reason: string; createdAt: string }> }
  achievements: Array<{ title: string; description: string; iconUrl: string | null; awardedAt: string }>
  notifications: { unread: number; items: NotificationItem[] }
}

interface MentorDashboard {
  groups: Array<{ id: string; title: string; status: string; students: number }>
  students: { total: number; items: Array<{ id: string; name: string }> }
  upcoming: Array<{ id: string; title: string; course: string; startsAt: string }>
  pendingReviews: { count: number; items: Array<{ id: string; title: string; student: string; submittedAt: string }> }
  stats: { groups: number; students: number; averageScore: number; attendanceRate: number }
  messages: { unread: number }
  notifications: { unread: number; items: NotificationItem[] }
}

interface ManagerDashboard {
  metrics: { students: number; teachers: number; activeGroups: number; newLeads: number; attendanceWeek: number }
  studentsList: Array<{ id: string; name: string; email: string }>
  groups: Array<{ id: string; title: string; teacher: string; students: number }>
  teachersList: Array<{ id: string; name: string; email: string }>
  upcoming: Array<{ id: string; title: string; course: string; startsAt: string }>
  leads: Array<{ id: string; name: string; phone: string; audience: string; createdAt: string }>
  notifications: { unread: number; items: NotificationItem[] }
}

interface ParentDashboard {
  children: Array<{
    id: string
    name: string
    email: string
    relation: string
    courses: Array<{ id: string; title: string; progress: number }>
    coins: number
    upcoming: Array<{ id: string; title: string; startsAt: string }>
    paidTotalKgs: number
    attendanceRate: number
    achievements: number
    homework: Array<{ id: string; title: string; course: string; dueAt: string }>
    results: Array<{ id: string; title: string; score: number | null; percent: number | null; submittedAt: string | null }>
  }>
  notifications: { unread: number; items: NotificationItem[] }
}

export const portalApi = {
  student: () => http.get<StudentDashboard>('/portal/student').then((response) => response.data),
  mentor: () => http.get<MentorDashboard>('/portal/mentor').then((response) => response.data),
  manager: () => http.get<ManagerDashboard>('/portal/manager').then((response) => response.data),
  parent: () => http.get<ParentDashboard>('/portal/parent').then((response) => response.data),
  search: (query: string) =>
    http
      .get<{ query: string; results: SearchResult[] }>('/portal/search', { params: { q: query } })
      .then((response) => response.data),
  notifications: () =>
    http
      .get<{ items: NotificationItem[]; total: number; unread: number }>('/notifications')
      .then((response) => response.data),
  readAll: () => http.post('/notifications/read-all').then((response) => response.data),
  read: (id: string) => http.patch(`/notifications/${id}/read`).then((response) => response.data),
}
