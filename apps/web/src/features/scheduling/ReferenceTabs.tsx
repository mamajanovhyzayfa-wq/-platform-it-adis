import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { schedulingApi, type ScheduleTemplate } from '../../api/scheduling'
import { Empty, Section, StatCard, formatDateTime } from '../../components/ui'
import { addDays, localDate, weekdayLabels } from './shared'

export function TemplatesTab() {
  const queryClient = useQueryClient()
  const courses = useQuery({ queryKey: ['sched-courses'], queryFn: schedulingApi.courses })
  const classrooms = useQuery({ queryKey: ['sched-classrooms'], queryFn: schedulingApi.classrooms })
  const templates = useQuery({ queryKey: ['sched-templates'], queryFn: schedulingApi.templates })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState({
    courseId: '',
    classroomId: '',
    title: '',
    weekdays: [0] as number[],
    startTime: '18:00',
    durationMinutes: 90,
    deliveryMode: 'ONLINE',
  })
  const [from, setFrom] = useState(localDate(new Date()))
  const [to, setTo] = useState(localDate(addDays(new Date(), 90)))

  const create = useMutation({
    mutationFn: () =>
      schedulingApi.createTemplate({
        courseId: form.courseId,
        classroomId: form.classroomId || null,
        title: form.title,
        weekdays: form.weekdays,
        startTime: form.startTime,
        durationMinutes: form.durationMinutes,
        deliveryMode: form.deliveryMode,
      }),
    onSuccess: () => {
      setError(null)
      setMessage('Шаблон сохранён')
      queryClient.invalidateQueries({ queryKey: ['sched-templates'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить шаблон')),
  })
  const apply = useMutation({
    mutationFn: (template: ScheduleTemplate) => schedulingApi.applyTemplate(template.id, { from, to }),
    onSuccess: (result) => {
      setError(null)
      setMessage(`Создано занятий: ${result.created}; пропущено из-за конфликтов: ${result.skipped.length}`)
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось применить шаблон')),
  })

  return (
    <div className="stack">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}
      <Section title="Новый шаблон" subtitle="Дни недели и время, из которых создаётся серия занятий">
        <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
          <div className="form-row">
            <label className="field">
              <span>Курс</span>
              <select required value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}>
                <option value="">Выберите</option>
                {courses.data?.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Название</span>
              <input required minLength={3} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label className="field">
              <span>Аудитория</span>
              <select value={form.classroomId} onChange={(event) => setForm({ ...form, classroomId: event.target.value })}>
                <option value="">Онлайн / без аудитории</option>
                {classrooms.data?.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
          </div>
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
            <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
            <input type="number" min={15} max={480} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} />
            <button className="button button-small" type="submit" disabled={create.isPending || form.weekdays.length === 0}>Добавить шаблон</button>
          </div>
        </form>
      </Section>

      <Section title="Шаблоны" subtitle="Применение создаёт занятия и пропускает конфликтные слоты">
        <div className="form-row">
          <label className="field"><span>С даты</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>По дату</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {templates.data?.length === 0 ? <Empty>Шаблонов пока нет.</Empty> : null}
        <ul className="list">
          {templates.data?.map((template) => (
            <li key={template.id}>
              <div>
                <strong>{template.title}</strong>
                <p className="muted small">
                  {template.course.title} · {template.weekdays.map((day) => weekdayLabels[day]).join(', ')} · {template.startTime} · {template.durationMinutes} мин
                </p>
              </div>
              <div className="row-actions">
                <button className="button button-small" type="button" onClick={() => apply.mutate(template)} disabled={apply.isPending}>Применить</button>
                <button
                  className="button button-ghost button-small"
                  type="button"
                  onClick={async () => {
                    await schedulingApi.deleteTemplate(template.id)
                    queryClient.invalidateQueries({ queryKey: ['sched-templates'] })
                  }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function ClassroomsTab({ isManager }: { isManager: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', capacity: 20, equipment: 'проектор, доска', location: '' })
  const from = new Date().toISOString()
  const to = addDays(new Date(), 14).toISOString()
  const list = useQuery({
    queryKey: ['classroom-availability'],
    queryFn: () => schedulingApi.classroomAvailability({ from, to }),
  })
  const create = useMutation({
    mutationFn: () =>
      schedulingApi.createClassroom({
        name: form.name,
        capacity: form.capacity,
        equipment: form.equipment.split(',').map((item) => item.trim()).filter(Boolean),
        location: form.location || undefined,
        isActive: true,
      }),
    onSuccess: () => {
      setForm({ name: '', capacity: 20, equipment: 'проектор, доска', location: '' })
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['classroom-availability'] })
      queryClient.invalidateQueries({ queryKey: ['sched-classrooms'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать аудиторию')),
  })

  return (
    <div className="stack">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {isManager ? (
        <Section title="Новая аудитория" subtitle="Вместимость и оборудование учитываются при планировании">
          <form className="form-row" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
            <label className="field"><span>Название</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="field"><span>Вместимость</span><input type="number" min={0} value={form.capacity} onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) })} /></label>
            <label className="field"><span>Оборудование (через запятую)</span><input value={form.equipment} onChange={(event) => setForm({ ...form, equipment: event.target.value })} /></label>
            <label className="field"><span>Расположение</span><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
            <button className="button" type="submit" disabled={create.isPending}>Добавить</button>
          </form>
        </Section>
      ) : null}

      <Section title="Занятость на 14 дней" subtitle="Процент использования в рабочие часы и ближайшие брони">
        {list.data?.items.length === 0 ? <Empty>Аудиторий пока нет.</Empty> : null}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Аудитория</th><th>Вместимость</th><th>Оборудование</th><th>Загружено</th><th>Использование</th></tr></thead>
            <tbody>
              {list.data?.items.map((room) => (
                <tr key={room.id}>
                  <td>
                    <strong>{room.name}</strong>
                    <p className="muted small">{room.location ?? '—'}</p>
                    {room.bookings.length > 0 ? (
                      <details>
                        <summary>Расписание</summary>
                        <ul className="list">
                          {room.bookings.map((booking) => (
                            <li key={booking.id}>
                              <span className="muted small">{formatDateTime(booking.startsAt)} · {booking.title}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  <td>{room.capacity}</td>
                  <td className="muted small">{room.equipment.join(', ') || '—'}</td>
                  <td>{room.bookings.length} занятий · {Math.round(room.bookedMinutes / 60)} ч</td>
                  <td>{room.utilization}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

export function ApprovalsTab() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['schedule-changes'], queryFn: () => schedulingApi.changes('PENDING') })
  const act = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? schedulingApi.approveChange(id, 'Подтверждено') : schedulingApi.rejectChange(id, 'Отклонено'),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['schedule-changes'] })
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось рассмотреть заявку')),
  })

  return (
    <div className="stack">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <Section title="Заявки на перенос и отмену" subtitle="Подтверждает менеджер или администратор">
        {list.data?.length === 0 ? <Empty>Ожидающих заявок нет.</Empty> : null}
        <ul className="list">
          {list.data?.map((change) => (
            <li key={change.id}>
              <div>
                <strong>{change.schedule.title}</strong>
                <p className="muted small">
                  {change.type === 'RESCHEDULE' ? 'Перенос' : 'Отмена'} · {change.schedule.course.title} · сейчас {formatDateTime(change.schedule.startsAt)}
                  {change.proposedStartsAt ? ` → ${formatDateTime(change.proposedStartsAt)}` : ''}
                </p>
                <p className="muted small">Инициатор: {change.requestedBy.firstName} {change.requestedBy.lastName} · {change.reason}</p>
              </div>
              <div className="row-actions">
                <button className="button button-small" type="button" onClick={() => act.mutate({ id: change.id, approve: true })}>Подтвердить</button>
                <button className="button button-ghost button-small" type="button" onClick={() => act.mutate({ id: change.id, approve: false })}>Отклонить</button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function StatsTab() {
  const [from] = useState(() => localDate(addDays(new Date(), -30)))
  const [to] = useState(() => localDate(addDays(new Date(), 30)))
  const stats = useQuery({
    queryKey: ['schedule-stats', from, to],
    queryFn: () => schedulingApi.stats(new Date(`${from}T00:00:00`).toISOString(), new Date(`${to}T23:59:59`).toISOString()),
  })
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<Awaited<ReturnType<typeof schedulingApi.aiAnalyze>> | null>(null)
  const analyze = useMutation({
    mutationFn: schedulingApi.aiAnalyze,
    onSuccess: setAi,
    onError: (mutationError) => setError(errorMessage(mutationError, 'AI-анализ недоступен')),
  })

  return (
    <div className="stack">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {stats.data ? (
        <>
          <div className="stats-grid">
            <StatCard label="Проведено" value={stats.data.lessons.conducted} hint="обычных занятий" />
            <StatCard label="Отменено" value={stats.data.lessons.cancelled} hint={`${stats.data.lessons.cancelRate}% от всех`} tone="danger" />
            <StatCard label="Дополнительных" value={stats.data.lessons.extra} />
            <StatCard label="Посещаемость" value={`${stats.data.attendance.present}/${stats.data.attendance.marked}`} hint={`${stats.data.attendance.totalHours} ч`} tone="success" />
            <StatCard label="Опоздали" value={stats.data.attendance.late} tone="warning" />
            <StatCard label="Вышли раньше" value={stats.data.attendance.earlyLeave} tone="warning" />
          </div>

          <Section title="Нагрузка наставников">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Наставник</th><th>Занятий</th><th>Часов</th><th>Отменено</th></tr></thead>
                <tbody>
                  {stats.data.teacherLoad.map((row) => (
                    <tr key={row.teacherId}><td>{row.teacher}</td><td>{row.lessons}</td><td>{row.hours}</td><td>{row.cancelled}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Использование аудиторий">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Аудитория</th><th>Занятий</th><th>Часов</th><th>Использование</th></tr></thead>
                <tbody>
                  {stats.data.classroomUsage.map((row) => (
                    <tr key={row.id}><td>{row.name}</td><td>{row.lessons}</td><td>{row.hours}</td><td>{row.utilization}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : <p className="muted">Загрузка статистики…</p>}

      <Section
        title="AI-анализ расписания"
        subtitle="Предложения по нагрузке, аудиториям и объединению групп"
        action={<button className="button button-small" type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending}>{analyze.isPending ? 'Анализируем…' : 'Проанализировать'}</button>}
      >
        {ai ? (
          <div className="stack-sm">
            <p>{ai.summary}</p>
            {ai.suggestions?.map((suggestion, index) => (
              <div className="ai-panel" key={`${suggestion.title}-${index}`}>
                <strong>{suggestion.title}</strong>
                <p>{suggestion.reason}</p>
                {suggestion.impact ? <p className="muted small">Эффект: {suggestion.impact}</p> : null}
              </div>
            ))}
            {ai.risks?.length ? <p className="muted small">Риски: {ai.risks.join('; ')}</p> : null}
            <p className="muted small">{ai.disclaimer}</p>
          </div>
        ) : <p className="muted small">AI не меняет расписание сам — только предлагает варианты.</p>}
      </Section>
    </div>
  )
}

export function SettingsTab({ isManager }: { isManager: boolean }) {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['recording-settings'], queryFn: schedulingApi.recordingSettings })
  const courses = useQuery({ queryKey: ['sched-courses'], queryFn: schedulingApi.courses })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState({
    recordingEnabled: false,
    recordingAuto: false,
    workingHoursStart: '08:00',
    workingHoursEnd: '21:00',
    slotStepMinutes: 30,
    notifyAbsenceStudent: true,
    notifyAbsenceParent: true,
    notifyAbsenceTeacher: true,
    notifyAbsenceManager: true,
  })
  useEffect(() => {
    if (!settings.data) return
    setForm({
      recordingEnabled: settings.data.recordingEnabled,
      recordingAuto: settings.data.recordingAuto,
      workingHoursStart: settings.data.workingHoursStart,
      workingHoursEnd: settings.data.workingHoursEnd,
      slotStepMinutes: settings.data.slotStepMinutes,
      notifyAbsenceStudent: settings.data.notifyAbsenceStudent,
      notifyAbsenceParent: settings.data.notifyAbsenceParent,
      notifyAbsenceTeacher: settings.data.notifyAbsenceTeacher,
      notifyAbsenceManager: settings.data.notifyAbsenceManager,
    })
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => schedulingApi.updateRecordingSettings(form),
    onSuccess: () => {
      setError(null)
      setMessage('Настройки филиала сохранены')
      queryClient.invalidateQueries({ queryKey: ['recording-settings'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить настройки')),
  })

  return (
    <div className="stack">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}
      <Section title="Запись и рабочие часы филиала" subtitle="Уровни: филиал → группа → занятие">
        {!settings.data ? <p className="muted">Загрузка…</p> : (
          <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
            <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.recordingEnabled} onChange={(event) => setForm({ ...form, recordingEnabled: event.target.checked })} /><span>Запись доступна по умолчанию</span></label>
            <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.recordingAuto} onChange={(event) => setForm({ ...form, recordingAuto: event.target.checked })} /><span>Автоматически запускать запись при входе наставника</span></label>
            <div className="form-row">
              <label className="field"><span>Начало рабочего дня</span><input type="time" disabled={!isManager} value={form.workingHoursStart} onChange={(event) => setForm({ ...form, workingHoursStart: event.target.value })} /></label>
              <label className="field"><span>Конец рабочего дня</span><input type="time" disabled={!isManager} value={form.workingHoursEnd} onChange={(event) => setForm({ ...form, workingHoursEnd: event.target.value })} /></label>
              <label className="field"><span>Шаг слотов, мин</span><input type="number" min={10} max={120} disabled={!isManager} value={form.slotStepMinutes} onChange={(event) => setForm({ ...form, slotStepMinutes: Number(event.target.value) })} /></label>
            </div>
            <div className="stack-sm">
              <p className="muted small">Уведомления о пропуске занятия отправляются автоматически при отметке «Отсутствовал».</p>
              <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.notifyAbsenceStudent} onChange={(event) => setForm({ ...form, notifyAbsenceStudent: event.target.checked })} /><span>Уведомлять ученика</span></label>
              <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.notifyAbsenceParent} onChange={(event) => setForm({ ...form, notifyAbsenceParent: event.target.checked })} /><span>Уведомлять родителя</span></label>
              <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.notifyAbsenceTeacher} onChange={(event) => setForm({ ...form, notifyAbsenceTeacher: event.target.checked })} /><span>Уведомлять наставника</span></label>
              <label className="switch"><input type="checkbox" disabled={!isManager} checked={form.notifyAbsenceManager} onChange={(event) => setForm({ ...form, notifyAbsenceManager: event.target.checked })} /><span>Уведомлять менеджера</span></label>
            </div>
            <button className="button" type="submit" disabled={!isManager || save.isPending}>Сохранить настройки</button>
          </form>
        )}
      </Section>

      <Section title="Запись по группам" subtitle="Настройка курса переопределяет филиал; занятие переопределяет курс">
        <ul className="list">
          {courses.data?.map((course) => (
            <li key={course.id}>
              <div><strong>{course.title}</strong><p className="muted small">{course.students} учеников</p></div>
              <div className="row-actions">
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={course.recordingEnabled ?? false}
                    onChange={async (event) => {
                      await schedulingApi.updateCourseRecording(course.id, { recordingEnabled: event.target.checked })
                      queryClient.invalidateQueries({ queryKey: ['sched-courses'] })
                    }}
                  />
                  запись
                </label>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={course.recordingAuto ?? false}
                    onChange={async (event) => {
                      await schedulingApi.updateCourseRecording(course.id, { recordingAuto: event.target.checked })
                      queryClient.invalidateQueries({ queryKey: ['sched-courses'] })
                    }}
                  />
                  автозапись
                </label>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
