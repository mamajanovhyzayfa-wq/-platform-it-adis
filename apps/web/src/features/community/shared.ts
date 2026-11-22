import type { ChatMessage } from '../../api/community'

export type Tab = 'chats' | 'meetings' | 'announcements' | 'events'

export const tabLabels: Record<Tab, string> = {
  chats: 'Чаты и обсуждения',
  meetings: 'Встречи',
  announcements: 'Объявления',
  events: 'Мероприятия',
}

export const conversationTypeLabels: Record<string, string> = {
  DIRECT: 'Личный чат',
  PARENT_TEACHER: 'Родитель — наставник',
  COURSE: 'Чат курса',
  GROUP: 'Групповой чат',
  TOPIC: 'Обсуждение темы',
}

export const meetingStatusLabels: Record<string, string> = {
  PENDING: 'Ожидает ответа',
  APPROVED: 'Подтверждена',
  DECLINED: 'Отклонена',
  CANCELLED: 'Отменена',
  COMPLETED: 'Завершена',
}

export const eventTypeLabels: Record<string, string> = {
  EVENT: 'Событие',
  CONTEST: 'Конкурс',
  OLYMPIAD: 'Олимпиада',
  COMPETITION: 'Внутреннее соревнование',
}

export const eventStatusLabels: Record<string, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликовано',
  REGISTRATION: 'Регистрация',
  ONGOING: 'Идёт',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
}

export const registrationStatusLabels: Record<string, string> = {
  REGISTERED: 'Участник',
  WAITLIST: 'Лист ожидания',
  CANCELLED: 'Регистрация отменена',
}

export const audienceLabels: Record<string, string> = {
  ALL: 'Все',
  STUDENTS: 'Ученики',
  PARENTS: 'Родители',
  TEACHERS: 'Наставники',
  MANAGERS: 'Менеджеры',
  COURSE: 'Курс',
}

/** Статус сообщения: отправлено, доставлено или прочитано участниками. */
export function messageStatusLabel(item: ChatMessage) {
  if (item.status === 'READ') {
    return item.recipientCount > 1 ? `✓✓ прочитано ${item.readCount} из ${item.recipientCount}` : '✓✓ прочитано'
  }
  if (item.status === 'DELIVERED') return `✓✓ доставлено ${item.readCount} из ${item.recipientCount}`
  return '✓ отправлено'
}

export function eventInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}
