export type View = 'day' | 'week' | 'month'
export type Tab = 'calendar' | 'templates' | 'classrooms' | 'approvals' | 'stats' | 'settings'

export const statusLabels: Record<string, string> = {
  SCHEDULED: 'Запланировано',
  ONGOING: 'Идёт',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  RESCHEDULED: 'Перенесено',
  PENDING: 'На согласовании',
  APPROVED: 'Подтверждено',
  REJECTED: 'Отклонено',
}
export const modeLabels: Record<string, string> = { ONLINE: 'Онлайн', OFFLINE: 'Офлайн', HYBRID: 'Гибрид' }
export const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
export const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}
export function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}
function addMonths(date: Date, months: number) {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}
function startOfWeek(date: Date) {
  const copy = startOfDay(date)
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  return copy
}
function startOfMonth(date: Date) {
  const copy = startOfDay(date)
  copy.setDate(1)
  return copy
}
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function rangeFor(view: View, anchor: Date) {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
  if (view === 'week') return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 7) }
  return { from: startOfMonth(anchor), to: addMonths(startOfMonth(anchor), 1) }
}
export function shift(view: View, anchor: Date, direction: 1 | -1) {
  if (view === 'day') return addDays(anchor, direction)
  if (view === 'week') return addDays(anchor, 7 * direction)
  return addMonths(anchor, direction)
}
export function toLocalInput(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export function localDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
