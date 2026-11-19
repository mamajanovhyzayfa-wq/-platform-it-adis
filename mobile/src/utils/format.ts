const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long' })
const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })

export function formatDate(iso: string, timeZone?: string) {
  return dateFormatter.format(new Date(iso))
}

export function formatTime(iso: string, timeZone?: string) {
  return timeFormatter.format(new Date(iso))
}

export function formatFullDate(iso: string) {
  return fullDateFormatter.format(new Date(iso))
}

export function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const sameDay = start.toDateString() === end.toDateString()
  return sameDay
    ? `${formatDate(startIso)}, ${formatTime(startIso)}–${formatTime(endIso)}`
    : `${formatDate(startIso)} ${formatTime(startIso)} — ${formatDate(endIso)} ${formatTime(endIso)}`
}

export function minutesLeft(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000)
}

/** Кнопка «Присоединиться» активна за 15 минут до начала и до конца занятия. */
export function canJoin(startIso: string, endIso: string) {
  const now = Date.now()
  return new Date(startIso).getTime() - 15 * 60000 <= now && now <= new Date(endIso).getTime()
}
