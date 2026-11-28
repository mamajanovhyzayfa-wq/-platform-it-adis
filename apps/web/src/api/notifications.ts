import { http } from './client'

type NotificationChannelKey = 'inApp' | 'push' | 'email' | 'sms'

export interface NotificationChannels {
  inApp: boolean
  push: boolean
  email: boolean
  sms: boolean
}

interface NotificationPreferences {
  settings: Record<string, NotificationChannels>
  digest: 'NONE' | 'DAILY' | 'WEEKLY'
  digestHour: number
  channels: NotificationChannelKey[]
  defaults?: Record<string, NotificationChannels>
}

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

interface NotificationList {
  items: NotificationItem[]
  total: number
  unread: number
}

export const notificationApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<NotificationList>('/notifications', { params }).then((response) => response.data),
  preferences: () => http.get<NotificationPreferences>('/notifications/preferences').then((response) => response.data),
  update: (payload: { settings?: Record<string, Partial<NotificationChannels>>; digest?: string; digestHour?: number }) =>
    http.patch<NotificationPreferences>('/notifications/preferences', payload).then((response) => response.data),
  runDigest: () => http.post<{ sent: number }>('/notifications/digest/run').then((response) => response.data),
  readAll: () => http.post('/notifications/read-all').then((response) => response.data),
  read: (id: string) => http.patch(`/notifications/${id}/read`).then((response) => response.data),
}
