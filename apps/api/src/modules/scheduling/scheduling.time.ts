/**
 * Работа с расписанием в часовом поясе филиала.
 * Кыргызстан не переходит на летнее время, поэтому смещение фиксировано UTC+6.
 * В БД время хранится в UTC, а все «настенные» расчёты идут через эти функции.
 */
export const BRANCH_TIMEZONE = 'Asia/Bishkek'
export const BRANCH_OFFSET_MINUTES = 6 * 60

export function combineLocal(date: string, time: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - BRANCH_OFFSET_MINUTES * 60_000)
}

export function localDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + BRANCH_OFFSET_MINUTES * 60_000)
  return shifted.toISOString().slice(0, 10)
}

export function localWeekday(date: Date): number {
  const shifted = new Date(date.getTime() + BRANCH_OFFSET_MINUTES * 60_000)
  return (shifted.getUTCDay() + 6) % 7 // 0 — понедельник
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

export function startOfLocalDay(date: Date): Date {
  const shifted = new Date(date.getTime() + BRANCH_OFFSET_MINUTES * 60_000)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - BRANCH_OFFSET_MINUTES * 60_000)
}

export function startOfLocalWeek(date: Date): Date {
  return addDays(startOfLocalDay(date), -localWeekday(date))
}

export function startOfLocalMonth(date: Date): Date {
  const shifted = new Date(date.getTime() + BRANCH_OFFSET_MINUTES * 60_000)
  shifted.setUTCDate(1)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - BRANCH_OFFSET_MINUTES * 60_000)
}

export function parseTime(value: string): { hours: number; minutes: number } {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return { hours, minutes }
}

export function minutesOfDay(date: Date): number {
  const shifted = new Date(date.getTime() + BRANCH_OFFSET_MINUTES * 60_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

export function formatLocal(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BRANCH_TIMEZONE,
  }).format(date)
}

export function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BRANCH_TIMEZONE,
  }).format(date)
}

/** Пересечение интервалов [aStart, aEnd) и [bStart, bEnd). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Ручная офлайн-посещаемость: опоздание и ранний выход измеряются в минутах.
 * Для LATE/LEFT_EARLY время присутствия уменьшается, а в ABSENT равно нулю.
 */
export function manualAttendanceTiming(input: {
  startsAt: Date
  endsAt: Date
  status: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ABSENT'
  lateMinutes?: number
  earlyLeaveMinutes?: number
}): { joinedAt: Date; leftAt: Date; durationSeconds: number; lateMinutes: number; earlyLeaveMinutes: number } {
  const totalMinutes = Math.max(0, Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000))
  const lateMinutes =
    input.status === 'LATE' ? Math.min(totalMinutes, Math.max(0, Math.round(input.lateMinutes ?? 10))) : 0
  const earlyLeaveMinutes =
    input.status === 'LEFT_EARLY'
      ? Math.min(totalMinutes, Math.max(0, Math.round(input.earlyLeaveMinutes ?? 10)))
      : 0

  if (input.status === 'ABSENT') {
    return {
      joinedAt: input.startsAt,
      leftAt: input.endsAt,
      durationSeconds: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    }
  }

  const joinedAt = new Date(input.startsAt.getTime() + lateMinutes * 60_000)
  const leftAt = new Date(input.endsAt.getTime() - earlyLeaveMinutes * 60_000)
  return {
    joinedAt,
    leftAt,
    durationSeconds: Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000)),
    lateMinutes,
    earlyLeaveMinutes,
  }
}

/** Даты серии по правилу повторения. Ограничение — 180 занятий. */
export function seriesDates(input: {
  rule: 'DAILY' | 'WEEKLY' | 'SELECTED_DAYS' | 'INTERVAL'
  weekdays: number[]
  interval: number
  startsOn: string
  endsOn?: string
}): string[] {
  const result: string[] = []
  const start = new Date(`${input.startsOn}T00:00:00.000Z`)
  const end = input.endsOn ? new Date(`${input.endsOn}T23:59:59.999Z`) : addDays(start, 365)
  const interval = Math.max(1, input.interval)
  const selected = [...new Set(input.weekdays)].sort((a, b) => a - b)

  for (let offset = 0; offset <= 366 && result.length < 180; offset += 1) {
    const current = addDays(start, offset)
    if (current > end) break
    const weekday = (current.getUTCDay() + 6) % 7
    let match = false
    if (input.rule === 'DAILY' || input.rule === 'INTERVAL') {
      match = offset % interval === 0
    } else if (input.rule === 'WEEKLY') {
      match = weekday === ((start.getUTCDay() + 6) % 7) && Math.floor(offset / 7) % interval === 0
    } else {
      const startWeekday = (start.getUTCDay() + 6) % 7
      const weekIndex = Math.floor((offset + startWeekday) / 7)
      match = selected.includes(weekday) && weekIndex % interval === 0
    }
    if (match) result.push(current.toISOString().slice(0, 10))
  }
  return result
}
