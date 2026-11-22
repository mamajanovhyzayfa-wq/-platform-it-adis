import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { schedulingApi, type ScheduleCard } from '../../api/scheduling'
import { Empty, Section, formatTime } from '../../components/ui'
import { ScheduleDetailPanel } from './ScheduleDetailPanel'
import {
  addDays,
  dayFormat,
  dayKey,
  localDate,
  monthFormat,
  rangeFor,
  shift,
  statusLabels,
  toLocalInput,
  weekdayLabels,
  type View,
} from './shared'

export function CalendarTab({ isManager }: { isManager: boolean }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [courseId, setCourseId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const [mode, setMode] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])

  const courses = useQuery({ queryKey: ['sched-courses'], queryFn: schedulingApi.courses })
  const teachers = useQuery({ queryKey: ['sched-teachers'], queryFn: schedulingApi.teachers })
  const classrooms = useQuery({ queryKey: ['sched-classrooms'], queryFn: schedulingApi.classrooms })
  const list = useQuery({
    queryKey: ['schedules', range.from.toISOString(), range.to.toISOString(), courseId, teacherId, classroomId],
    queryFn: () =>
      schedulingApi.schedules({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        courseId: courseId || undefined,
        teacherId: teacherId || undefined,
        classroomId: classroomId || undefined,
        status: 'ALL',
      }),
  })
  const items = (list.data?.items ?? []).filter((item) => !mode || item.deliveryMode === mode)

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleCard[]>()
    for (const item of items) {
      const key = dayKey(new Date(item.startsAt))
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return map
  }, [items])

  const periodLabel =
    view === 'day'
      ? dayFormat.format(anchor)
      : view === 'week'
        ? `${dayFormat.format(range.from)} — ${dayFormat.format(addDays(range.to, -1))}`
        : monthFormat.format(anchor)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] })
    queryClient.invalidateQueries({ queryKey: ['schedule-detail'] })
  }

  return (
    <>
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="filters">
        <div className="tabs" role="tablist">
          {(['day', 'week', 'month'] as View[]).map((value) => (
            <button
              key={value}
              type="button"
              className={view === value ? 'tab tab-active' : 'tab'}
              onClick={() => setView(value)}
            >
              {value === 'day' ? 'День' : value === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <select aria-label="Курс" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Все группы</option>
            {courses.data?.map((course) => (
              <option key={course.id} value={course.id}>{course.title}</option>
            ))}
          </select>
          <select aria-label="Наставник" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
            <option value="">Все наставники</option>
            {teachers.data?.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>
            ))}
          </select>
          <select aria-label="Аудитория" value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
            <option value="">Все аудитории</option>
            {classrooms.data?.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <select aria-label="Формат" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="">Все форматы</option>
            <option value="ONLINE">Онлайн</option>
            <option value="OFFLINE">Офлайн</option>
            <option value="HYBRID">Гибрид</option>
          </select>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shift(view, anchor, -1))}>←</button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(new Date())}>Сегодня</button>
          <button className="button button-ghost" type="button" onClick={() => setAnchor(shift(view, anchor, 1))}>→</button>
          <button className="button" type="button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Скрыть форму' : 'Новое занятие'}
          </button>
        </div>
      </div>

      {showForm ? (
        <CreateScheduleForm
          courses={courses.data ?? []}
          teachers={teachers.data ?? []}
          classrooms={classrooms.data ?? []}
          isManager={isManager}
          onDone={(id) => {
            setShowForm(false)
            setSelected(id)
            refresh()
          }}
          onError={setError}
        />
      ) : null}

      <div className="schedule-layout">
        <div className="card">
          <h2>{periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}</h2>
          {list.isLoading ? <p className="muted">Загрузка…</p> : null}
          {list.error ? <p className="muted">{errorMessage(list.error)}</p> : null}
          {!list.isLoading && items.length === 0 ? <Empty>Занятий за период нет.</Empty> : null}

          {view === 'month' ? (
            <div className="calendar">
              {weekdayLabels.map((day) => <div className="calendar-head" key={day}>{day}</div>)}
              {Array.from({ length: (range.from.getDay() + 6) % 7 }, (_, index) => (
                <div className="calendar-cell calendar-cell-empty" key={`blank-${index}`} />
              ))}
              {Array.from({ length: Math.round((range.to.getTime() - range.from.getTime()) / 86400_000) }, (_, index) => {
                const day = addDays(range.from, index)
                const dayItems = grouped.get(dayKey(day)) ?? []
                return (
                  <div className={dayItems.length ? 'calendar-cell calendar-cell-busy' : 'calendar-cell'} key={dayKey(day)}>
                    <span className="calendar-date">{day.getDate()}</span>
                    {dayItems.slice(0, 3).map((item) => (
                      <button
                        type="button"
                        className="calendar-event calendar-event-button"
                        key={item.id}
                        title={`${item.course.title} · ${item.teacher.name}`}
                        onClick={() => setSelected(item.id)}
                      >
                        {formatTime(item.startsAt)} {item.title}
                      </button>
                    ))}
                    {dayItems.length > 3 ? <span className="muted small">ещё {dayItems.length - 3}</span> : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="schedule-list">
              {(view === 'week'
                ? Array.from({ length: 7 }, (_, index) => addDays(range.from, index))
                : [range.from]
              ).map((day) => {
                const dayItems = grouped.get(dayKey(day)) ?? []
                return (
                  <section className="schedule-day" key={dayKey(day)}>
                    <h3>{dayFormat.format(day)}</h3>
                    {dayItems.length === 0 ? <p className="muted small">Нет занятий</p> : dayItems.map((item) => (
                      <button type="button" className="schedule-item schedule-item-button" key={item.id} onClick={() => setSelected(item.id)}>
                        <span className="schedule-time">{formatTime(item.startsAt)}–{formatTime(item.endsAt)}</span>
                        <span>
                          <strong>{item.title}</strong>
                          <span className="muted small">
                            {item.course.title} · {item.teacher.name}
                            {item.classroom ? ` · ${item.classroom.name}` : ''}
                            {item.kind === 'EXTRA' ? ' · доп.' : ''}
                          </span>
                        </span>
                        <span className={`badge badge-${item.status.toLowerCase()}`}>{statusLabels[item.status] ?? item.status}</span>
                      </button>
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <aside className="schedule-side">
          {selected ? (
            <ScheduleDetailPanel
              id={selected}
              isManager={isManager}
              onClose={() => setSelected(null)}
              onChanged={refresh}
            />
          ) : (
            <div className="card"><p className="muted">Выберите занятие, чтобы увидеть детали, историю и действия.</p></div>
          )}
        </aside>
      </div>
    </>
  )
}

function CreateScheduleForm({
  courses,
  teachers,
  classrooms,
  isManager,
  onDone,
  onError,
}: {
  courses: Array<{ id: string; title: string; teacherId: string; teacher: string; students: number }>
  teachers: Array<{ id: string; firstName: string; lastName: string }>
  classrooms: Array<{ id: string; name: string; capacity: number }>
  isManager: boolean
  onDone: (id: string) => void
  onError: (message: string) => void
}) {
  const tomorrow = addDays(new Date(), 1)
  const [form, setForm] = useState({
    courseId: '',
    teacherId: '',
    classroomId: '',
    title: '',
    description: '',
    startsAt: toLocalInput(new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 18, 0).toISOString()),
    durationMinutes: 90,
    deliveryMode: 'ONLINE',
    kind: 'REGULAR',
    capacity: '',
    allowSelfEnrollment: false,
    published: true,
    recording: '',
    autoRecord: '',
    recurring: false,
    rule: 'SELECTED_DAYS',
    weekdays: [(new Date().getDay() + 6) % 7] as number[],
    startTime: '18:00',
    startsOn: localDate(tomorrow),
    endsOn: localDate(addDays(new Date(), 90)),
    interval: 1,
  })
  const course = courses.find((item) => item.id === form.courseId)
  const [busy, setBusy] = useState(false)

  const payload = () => {
    const recordingFields = {
      ...(form.recording ? { recordingEnabled: form.recording === 'true' } : {}),
      ...(form.autoRecord ? { autoRecord: form.autoRecord === 'true' } : {}),
    }
    if (form.recurring) {
      return {
        courseId: form.courseId,
        ...(form.teacherId ? { teacherId: form.teacherId } : {}),
        classroomId: form.classroomId || null,
        title: form.title,
        description: form.description || undefined,
        deliveryMode: form.deliveryMode,
        rule: form.rule,
        weekdays: form.weekdays,
        interval: form.interval,
        startsOn: form.startsOn,
        endsOn: form.endsOn || undefined,
        startTime: form.startTime,
        durationMinutes: form.durationMinutes,
        ...(form.capacity ? { capacity: Number(form.capacity) } : {}),
        allowSelfEnrollment: false,
        ...recordingFields,
      }
    }
    return {
      courseId: form.courseId,
      ...(form.teacherId ? { teacherId: form.teacherId } : {}),
      classroomId: form.classroomId || null,
      title: form.title,
      description: form.description || undefined,
      startsAt: new Date(form.startsAt).toISOString(),
      durationMinutes: form.durationMinutes,
      deliveryMode: form.deliveryMode,
      kind: form.kind,
      ...(form.capacity ? { capacity: Number(form.capacity) } : {}),
      allowSelfEnrollment: form.allowSelfEnrollment,
      published: form.published,
      ...recordingFields,
    }
  }

  const submit = async () => {
    setBusy(true)
    try {
      if (form.recurring) {
        const result = await schedulingApi.createRecurring(payload() as Record<string, unknown>)
        if (result.created === 0) {
          onError(`Серия не создана: ${result.skipped[0]?.reason ?? 'нет свободных слотов'}`)
          return
        }
        const first = await schedulingApi.schedules({
          from: new Date().toISOString(),
          to: new Date(Date.now() + 400 * 86400_000).toISOString(),
          courseId: form.courseId,
        })
        onDone(first.items[0]?.id ?? '')
      } else {
        const created = await schedulingApi.createSchedule(payload() as Record<string, unknown>)
        onDone(created.id)
      }
    } catch (error) {
      onError(errorMessage(error, 'Не удалось создать занятие'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Новое занятие" subtitle="Одиночное или повторяющееся. Конфликты проверяются до сохранения.">
      <form
        className="stack-sm"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="form-row">
          <label className="field">
            <span>Группа (курс)</span>
            <select
              value={form.courseId}
              required
              onChange={(event) => {
                const next = courses.find((item) => item.id === event.target.value)
                setForm({
                  ...form,
                  courseId: event.target.value,
                  title: form.title || `Занятие: ${next?.title ?? ''}`,
                })
              }}
            >
              <option value="">Выберите курс</option>
              {courses.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.students} чел.</option>)}
            </select>
          </label>
          <label className="field">
            <span>Наставник</span>
            <select
              value={form.teacherId}
              disabled={!isManager}
              onChange={(event) => setForm({ ...form, teacherId: event.target.value })}
            >
              <option value="">{course ? `По курсу: ${course.teacher}` : 'По курсу'}</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>)}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Название</span>
          <input value={form.title} required minLength={3} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label className="field">
          <span>Описание</span>
          <textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>

        <div className="form-row">
          <label className="field">
            <span>Формат</span>
            <select value={form.deliveryMode} onChange={(event) => setForm({ ...form, deliveryMode: event.target.value })}>
              <option value="ONLINE">Онлайн (LiveDigital)</option>
              <option value="OFFLINE">Офлайн</option>
              <option value="HYBRID">Гибрид</option>
            </select>
          </label>
          <label className="field">
            <span>Аудитория</span>
            <select value={form.classroomId} onChange={(event) => setForm({ ...form, classroomId: event.target.value })}>
              <option value="">Без аудитории</option>
              {classrooms.map((room) => <option key={room.id} value={room.id}>{room.name} · до {room.capacity}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Вместимость</span>
            <input type="number" min={1} value={form.capacity} placeholder="Из аудитории" onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
          </label>
        </div>

        <div className="form-row">
          <label className="field">
            <span>Тип</span>
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="REGULAR">Обычное занятие</option>
              <option value="EXTRA">Дополнительное групповое</option>
            </select>
          </label>
          <label className="field">
            <span>Длительность, мин</span>
            <input type="number" min={15} max={480} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>Запись занятия</span>
            <select value={form.recording} onChange={(event) => setForm({ ...form, recording: event.target.value })}>
              <option value="">Как у группы</option>
              <option value="true">Включена</option>
              <option value="false">Выключена</option>
            </select>
          </label>
          <label className="field">
            <span>Автозапись</span>
            <select value={form.autoRecord} onChange={(event) => setForm({ ...form, autoRecord: event.target.value })}>
              <option value="">Как у группы</option>
              <option value="true">Автоматически</option>
              <option value="false">Вручную</option>
            </select>
          </label>
        </div>

        <label className="switch">
          <input type="checkbox" checked={form.recurring} onChange={(event) => setForm({ ...form, recurring: event.target.checked })} />
          <span>Повторяющееся занятие</span>
        </label>

        {form.recurring ? (
          <div className="stack-sm">
            <div className="form-row">
              <label className="field">
                <span>Правило</span>
                <select value={form.rule} onChange={(event) => setForm({ ...form, rule: event.target.value })}>
                  <option value="DAILY">Ежедневно</option>
                  <option value="WEEKLY">Еженедельно</option>
                  <option value="SELECTED_DAYS">Выбранные дни</option>
                  <option value="INTERVAL">Произвольный интервал (дни)</option>
                </select>
              </label>
              <label className="field">
                <span>Интервал</span>
                <input type="number" min={1} max={12} value={form.interval} onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Время</span>
                <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
              </label>
            </div>
            {(form.rule === 'SELECTED_DAYS' || form.rule === 'WEEKLY') ? (
              <div className="field">
                <span>Дни недели</span>
                <div className="row-actions">
                  {weekdayLabels.map((label, index) => (
                    <label className="check-inline" key={label}>
                      <input
                        type="checkbox"
                        checked={form.weekdays.includes(index)}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            weekdays: event.target.checked
                              ? [...form.weekdays, index]
                              : form.weekdays.filter((day) => day !== index),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-row">
              <label className="field">
                <span>С даты</span>
                <input type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
              </label>
              <label className="field">
                <span>По дату</span>
                <input type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
              </label>
            </div>
          </div>
        ) : (
          <label className="field">
            <span>Начало</span>
            <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
          </label>
        )}

        {form.kind === 'EXTRA' ? (
          <>
            <label className="switch">
              <input type="checkbox" checked={form.allowSelfEnrollment} onChange={(event) => setForm({ ...form, allowSelfEnrollment: event.target.checked })} />
              <span>Разрешить ученикам записываться самостоятельно</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.published} onChange={(event) => setForm({ ...form, published: event.target.checked })} />
              <span>Опубликовать для учеников</span>
            </label>
          </>
        ) : null}

        <button className="button" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Создать'}</button>
      </form>
    </Section>
  )
}

