import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../../api/client'
import { communityApi, type CommunityEvent } from '../../api/community'
import {
  eventInputValue,
  eventStatusLabels,
  eventTypeLabels,
  formatDate,
  registrationStatusLabels,
} from './shared'

export function EventsPanel({ staff }: { staff: boolean }) {
  const session = getSession()
  const queryClient = useQueryClient()
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [eventType, setEventType] = useState('EVENT')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [startsAt, setStartsAt] = useState(eventInputValue(new Date(Date.now() + 7 * 86_400_000)))
  const [endsAt, setEndsAt] = useState(eventInputValue(new Date(Date.now() + 8 * 86_400_000)))
  const [registrationDeadline, setRegistrationDeadline] = useState('')
  const [location, setLocation] = useState('')
  const [capacity, setCapacity] = useState('')
  const [visibility, setVisibility] = useState('BRANCH')
  const [courseId, setCourseId] = useState('')

  const directory = useQuery({ queryKey: ['community-directory'], queryFn: communityApi.directory })
  const events = useQuery({
    queryKey: ['community-events', type, search, status, page],
    queryFn: () =>
      communityApi.events({
        ...(type ? { type } : {}),
        ...(search ? { q: search } : {}),
        ...(status ? { status } : {}),
        page,
        limit: 20,
      }),
    refetchInterval: 30_000,
  })
  const event = useQuery({
    queryKey: ['community-event', selectedId],
    queryFn: () => communityApi.event(selectedId),
    enabled: Boolean(selectedId),
  })

  const create = useMutation({
    mutationFn: () => {
      if (title.trim().length < 3) throw new Error('Укажите название')
      if (description.trim().length < 3) throw new Error('Добавьте описание')
      if (new Date(startsAt) >= new Date(endsAt)) throw new Error('Дата окончания должна быть позже начала')
      if (visibility === 'COURSE' && !courseId) throw new Error('Выберите курс')
      return communityApi.createEvent({
        type: eventType,
        title: title.trim(),
        description: description.trim(),
        ...(rules.trim() ? { rules: rules.trim() } : {}),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        ...(registrationDeadline ? { registrationDeadline: new Date(registrationDeadline).toISOString() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(capacity ? { capacity: Number(capacity) } : {}),
        visibility,
        ...(courseId ? { courseId } : {}),
      })
    },
    onSuccess: (created) => {
      setNotice('Мероприятие создано как черновик. Опубликуйте его, чтобы открыть регистрацию.')
      setFormOpen(false)
      setSelectedId(created.id)
      void queryClient.invalidateQueries({ queryKey: ['community-events'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const publish = useMutation({
    mutationFn: (id: string) => communityApi.updateEvent(id, { status: 'REGISTRATION' }),
    onSuccess: () => {
      setNotice('Мероприятие опубликовано, регистрация открыта')
      void queryClient.invalidateQueries({ queryKey: ['community-events'] })
      void queryClient.invalidateQueries({ queryKey: ['community-event', selectedId] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const register = useMutation({
    mutationFn: (id: string) => communityApi.registerEvent(id),
    onSuccess: () => {
      setNotice('Регистрация оформлена')
      void queryClient.invalidateQueries({ queryKey: ['community-events'] })
      void queryClient.invalidateQueries({ queryKey: ['community-event', selectedId] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => communityApi.cancelEvent(id),
    onSuccess: () => {
      setNotice('Регистрация отменена')
      void queryClient.invalidateQueries({ queryKey: ['community-events'] })
      void queryClient.invalidateQueries({ queryKey: ['community-event', selectedId] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}
      <div className="row-between">
        <p className="muted">Конкурсы, олимпиады и внутренние соревнования. Рейтинг считается только внутри выбранного мероприятия.</p>
        {staff ? (
          <button className="button" type="button" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? 'Скрыть форму' : 'Создать мероприятие'}
          </button>
        ) : null}
      </div>

      {staff && formOpen ? (
        <form
          className="card stack"
          onSubmit={(eventObject) => {
            eventObject.preventDefault()
            create.mutate()
          }}
        >
          <h2>Новое мероприятие</h2>
          <div className="form-grid">
            <label className="field">
              <span>Тип</span>
              <select value={eventType} onChange={(eventObject) => setEventType(eventObject.target.value)}>
                {Object.entries(eventTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Название</span>
              <input value={title} onChange={(eventObject) => setTitle(eventObject.target.value)} />
            </label>
            <label className="field">
              <span>Начало</span>
              <input type="datetime-local" value={startsAt} onChange={(eventObject) => setStartsAt(eventObject.target.value)} />
            </label>
            <label className="field">
              <span>Окончание</span>
              <input type="datetime-local" value={endsAt} onChange={(eventObject) => setEndsAt(eventObject.target.value)} />
            </label>
            <label className="field">
              <span>Крайний срок регистрации</span>
              <input type="datetime-local" value={registrationDeadline} onChange={(eventObject) => setRegistrationDeadline(eventObject.target.value)} />
            </label>
            <label className="field">
              <span>Место</span>
              <input value={location} onChange={(eventObject) => setLocation(eventObject.target.value)} placeholder="Аудитория или онлайн" />
            </label>
            <label className="field">
              <span>Лимит участников</span>
              <input type="number" min={1} value={capacity} onChange={(eventObject) => setCapacity(eventObject.target.value)} />
            </label>
            <label className="field">
              <span>Доступ</span>
              <select value={visibility} onChange={(eventObject) => setVisibility(eventObject.target.value)}>
                <option value="BRANCH">Все ученики филиала</option>
                <option value="COURSE">Только курс</option>
                <option value="PUBLIC">Публичное</option>
              </select>
            </label>
            {visibility === 'COURSE' ? (
              <label className="field">
                <span>Курс</span>
                <select value={courseId} onChange={(eventObject) => setCourseId(eventObject.target.value)}>
                  <option value="">— выберите —</option>
                  {(directory.data?.courses ?? []).map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="field">
            <span>Описание</span>
            <textarea rows={3} value={description} onChange={(eventObject) => setDescription(eventObject.target.value)} />
          </label>
          <label className="field">
            <span>Правила</span>
            <textarea rows={3} value={rules} onChange={(eventObject) => setRules(eventObject.target.value)} />
          </label>
          <div className="row-actions">
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      <div className="filters">
        <input
          value={search}
          onChange={(eventObject) => {
            setSearch(eventObject.target.value)
            setPage(1)
          }}
          placeholder="Поиск мероприятий"
          aria-label="Поиск мероприятий"
        />
        <select
          value={type}
          onChange={(eventObject) => {
            setType(eventObject.target.value)
            setPage(1)
          }}
          aria-label="Тип мероприятия"
        >
          <option value="">Все типы</option>
          {Object.entries(eventTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(eventObject) => {
            setStatus(eventObject.target.value)
            setPage(1)
          }}
          aria-label="Статус мероприятия"
        >
          <option value="">Актуальные</option>
          <option value="PUBLISHED">Опубликованные</option>
          <option value="REGISTRATION">Идёт регистрация</option>
          <option value="ONGOING">Проводятся</option>
          <option value="COMPLETED">История: завершённые</option>
          <option value="CANCELLED">Отменённые</option>
          {staff ? <option value="DRAFT">Черновики</option> : null}
        </select>
      </div>

      {events.isLoading ? <p className="muted">Загрузка мероприятий…</p> : null}
      {events.error ? <div className="alert alert-error">{errorMessage(events.error)}</div> : null}

      <div className="grid-2">
        <div className="stack">
          {(events.data?.items ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === selectedId ? 'card event-card event-card-active' : 'card event-card'}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="row-between">
                <span className="badge">{eventTypeLabels[item.type] ?? item.type}</span>
                <span className="muted small">{eventStatusLabels[item.status] ?? item.status}</span>
              </div>
              <h2>{item.title}</h2>
              <p className="muted small">
                {formatDate(item.startsAt)} — {formatDate(item.endsAt)}
                {item.location ? ` · ${item.location}` : ''}
              </p>
              <span className="muted small">
                Участников: {item._count?.registrations ?? 0}
                {item.capacity ? ` из ${item.capacity}` : ''} · заданий: {item._count?.tasks ?? 0}
              </span>
              {item.registered ? <span className="badge badge-approved">Вы зарегистрированы</span> : null}
            </button>
          ))}
          {(events.data?.items ?? []).length === 0 && !events.isLoading ? <div className="state">Мероприятий пока нет.</div> : null}
          {events.data && events.data.total > 0 ? (
            <div className="pagination">
              <button className="button button-ghost" type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                Назад
              </button>
              <span className="muted">
                Страница {page} из {events.data.pages} · всего {events.data.total}
              </span>
              <button
                className="button button-ghost"
                type="button"
                disabled={page >= events.data.pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Вперёд
              </button>
            </div>
          ) : null}
        </div>

        <div className="stack">
          {!selectedId ? <div className="state">Выберите мероприятие, чтобы увидеть правила, участников и рейтинг.</div> : null}
          {event.isLoading ? <p className="muted">Загрузка мероприятия…</p> : null}
          {event.error ? <div className="alert alert-error">{errorMessage(event.error)}</div> : null}
          {event.data ? (
            <EventDetails
              event={event.data}
              staff={staff}
              role={session?.role ?? ''}
              onPublish={() => publish.mutate(event.data!.id)}
              onRegister={() => register.mutate(event.data!.id)}
              onCancel={() => cancel.mutate(event.data!.id)}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: ['community-event', selectedId] })
                void queryClient.invalidateQueries({ queryKey: ['community-events'] })
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function EventDetails({
  event,
  staff,
  role,
  onPublish,
  onRegister,
  onCancel,
  onRefresh,
}: {
  event: CommunityEvent
  staff: boolean
  role: string
  onPublish: () => void
  onRegister: () => void
  onCancel: () => void
  onRefresh: () => void
}) {
  const [taskTitle, setTaskTitle] = useState('')
  const [taskMax, setTaskMax] = useState('100')
  const [taskDue, setTaskDue] = useState('')
  const [resultUserId, setResultUserId] = useState('')
  const [resultTaskId, setResultTaskId] = useState('')
  const [resultScore, setResultScore] = useState('')
  const [resultPlace, setResultPlace] = useState('')
  const [publishResult, setPublishResult] = useState(true)
  const [awardTitle, setAwardTitle] = useState('')
  const [awardUserId, setAwardUserId] = useState('')
  const [awardPlace, setAwardPlace] = useState('')
  const [error, setError] = useState<string | null>(null)

  const addTask = useMutation({
    mutationFn: () =>
      communityApi.addTask(event.id, {
        title: taskTitle.trim(),
        ...(taskDue ? { dueAt: new Date(taskDue).toISOString() } : {}),
        ...(taskMax ? { maxScore: Number(taskMax) } : {}),
        position: (event.tasks?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      setTaskTitle('')
      setTaskDue('')
      setError(null)
      onRefresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const addResult = useMutation({
    mutationFn: () =>
      communityApi.addResult(event.id, {
        userId: resultUserId,
        ...(resultTaskId ? { taskId: resultTaskId } : {}),
        ...(resultScore ? { score: Number(resultScore) } : {}),
        ...(resultPlace ? { place: Number(resultPlace) } : {}),
        publish: publishResult,
      }),
    onSuccess: () => {
      setResultTaskId('')
      setResultScore('')
      setResultPlace('')
      setError(null)
      onRefresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const addAward = useMutation({
    mutationFn: () =>
      communityApi.addAward(event.id, {
        title: awardTitle.trim(),
        ...(awardUserId ? { userId: awardUserId } : {}),
        ...(awardPlace ? { place: Number(awardPlace) } : {}),
      }),
    onSuccess: () => {
      setAwardTitle('')
      setAwardUserId('')
      setAwardPlace('')
      setError(null)
      onRefresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const canRegister = ['STUDENT', 'PARENT'].includes(role) && ['PUBLISHED', 'REGISTRATION'].includes(event.status)

  return (
    <article className="card stack">
      <div className="row-between">
        <div>
          <span className="badge">{eventTypeLabels[event.type] ?? event.type}</span>
          <h2>{event.title}</h2>
          <p className="muted small">
            {formatDate(event.startsAt)} — {formatDate(event.endsAt)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <span className="badge">{eventStatusLabels[event.status] ?? event.status}</span>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      <p className="announcement-body">{event.description}</p>
      {event.rules ? (
        <section>
          <h3>Правила</h3>
          <p className="announcement-body">{event.rules}</p>
        </section>
      ) : null}
      {event.registrationDeadline ? <p className="muted small">Регистрация до {formatDate(event.registrationDeadline)}</p> : null}
      {event.onlineUrl ? (
        <a className="file-link" href={event.onlineUrl} target="_blank" rel="noreferrer">
          Ссылка на мероприятие
        </a>
      ) : null}

      <div className="row-actions">
        {canRegister && !event.registered ? (
          <button className="button" type="button" onClick={onRegister}>
            Зарегистрироваться
          </button>
        ) : null}
        {canRegister && event.registered ? (
          <button className="button button-ghost" type="button" onClick={onCancel}>
            Отменить регистрацию
          </button>
        ) : null}
        {staff && (event.status === 'DRAFT' || event.status === 'PUBLISHED') ? (
          <button className="button" type="button" onClick={onPublish}>
            Опубликовать и открыть регистрацию
          </button>
        ) : null}
      </div>

      <section>
        <h3>Задания</h3>
        {(event.tasks ?? []).length ? (
          <ul className="material-list">
            {(event.tasks ?? []).map((task) => (
              <li key={task.id} className="material-item">
                <strong>{task.title}</strong>
                <span className="muted small">
                  {task.maxScore ? ` · до ${task.maxScore} баллов` : ''}
                  {task.dueAt ? ` · до ${formatDate(task.dueAt)}` : ''}
                </span>
                {task.description ? <p className="muted small">{task.description}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Задания ещё не добавлены.</p>
        )}
        {staff ? (
          <form
            className="form-grid"
            onSubmit={(eventObject) => {
              eventObject.preventDefault()
              if (taskTitle.trim().length < 3) return
              addTask.mutate()
            }}
          >
            <input value={taskTitle} onChange={(eventObject) => setTaskTitle(eventObject.target.value)} placeholder="Название задания" />
            <input type="number" min={1} value={taskMax} onChange={(eventObject) => setTaskMax(eventObject.target.value)} placeholder="Макс. балл" />
            <input type="datetime-local" value={taskDue} onChange={(eventObject) => setTaskDue(eventObject.target.value)} />
            <button className="button button-small" type="submit" disabled={addTask.isPending}>
              Добавить задание
            </button>
          </form>
        ) : null}
      </section>

      <section>
        <h3>Результаты</h3>
        {(event.results ?? []).length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Задание</th>
                  <th>Балл</th>
                  <th>Место</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {(event.results ?? []).map((result) => (
                  <tr key={result.id}>
                    <td>
                      {result.user.firstName} {result.user.lastName}
                      {result.comment ? <div className="muted small">{result.comment}</div> : null}
                    </td>
                    <td>{result.task?.title ?? 'Общий итог'}</td>
                    <td>{result.score ?? '—'}</td>
                    <td>{result.place ?? '—'}</td>
                    <td>{result.publishedAt ? 'Опубликован' : 'Черновик'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Результаты ещё не внесены.</p>
        )}
      </section>

      <section>
        <h3>Участники</h3>
        {(event.participants ?? []).length ? (
          <ul className="material-list">
            {(event.participants ?? []).map((participant) => (
              <li key={participant.id} className="row-between">
                <span>
                  {participant.user.firstName} {participant.user.lastName}
                </span>
                <span className="badge">{registrationStatusLabels[participant.status] ?? participant.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Пока никто не зарегистрировался.</p>
        )}
      </section>

      <section>
        <h3>Рейтинг мероприятия</h3>
        <p className="muted small">
          Рейтинг относится только к участникам этого мероприятия, включает зарегистрированных без результатов и не меняет общий рейтинг группы.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Место</th>
                <th>Участник</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {(event.ranking ?? []).map((row, index) => (
                <tr key={row.userId}>
                  <td>{row.place ?? index + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(event.awards ?? []).length ? (
        <section>
          <h3>Награды</h3>
          <ul className="material-list">
            {(event.awards ?? []).map((award) => (
              <li key={award.id}>
                <strong>{award.title}</strong>
                {award.place ? ` · ${award.place} место` : ''}
                {award.user ? ` · ${award.user.firstName} ${award.user.lastName}` : ''}
                {award.description ? <p className="muted small">{award.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {staff ? (
        <section className="stack">
          <h3>Результаты и награды</h3>
          <form
            className="form-grid"
            onSubmit={(eventObject) => {
              eventObject.preventDefault()
              if (!resultUserId) return
              addResult.mutate()
            }}
          >
            <select value={resultUserId} onChange={(eventObject) => setResultUserId(eventObject.target.value)}>
              <option value="">Участник</option>
              {(event.participants ?? []).filter((participant) => participant.status === 'REGISTERED').map((participant) => (
                <option key={participant.user.id} value={participant.user.id}>
                  {participant.user.firstName} {participant.user.lastName}
                </option>
              ))}
            </select>
            <select value={resultTaskId} onChange={(eventObject) => setResultTaskId(eventObject.target.value)}>
              <option value="">Общий итог</option>
              {(event.tasks ?? []).map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <input type="number" min={0} value={resultScore} onChange={(eventObject) => setResultScore(eventObject.target.value)} placeholder="Баллы" />
            <input type="number" min={1} value={resultPlace} onChange={(eventObject) => setResultPlace(eventObject.target.value)} placeholder="Место" />
            <label className="switch">
              <input type="checkbox" checked={publishResult} onChange={(eventObject) => setPublishResult(eventObject.target.checked)} />
              <span>Опубликовать</span>
            </label>
            <button className="button button-small" type="submit" disabled={addResult.isPending || !resultUserId}>
              Сохранить результат
            </button>
          </form>

          <form
            className="form-grid"
            onSubmit={(eventObject) => {
              eventObject.preventDefault()
              if (awardTitle.trim().length < 2) return
              addAward.mutate()
            }}
          >
            <input value={awardTitle} onChange={(eventObject) => setAwardTitle(eventObject.target.value)} placeholder="Название награды" />
            <input type="number" min={1} value={awardPlace} onChange={(eventObject) => setAwardPlace(eventObject.target.value)} placeholder="Место (если есть)" />
            <select value={awardUserId} onChange={(eventObject) => setAwardUserId(eventObject.target.value)}>
              <option value="">Без привязки к участнику</option>
              {(event.participants ?? []).filter((participant) => participant.status === 'REGISTERED').map((participant) => (
                <option key={participant.user.id} value={participant.user.id}>
                  {participant.user.firstName} {participant.user.lastName}
                </option>
              ))}
            </select>
            <button className="button button-ghost button-small" type="submit" disabled={addAward.isPending}>
              Выдать награду
            </button>
          </form>
        </section>
      ) : null}
    </article>
  )
}
