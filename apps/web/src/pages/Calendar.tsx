import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  schedulingApi,
  type CalendarConnection,
  type CalendarEvent,
  type ScheduleCard,
} from '../api/scheduling'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime, formatTime } from '../components/ui'

type View = 'day' | 'week' | 'month'

const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const eventColors: Record<string, string> = {
  lesson: '#3557d6',
  task: '#8a5cf6',
  homework: '#f0a020',
  exam: '#d64545',
}

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
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
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function rangeFor(view: View, anchor: Date) {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
  if (view === 'week') return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 7) }
  return { from: startOfMonth(anchor), to: addMonths(startOfMonth(anchor), 1) }
}
function shift(view: View, anchor: Date, direction: 1 | -1) {
  if (view === 'day') return addDays(anchor, direction)
  if (view === 'week') return addDays(anchor, 7 * direction)
  return addMonths(anchor, direction)
}
function toLocalInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Личный календарь ученика, наставника, менеджера и администратора. */
export function CalendarPage() {
  const role = getSession()?.role
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [types, setTypes] = useState('lesson,task,homework,exam')
  const [courseId, setCourseId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const canFilterTeacher = role === 'ADMIN' || role === 'MANAGER'
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reminders, setReminders] = useState(() => localStorage.getItem('itadis-reminders') === '1')
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])

  const courses = useQuery({ queryKey: ['sched-courses'], queryFn: schedulingApi.courses })
  const teachers = useQuery({ queryKey: ['sched-teachers'], queryFn: schedulingApi.teachers, enabled: canFilterTeacher })
  const classrooms = useQuery({ queryKey: ['sched-classrooms'], queryFn: schedulingApi.classrooms })
  const calendar = useQuery({
    queryKey: ['calendar', range.from.toISOString(), range.to.toISOString(), types, courseId, teacherId, classroomId],
    queryFn: () =>
      schedulingApi.calendar({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        types,
        status: 'ALL',
        courseId: courseId || undefined,
        teacherId: teacherId || undefined,
        classroomId: classroomId || undefined,
      }),
  })
  const tasks = useQuery({ queryKey: ['calendar-tasks'], queryFn: schedulingApi.tasks })
  const extra = useQuery({ queryKey: ['calendar-extra'], queryFn: schedulingApi.extra })
  const connections = useQuery({ queryKey: ['calendar-connections'], queryFn: schedulingApi.connections })

  const events = calendar.data?.items ?? []
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = dayKey(new Date(event.startsAt))
      map.set(key, [...(map.get(key) ?? []), event])
    }
    return map
  }, [events])

  useEffect(() => {
    localStorage.setItem('itadis-reminders', reminders ? '1' : '0')
    if (!reminders) return
    if (!('Notification' in window)) {
      setError('Браузер не поддерживает уведомления')
      setReminders(false)
      return
    }
    if (Notification.permission === 'default') void Notification.requestPermission()
    const shown = new Set<string>()
    const check = () => {
      const now = Date.now()
      for (const event of events) {
        const diff = new Date(event.startsAt).getTime() - now
        if (diff < 0 || diff > 10 * 60_000 || shown.has(event.id)) continue
        if (Notification.permission !== 'granted') continue
        shown.add(event.id)
        new Notification('Скоро занятие', { body: `${formatTime(event.startsAt)} · ${event.title}` })
      }
    }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [events, reminders])

  const periodLabel =
    view === 'day'
      ? dayFormat.format(anchor)
      : view === 'week'
        ? `${dayFormat.format(range.from)} — ${dayFormat.format(addDays(range.to, -1))}`
        : monthFormat.format(anchor)

  const toggleTask = async (event: CalendarEvent) => {
    try {
      await schedulingApi.updateTask(event.entityId, { completed: !event.completed })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
    } catch (mutationError) {
      setError(errorMessage(mutationError, 'Не удалось обновить задачу'))
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Календарь"
        subtitle="Занятия, задачи, дедлайны, свободное время и внешние календари — в одном месте."
        actions={
          <label className="check-inline">
            <input type="checkbox" checked={reminders} onChange={(event) => setReminders(event.target.checked)} />
            Напоминания в браузере
          </label>
        }
      />
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="filters">
        <div className="tabs">
          {(['day', 'week', 'month'] as View[]).map((value) => (
            <button key={value} type="button" className={view === value ? 'tab tab-active' : 'tab'} onClick={() => setView(value)}>
              {value === 'day' ? 'День' : value === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <select aria-label="Тип событий" value={types} onChange={(event) => setTypes(event.target.value)}>
            <option value="lesson,task,homework,exam">Все события</option>
            <option value="lesson">Только занятия</option>
            <option value="task">Только задачи</option>
            <option value="homework">Только домашние задания</option>
            <option value="exam">Только экзамены</option>
          </select>
          <select aria-label="Группа" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Все группы</option>
            {courses.data?.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
          {canFilterTeacher ? (
            <select aria-label="Наставник" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">Все наставники</option>
              {teachers.data?.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>
              ))}
            </select>
          ) : null}
          <select aria-label="Аудитория" value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
            <option value="">Все аудитории</option>
            {classrooms.data?.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shift(view, anchor, -1))}>←</button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(new Date())}>Сегодня</button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shift(view, anchor, 1))}>→</button>
        </div>
      </div>

      <div className="schedule-layout">
        <div className="card">
          <h2>{periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}</h2>
          {calendar.isLoading ? <p className="muted">Загрузка…</p> : null}
          {!calendar.isLoading && events.length === 0 ? <Empty>Событий за период нет.</Empty> : null}

          {view === 'month' ? (
            <div className="calendar">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div className="calendar-head" key={day}>{day}</div>)}
              {Array.from({ length: (range.from.getDay() + 6) % 7 }, (_, index) => <div className="calendar-cell calendar-cell-empty" key={`blank-${index}`} />)}
              {Array.from({ length: Math.round((range.to.getTime() - range.from.getTime()) / 86400_000) }, (_, index) => {
                const day = addDays(range.from, index)
                const dayEvents = grouped.get(dayKey(day)) ?? []
                return (
                  <div className="calendar-cell" key={dayKey(day)}>
                    <span className="calendar-date">{day.getDate()}</span>
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className="calendar-event calendar-event-button"
                        style={{ borderLeftColor: eventColors[event.type] }}
                        onClick={() => setSelected(event)}
                      >
                        {event.allDay ? '' : `${formatTime(event.startsAt)} `}{event.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 ? <span className="muted small">ещё {dayEvents.length - 3}</span> : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="schedule-list">
              {(view === 'week' ? Array.from({ length: 7 }, (_, index) => addDays(range.from, index)) : [range.from]).map((day) => {
                const dayEvents = grouped.get(dayKey(day)) ?? []
                return (
                  <section className="schedule-day" key={dayKey(day)}>
                    <h3>{dayFormat.format(day)}</h3>
                    {dayEvents.length === 0 ? <p className="muted small">Свободно</p> : dayEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className="schedule-item schedule-item-button"
                        style={{ borderLeftColor: eventColors[event.type] }}
                        onClick={() => setSelected(event)}
                      >
                        <span className="schedule-time">{event.allDay ? 'весь день' : formatTime(event.startsAt)}</span>
                        <span>
                          <strong>{event.title}</strong>
                          <span className="muted small">
                            {event.course?.title ?? (event.type === 'task' ? 'Личная задача' : '')}
                            {event.teacher ? ` · ${event.teacher}` : ''}
                            {event.location ? ` · ${event.location}` : ''}
                          </span>
                        </span>
                        <span className="muted small">{event.type === 'lesson' ? 'занятие' : event.type === 'task' ? 'задача' : event.type === 'exam' ? 'экзамен' : 'ДЗ'}</span>
                      </button>
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <aside className="schedule-side stack-sm">
          {selected ? (
            <div className="card stack-sm">
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <strong>{selected.title}</strong>
                <button type="button" className="button button-ghost button-small" onClick={() => setSelected(null)}>Закрыть</button>
              </div>
              <p className="muted small">
                {formatDateTime(selected.startsAt)}
                {selected.type === 'lesson' ? `–${formatTime(selected.endsAt)}` : ''}
                {selected.location ? ` · ${selected.location}` : ''}
              </p>
              {selected.course ? <p>{selected.course.title}</p> : null}
              {selected.teacher ? <p className="muted small">Наставник: {selected.teacher}</p> : null}
              {selected.description ? <p>{selected.description}</p> : null}
              {selected.cancellationReason ? (
                <p className="alert alert-error">
                  Причина отмены: {selected.cancellationReason}
                  {selected.cancelledAt ? ` · ${formatDateTime(selected.cancelledAt)}` : ''}
                  {selected.cancelledBy ? ` · ${selected.cancelledBy.name}` : ''}
                </p>
              ) : null}
              <div className="row-actions">
                {selected.type === 'lesson' && selected.canJoin ? <Link className="button" to={`/lesson/${selected.entityId}`}>Войти в занятие</Link> : null}
                {selected.type === 'lesson' && selected.kind === 'EXTRA' && role === 'STUDENT' ? (
                  selected.isCourseStudent ? (
                    <span className="muted small">Вы уже в группе этого занятия</span>
                  ) : selected.myExtraEnrollment === 'REGISTERED' ? (
                    <span className="muted small">Вы записаны</span>
                  ) : (
                    <ExtraEnrollButton scheduleId={selected.entityId} allow={Boolean(selected.canEnrollExtra)} />
                  )
                ) : null}
                {selected.type === 'task' ? (
                  <button className="button button-small" type="button" onClick={() => void toggleTask(selected)}>
                    {selected.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
                  </button>
                ) : null}
                {selected.link ? <Link className="button button-ghost" to={selected.link}>Открыть</Link> : null}
              </div>
            </div>
          ) : <div className="card"><p className="muted small">Выберите событие в календаре.</p></div>}

          <TasksPanel tasks={tasks.data ?? []} courses={courses.data ?? []} />
          <FreeSlotsPanel canChooseTeacher={role === 'ADMIN' || role === 'MANAGER'} />
        </aside>
      </div>

      <ExtraSessionsPanel sessions={extra.data ?? []} role={role} />
      <ConnectionsPanel connections={connections.data?.items ?? []} instructions={connections.data?.instructions ?? {}} />
    </div>
  )
}

function ExtraEnrollButton({ scheduleId, allow }: { scheduleId: string; allow: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const enroll = useMutation({
    mutationFn: () => schedulingApi.enroll(scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['calendar-extra'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось записаться')),
  })
  return (
    <>
      {error ? <span className="muted small">{error}</span> : null}
      <button className="button button-small" type="button" disabled={!allow || enroll.isPending} onClick={() => enroll.mutate()}>
        {allow ? 'Записаться' : 'Мест нет'}
      </button>
    </>
  )
}

function TasksPanel({
  tasks,
  courses,
}: {
  tasks: Array<{ id: string; title: string; dueAt: string; completedAt: string | null; course: { id: string; title: string } | null }>
  courses: Array<{ id: string; title: string }>
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState(toLocalInput(new Date(Date.now() + 86400_000)))
  const [courseId, setCourseId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      schedulingApi.createTask({
        title,
        dueAt: new Date(dueAt).toISOString(),
        courseId: courseId || undefined,
      }),
    onSuccess: () => {
      setTitle('')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать задачу')),
  })

  return (
    <Section title="Задачи" subtitle="Личные напоминания и дедлайны">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <ul className="list">
        {tasks.length === 0 ? <li className="muted small">Задач нет.</li> : tasks.slice(0, 8).map((task) => (
          <li key={task.id}>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={Boolean(task.completedAt)}
                onChange={async () => {
                  await schedulingApi.updateTask(task.id, { completed: !task.completedAt })
                  queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
                  queryClient.invalidateQueries({ queryKey: ['calendar'] })
                }}
              />
              <span>
                <strong style={task.completedAt ? { textDecoration: 'line-through' } : undefined}>{task.title}</strong>
                <span className="muted small"> · {formatDateTime(task.dueAt)}{task.course ? ` · ${task.course.title}` : ''}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
        <input required placeholder="Новая задача" value={title} onChange={(event) => setTitle(event.target.value)} />
        <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Без группы</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
        <button className="button button-small" type="submit" disabled={create.isPending}>Добавить задачу</button>
      </form>
    </Section>
  )
}

function FreeSlotsPanel({ canChooseTeacher }: { canChooseTeacher: boolean }) {
  const [durationMinutes, setDurationMinutes] = useState(90)
  const [teacherId, setTeacherId] = useState('')
  const teachers = useQuery({ queryKey: ['sched-teachers'], queryFn: schedulingApi.teachers, enabled: canChooseTeacher })
  const from = new Date().toISOString()
  const to = new Date(Date.now() + 14 * 86400_000).toISOString()
  const slots = useQuery({
    queryKey: ['free-slots', durationMinutes, teacherId],
    queryFn: () =>
      schedulingApi.freeSlots({
        from,
        to,
        durationMinutes,
        teacherId: teacherId || undefined,
      }),
  })
  return (
    <Section title="Свободное время" subtitle="Рабочие часы филиала без конфликтов">
      <div className="row-actions">
        <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
          <option value={45}>45 мин</option>
          <option value={60}>60 мин</option>
          <option value={90}>90 мин</option>
          <option value={120}>120 мин</option>
        </select>
        {canChooseTeacher ? (
          <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
            <option value="">Все наставники</option>
            {teachers.data?.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>)}
          </select>
        ) : null}
      </div>
      {slots.data?.items.length === 0 ? <p className="muted small">Свободных слотов нет.</p> : null}
      <ul className="list">
        {slots.data?.items.map((slot) => (
          <li key={slot.startsAt}>
            <span>{formatDateTime(slot.startsAt)}</span>
            <span className="muted small">{slot.freeRooms.length} ауд.</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ExtraSessionsPanel({ sessions, role }: { sessions: ScheduleCard[]; role?: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const act = useMutation({
    mutationFn: ({ id, enroll }: { id: string; enroll: boolean }) =>
      enroll ? schedulingApi.enroll(id) : schedulingApi.cancelEnrollment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-extra'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось изменить запись')),
  })
  return (
    <Section title="Дополнительные занятия" subtitle="Создаются вручную; индивидуальное обучение не входит">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {sessions.length === 0 ? <Empty>Дополнительных занятий нет.</Empty> : null}
      <ul className="list">
        {sessions.map((session) => (
          <li key={session.id}>
            <div>
              <strong>{session.title}</strong>
              <p className="muted small">
                {formatDateTime(session.startsAt)} · {session.teacher.name} · {session.course.title}
                {session.seatsLeft !== null ? ` · свободно ${session.seatsLeft}` : ''}
              </p>
            </div>
            <div className="row-actions">
              {session.canJoin ? <Link className="button button-ghost button-small" to={`/lesson/${session.id}`}>Войти</Link> : null}
              {role === 'STUDENT' && session.isCourseStudent ? <span className="muted small">Вы в группе</span> : null}
              {role === 'STUDENT' && !session.isCourseStudent && session.canEnroll ? (
                <button className="button button-small" type="button" onClick={() => act.mutate({ id: session.id, enroll: true })}>Записаться</button>
              ) : null}
              {role === 'STUDENT' && session.myExtraEnrollment === 'REGISTERED' ? (
                <button className="button button-ghost button-small" type="button" onClick={() => act.mutate({ id: session.id, enroll: false })}>Отменить запись</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ConnectionsPanel({
  connections,
  instructions,
}: {
  connections: CalendarConnection[]
  instructions: Record<string, string>
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (provider: 'GOOGLE' | 'APPLE' | 'OUTLOOK') => schedulingApi.createConnection(provider),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать подписку')),
  })
  return (
    <Section title="Внешние календари" subtitle="Подписка ICS работает в Google Calendar, Apple Calendar и Outlook">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <p className="muted small">
        Ссылка содержит персональный токен — не передавайте её другим. События обновляются по подписке.
      </p>
      <div className="row-actions">
        {(['GOOGLE', 'APPLE', 'OUTLOOK'] as const).map((provider) => (
          <button key={provider} className="button button-ghost button-small" type="button" onClick={() => create.mutate(provider)} disabled={create.isPending}>
            + {provider === 'GOOGLE' ? 'Google Calendar' : provider === 'APPLE' ? 'Apple Calendar' : 'Outlook'}
          </button>
        ))}
      </div>
      <ul className="list">
        {connections.map((connection) => (
          <li key={connection.id}>
            <div>
              <strong>{connection.provider === 'GOOGLE' ? 'Google Calendar' : connection.provider === 'APPLE' ? 'Apple Calendar' : 'Outlook'}</strong>
              <p className="muted small">{instructions[connection.provider]}</p>
              <p className="muted small" style={{ wordBreak: 'break-all' }}>{connection.webcalUrl}</p>
            </div>
            <div className="row-actions">
              <button
                className="button button-ghost button-small"
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(connection.webcalUrl)
                  setCopied(connection.id)
                }}
              >
                {copied === connection.id ? 'Скопировано' : 'Копировать'}
              </button>
              <button
                className="button button-ghost button-small"
                type="button"
                onClick={async () => {
                  await schedulingApi.deleteConnection(connection.id)
                  queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
                }}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}
