import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { schedulingApi, type AttendanceStatus, type ScheduleDetail } from '../../api/scheduling'
import { formatDateTime, formatTime } from '../../components/ui'
import { modeLabels, statusLabels, toLocalInput } from './shared'

export function ScheduleDetailPanel({
  id,
  isManager,
  onClose,
  onChanged,
}: {
  id: string
  isManager: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['schedule-detail', id], queryFn: () => schedulingApi.schedule(id) })
  const alternatives = useQuery({
    queryKey: ['schedule-alternatives', id],
    queryFn: () => schedulingApi.alternatives(id),
    enabled: Boolean(detail.data?.canManage),
  })
  const teachers = useQuery({ queryKey: ['sched-teachers'], queryFn: schedulingApi.teachers })
  const [rescheduleAt, setRescheduleAt] = useState('')
  const [reason, setReason] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['schedule-detail', id] })
    queryClient.invalidateQueries({ queryKey: ['schedule-alternatives', id] })
    onChanged()
  }
  const act = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      setShowCancel(false)
      setShowReschedule(false)
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось выполнить действие')),
  })

  if (detail.isLoading) return <div className="card state">Загрузка…</div>
  if (detail.error) return <div className="card alert alert-error">{errorMessage(detail.error)}</div>
  if (!detail.data) return null
  const item: ScheduleDetail = detail.data

  const doReschedule = () => {
    if (!rescheduleAt) {
      setError('Укажите новое время')
      return
    }
    const iso = new Date(rescheduleAt).toISOString()
    if (isManager) {
      act.mutate(() => schedulingApi.updateSchedule(id, { startsAt: iso }))
    } else {
      act.mutate(() =>
        schedulingApi.requestChange(id, {
          type: 'RESCHEDULE',
          reason: reason || 'Перенос занятия',
          proposedStartsAt: iso,
        }),
      )
    }
  }

  return (
    <div className="card stack-sm">
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className={`badge badge-${item.status.toLowerCase()}`}>{statusLabels[item.status] ?? item.status}</span>
          <h2>{item.title}</h2>
          <p className="muted small">
            {formatDateTime(item.startsAt)}–{formatTime(item.endsAt)} · {modeLabels[item.deliveryMode]}
            {item.classroom ? ` · ${item.classroom.name}` : ''}
          </p>
        </div>
        <button type="button" className="button button-ghost button-small" onClick={onClose}>Закрыть</button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      <p className="muted small">
        {item.course.title} · {item.teacher.name} · {item.enrolled} учеников
        {item.kind === 'EXTRA' ? ` · дополнительное, мест: ${item.seatsLeft ?? 'без ограничения'}` : ''}
      </p>
      {item.description ? <p>{item.description}</p> : null}
      {item.cancellationReason ? (
        <p className="alert alert-error">
          Причина отмены: {item.cancellationReason}
          {item.cancelledAt ? ` · ${formatDateTime(item.cancelledAt)}` : ''}
          {item.cancelledBy ? ` · ${item.cancelledBy.name}` : ''}
        </p>
      ) : null}

      <div className="row-actions">
        {item.canJoin ? <Link className="button" to={`/lesson/${item.id}`}>Войти в LiveDigital</Link> : null}
        {item.canManage && item.video?.ready ? <Link className="button button-ghost" to={`/lesson/${item.id}`}>Комната и запись</Link> : null}
      </div>

      {item.canManage ? (
        <div className="stack-sm">
          <div className="row-actions">
            <button className="button button-ghost button-small" type="button" onClick={() => setShowReschedule((value) => !value)}>
              {isManager ? 'Перенести' : 'Запросить перенос'}
            </button>
            <button className="button button-ghost button-small" type="button" onClick={() => setShowCancel((value) => !value)}>
              Отменить
            </button>
          </div>

          {showReschedule ? (
            <div className="stack-sm">
              <label className="field">
                <span>Новое время</span>
                <input type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} />
              </label>
              <label className="field">
                <span>Причина</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина переноса" />
              </label>
              <button className="button button-small" type="button" onClick={doReschedule} disabled={act.isPending}>
                {isManager ? 'Применить перенос' : 'Отправить на согласование'}
              </button>
              {alternatives.data?.slots.length ? (
                <div>
                  <p className="muted small">Свободные варианты:</p>
                  {alternatives.data.slots.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => setRescheduleAt(toLocalInput(slot.startsAt))}
                    >
                      {formatDateTime(slot.startsAt)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showCancel ? (
            <div className="stack-sm">
              <label className="field">
                <span>Причина отмены</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button
                className="button button-danger button-small"
                type="button"
                disabled={act.isPending || reason.trim().length < 3}
                onClick={() => act.mutate(() => schedulingApi.cancelSchedule(id, reason))}
              >
                Отменить занятие и уведомить участников
              </button>
            </div>
          ) : null}

          <div className="form-row">
            <label className="field">
              <span>Замена наставника</span>
              <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
                <option value="">Выберите доступного</option>
                {alternatives.data?.availableTeachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
                {teachers.data?.filter((teacher) => !alternatives.data?.availableTeachers.some((item) => item.id === teacher.id)).map((teacher) => (
                  <option key={teacher.id} value={teacher.id} disabled>
                    {teacher.firstName} {teacher.lastName} · занят
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-ghost button-small"
              type="button"
              disabled={!teacherId || !isManager}
              onClick={() => act.mutate(() => schedulingApi.substitute(id, teacherId, reason || undefined))}
            >
              Назначить замену
            </button>
          </div>
          {!isManager ? <p className="muted small">Замену и подтверждение переноса выполняет менеджер или администратор.</p> : null}

          <details>
            <summary>Посещаемость</summary>
            <AttendanceEditor id={id} />
          </details>

          {item.changes && item.changes.length > 0 ? (
            <details>
              <summary>Заявки по занятию ({item.changes.length})</summary>
              <ul className="list">
                {item.changes.map((change) => (
                  <li key={change.id}>
                    <span>
                      {change.type === 'RESCHEDULE' ? 'Перенос' : 'Отмена'} · {statusLabels[change.status] ?? change.status}
                      {change.proposedStartsAt ? ` · ${formatDateTime(change.proposedStartsAt)}` : ''}
                    </span>
                    <span className="muted small">
                      {change.reason} · инициатор {change.requestedBy.firstName} {change.requestedBy.lastName} · {formatDateTime(change.createdAt)}
                      {change.decidedBy ? ` · решил ${change.decidedBy.firstName} ${change.decidedBy.lastName}` : ''}
                      {change.decisionComment ? ` · ${change.decisionComment}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {item.substitutions && item.substitutions.length > 0 ? (
            <details>
              <summary>История замен ({item.substitutions.length})</summary>
              <ul className="list">
                {item.substitutions.map((substitution) => (
                  <li key={substitution.id}>
                    <span>{substitution.fromTeacher.firstName} → {substitution.toTeacher.firstName}</span>
                    <span className="muted small">
                      {formatDateTime(substitution.createdAt)} · назначил {substitution.assignedBy.firstName} {substitution.assignedBy.lastName}
                      {substitution.reason ? ` · ${substitution.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {item.events && item.events.length > 0 ? (
        <details>
          <summary>История изменений ({item.events.length})</summary>
          <ul className="list">
            {item.events.map((event) => (
              <li key={event.id}>
                <span>{event.message ?? event.action}</span>
                <span className="muted small">
                  {formatDateTime(event.createdAt)}
                  {event.actor ? ` · ${event.actor.firstName} ${event.actor.lastName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

type AttendanceDraft = { status: AttendanceStatus; lateMinutes: number; earlyLeaveMinutes: number }

function AttendanceEditor({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const data = useQuery({ queryKey: ['schedule-attendance', id], queryFn: () => schedulingApi.attendance(id) })
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const online = data.data?.schedule.deliveryMode === 'ONLINE'

  const draftFor = (item: NonNullable<typeof data.data>['items'][number]): AttendanceDraft =>
    drafts[item.id] ?? {
      status: item.attendance?.status ?? 'PRESENT',
      lateMinutes: item.attendance?.lateMinutes ?? 10,
      earlyLeaveMinutes: item.attendance?.earlyLeaveMinutes ?? 10,
    }
  const updateDraft = (itemId: string, item: NonNullable<typeof data.data>['items'][number], patch: Partial<AttendanceDraft>) => {
    setDrafts({ ...drafts, [itemId]: { ...draftFor(item), ...patch } })
  }

  const save = useMutation({
    mutationFn: () =>
      schedulingApi.markAttendance(
        id,
        (data.data?.items ?? []).map((item) => {
          const draft = draftFor(item)
          return {
            userId: item.id,
            status: draft.status,
            ...(draft.status === 'LATE' ? { lateMinutes: draft.lateMinutes } : {}),
            ...(draft.status === 'LEFT_EARLY' ? { earlyLeaveMinutes: draft.earlyLeaveMinutes } : {}),
          }
        }),
      ),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['schedule-attendance', id] })
      queryClient.invalidateQueries({ queryKey: ['schedule-detail', id] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить посещаемость')),
  })

  if (data.isLoading) return <p className="muted small">Загрузка…</p>
  if (!data.data) return null
  return (
    <div className="stack-sm">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <p className="muted small">
        {online
          ? 'Онлайн: посещаемость, время входа, выхода и переподключения фиксируются автоматически по данным видеокомнаты.'
          : 'Офлайн: отметьте статус, минуты опоздания или раннего выхода вручную.'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Ученик</th><th>Статус</th><th>Опоздание, мин</th><th>Ранний выход, мин</th><th>Данные</th></tr></thead>
          <tbody>
            {data.data.items.map((item) => {
              const draft = draftFor(item)
              return (
                <tr key={item.id}>
                  <td>{item.name}{item.extra ? ' · доп.' : ''}</td>
                  <td>
                    {online ? (
                      <span>{item.attendance ? ({ PRESENT: 'Присутствовал', LATE: 'Опоздал', LEFT_EARLY: 'Вышел раньше', ABSENT: 'Отсутствовал' }[item.attendance.status]) : '—'}</span>
                    ) : (
                      <select
                        value={draft.status}
                        onChange={(event) => updateDraft(item.id, item, { status: event.target.value as AttendanceStatus })}
                      >
                        <option value="PRESENT">Присутствовал</option>
                        <option value="LATE">Опоздал</option>
                        <option value="LEFT_EARLY">Вышел раньше</option>
                        <option value="ABSENT">Отсутствовал</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={480}
                      value={draft.lateMinutes}
                      disabled={online || draft.status !== 'LATE'}
                      onChange={(event) => updateDraft(item.id, item, { lateMinutes: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={480}
                      value={draft.earlyLeaveMinutes}
                      disabled={online || draft.status !== 'LEFT_EARLY'}
                      onChange={(event) => updateDraft(item.id, item, { earlyLeaveMinutes: Number(event.target.value) })}
                    />
                  </td>
                  <td className="muted small">
                    {item.attendance
                      ? `${item.attendance.source === 'ONLINE' ? 'онлайн' : 'вручную'} · ${Math.round((item.attendance.durationSeconds ?? 0) / 60)} мин · подключений ${1 + (item.attendance.reconnectCount ?? 0)}`
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {online ? null : (
        <button className="button button-small" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          Сохранить посещаемость
        </button>
      )}
    </div>
  )
}

