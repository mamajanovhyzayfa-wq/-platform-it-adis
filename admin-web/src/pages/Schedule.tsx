import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminScheduleItem } from '../api/admin'
import { errorMessage } from '../api/client'

type View = 'day' | 'week' | 'month'

const views: Array<{ value: View; label: string }> = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

const statusLabels: Record<string, string> = {
  SCHEDULED: 'Запланировано',
  ONGOING: 'Идёт',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
  RESCHEDULED: 'Перенесено',
}

const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function startOfWeek(date: Date) {
  const copy = startOfDay(date)
  const weekday = (copy.getDay() + 6) % 7 // понедельник — первый день
  copy.setDate(copy.getDate() - weekday)
  return copy
}

function startOfMonth(date: Date) {
  const copy = startOfDay(date)
  copy.setDate(1)
  return copy
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildRange(view: View, anchor: Date) {
  if (view === 'day') {
    const from = startOfDay(anchor)
    return { from, to: addDays(from, 1) }
  }
  if (view === 'week') {
    const from = startOfWeek(anchor)
    return { from, to: addDays(from, 7) }
  }
  const from = startOfMonth(anchor)
  return { from, to: addMonths(from, 1) }
}

function shiftAnchor(view: View, anchor: Date, direction: 1 | -1) {
  if (view === 'day') return addDays(anchor, direction)
  if (view === 'week') return addDays(anchor, 7 * direction)
  return addMonths(anchor, direction)
}

/** Расписание платформы в разрезе дня, недели и месяца с контролем нагрузки. */
export function SchedulePage() {
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(() => new Date())

  const range = useMemo(() => buildRange(view, anchor), [view, anchor])

  const schedule = useQuery({
    queryKey: ['admin-schedule', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => adminApi.schedule({ from: range.from.toISOString(), to: range.to.toISOString() }),
  })

  const grouped = useMemo(() => {
    const map = new Map<string, AdminScheduleItem[]>()
    for (const item of schedule.data?.items ?? []) {
      const key = dayKey(new Date(item.startsAt))
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return map
  }, [schedule.data])

  const periodLabel =
    view === 'day'
      ? dayFormat.format(anchor)
      : view === 'week'
        ? `${dayFormat.format(range.from)} — ${dayFormat.format(addDays(range.to, -1))}`
        : monthFormat.format(anchor)

  const monthDays = useMemo(() => {
    if (view !== 'month') return []
    const days: Date[] = []
    const last = addDays(range.to, -1)
    for (let cursor = new Date(range.from); cursor <= last; cursor = addDays(cursor, 1)) {
      days.push(new Date(cursor))
    }
    return days
  }, [view, range])

  const renderItem = (item: AdminScheduleItem) => (
    <div className="schedule-item" key={item.id}>
      <div className="schedule-time">
        {timeFormat.format(new Date(item.startsAt))}–{timeFormat.format(new Date(item.endsAt))}
      </div>
      <div>
        <strong>{item.title}</strong>
        <div className="muted small">
          {item.course.title} · {item.teacher}
          {item.hasRoom ? ' · комната создана' : ''}
        </div>
      </div>
      <span className={`badge badge-${item.status.toLowerCase()}`}>{statusLabels[item.status] ?? item.status}</span>
    </div>
  )

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Расписание</h1>
          <p className="muted">Занятия всех курсов: нагрузка преподавателей и конфликты по времени.</p>
        </div>
      </header>

      <div className="filters">
        <div className="tabs" role="tablist">
          {views.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={view === item.value}
              className={view === item.value ? 'tab tab-active' : 'tab'}
              onClick={() => setView(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
            ←
          </button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(new Date())}>
            Сегодня
          </button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
            →
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}</h2>
        {schedule.isLoading ? <p className="muted">Загрузка…</p> : null}
        {schedule.error ? <p className="muted">{errorMessage(schedule.error)}</p> : null}
        {schedule.data && schedule.data.items.length === 0 ? <p className="muted">Занятий за период нет.</p> : null}

        {view === 'month' ? (
          <div className="calendar">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
              <div className="calendar-head" key={day}>
                {day}
              </div>
            ))}
            {/* Пустые ячейки до первого числа: 1-е встаёт под своим днём недели. */}
            {Array.from({ length: (range.from.getDay() + 6) % 7 }, (_, index) => (
              <div className="calendar-cell calendar-cell-empty" key={`blank-${index}`} />
            ))}
            {monthDays.map((day) => {
              const items = grouped.get(dayKey(day)) ?? []
              return (
                <div className={items.length > 0 ? 'calendar-cell calendar-cell-busy' : 'calendar-cell'} key={dayKey(day)}>
                  <span className="calendar-date">{day.getDate()}</span>
                  {items.slice(0, 3).map((item) => (
                    <span className="calendar-event" key={item.id} title={`${item.course.title} · ${item.teacher}`}>
                      {timeFormat.format(new Date(item.startsAt))} {item.title}
                    </span>
                  ))}
                  {items.length > 3 ? <span className="muted small">ещё {items.length - 3}</span> : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="schedule-list">
            {view === 'week'
              ? Array.from({ length: 7 }, (_, index) => {
                  const day = addDays(range.from, index)
                  const items = grouped.get(dayKey(day)) ?? []
                  return (
                    <section className="schedule-day" key={dayKey(day)}>
                      <h3>{dayFormat.format(day)}</h3>
                      {items.length === 0 ? <p className="muted small">Нет занятий</p> : items.map(renderItem)}
                    </section>
                  )
                })
              : (grouped.get(dayKey(range.from)) ?? []).map(renderItem)}
          </div>
        )}
      </div>
    </div>
  )
}
