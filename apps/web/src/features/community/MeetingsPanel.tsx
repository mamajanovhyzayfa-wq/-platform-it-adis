import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../../api/client'
import { communityApi } from '../../api/community'
import { eventInputValue, formatDate, meetingStatusLabels } from './shared'

export function MeetingsPanel() {
  const session = getSession()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [teacherId, setTeacherId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [preferredAt, setPreferredAt] = useState(eventInputValue(new Date(Date.now() + 86_400_000)))
  const [duration, setDuration] = useState(30)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const directory = useQuery({ queryKey: ['community-directory'], queryFn: communityApi.directory })
  const meetings = useQuery({ queryKey: ['community-meetings'], queryFn: communityApi.meetings, refetchInterval: 30_000 })

  const create = useMutation({
    mutationFn: () => {
      if (!teacherId) throw new Error('Выберите наставника')
      if (subject.trim().length < 3) throw new Error('Тема должна быть не короче 3 символов')
      return communityApi.createMeeting({
        teacherId,
        ...(studentId ? { studentId } : {}),
        ...(courseId ? { courseId } : {}),
        subject: subject.trim(),
        ...(message.trim() ? { message: message.trim() } : {}),
        preferredAt: new Date(preferredAt).toISOString(),
        durationMinutes: duration,
      })
    },
    onSuccess: () => {
      setNotice('Запрос отправлен наставнику')
      setFormOpen(false)
      setSubject('')
      setMessage('')
      void queryClient.invalidateQueries({ queryKey: ['community-meetings'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => communityApi.respondMeeting(id, status),
    onSuccess: () => {
      setNotice('Статус встречи обновлён')
      void queryClient.invalidateQueries({ queryKey: ['community-meetings'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const visibleMeetings = (meetings.data ?? []).filter((meeting) => {
    if (statusFilter && meeting.status !== statusFilter) return false
    if (!search.trim()) return true
    const haystack = `${meeting.subject} ${meeting.message ?? ''} ${meeting.requester.firstName} ${meeting.requester.lastName} ${meeting.teacher.firstName} ${meeting.teacher.lastName}`
    return haystack.toLowerCase().includes(search.trim().toLowerCase())
  })

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}
      <div className="row-between">
        <p className="muted">Запросы на встречу с наставником, подтверждение и история.</p>
        <button className="button" type="button" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? 'Скрыть форму' : 'Запросить встречу'}
        </button>
      </div>

      {formOpen ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <h2>Новая встреча</h2>
          <div className="form-grid">
            <label className="field">
              <span>Наставник</span>
              <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
                <option value="">— выберите —</option>
                {(directory.data?.teachers ?? []).map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName}
                  </option>
                ))}
              </select>
            </label>
            {session?.role === 'PARENT' ? (
              <label className="field">
                <span>Ребёнок</span>
                <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                  <option value="">— выберите —</option>
                  {(directory.data?.students ?? []).map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Курс (необязательно)</span>
              <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                <option value="">— не указан —</option>
                {(directory.data?.courses ?? []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Тема</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Например, обсудить прогресс" />
            </label>
            <label className="field">
              <span>Дата и время</span>
              <input type="datetime-local" value={preferredAt} onChange={(event) => setPreferredAt(event.target.value)} />
            </label>
            <label className="field">
              <span>Длительность, минут</span>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                {[15, 30, 45, 60, 90].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Сообщение</span>
            <textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div className="row-actions">
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Отправляем…' : 'Отправить запрос'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      <div className="filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по встречам" aria-label="Поиск по встречам" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Статус встречи">
          <option value="">Все статусы</option>
          {Object.entries(meetingStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {meetings.isLoading ? <p className="muted">Загрузка встреч…</p> : null}
      {meetings.error ? <div className="alert alert-error">{errorMessage(meetings.error)}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Тема</th>
              <th>Участники</th>
              <th>Время</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleMeetings.map((meeting) => {
              const canRespond = meeting.teacher.id === session?.id || session?.role === 'ADMIN' || session?.role === 'MANAGER'
              const canCancel = meeting.requester.id === session?.id && meeting.status === 'PENDING'
              return (
                <tr key={meeting.id}>
                  <td>
                    <strong>{meeting.subject}</strong>
                    {meeting.message ? <div className="muted small">{meeting.message}</div> : null}
                  </td>
                  <td className="small">
                    {meeting.requester.firstName} {meeting.requester.lastName} → {meeting.teacher.firstName} {meeting.teacher.lastName}
                    {meeting.student ? ` · ученик: ${meeting.student.firstName} ${meeting.student.lastName}` : ''}
                  </td>
                  <td className="small">
                    {formatDate(meeting.preferredAt)}
                    <div className="muted small">{meeting.durationMinutes} мин</div>
                  </td>
                  <td>
                    <span className="badge">{meetingStatusLabels[meeting.status] ?? meeting.status}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {canRespond && meeting.status === 'PENDING' ? (
                        <>
                          <button className="button button-small" type="button" onClick={() => respond.mutate({ id: meeting.id, status: 'APPROVED' })}>
                            Подтвердить
                          </button>
                          <button className="button button-ghost button-small" type="button" onClick={() => respond.mutate({ id: meeting.id, status: 'DECLINED' })}>
                            Отклонить
                          </button>
                        </>
                      ) : null}
                      {canCancel ? (
                        <button className="button button-ghost button-small" type="button" onClick={() => respond.mutate({ id: meeting.id, status: 'CANCELLED' })}>
                          Отменить
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {visibleMeetings.length === 0 && !meetings.isLoading ? (
        <div className="state">{search || statusFilter ? 'По фильтрам встреч не найдено.' : 'Запросов на встречу пока нет.'}</div>
      ) : null}
    </div>
  )
}

