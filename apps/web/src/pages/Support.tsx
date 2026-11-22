import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import {
  supportApi,
  type SupportPriority,
  type SupportStatus,
  type SupportTicket,
} from '../api/support'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

const statusLabels: Record<SupportStatus, string> = {
  OPEN: 'Открыто',
  IN_PROGRESS: 'В работе',
  RESOLVED: 'Решено',
  CLOSED: 'Закрыто',
}

const statusTone: Record<SupportStatus, string> = {
  OPEN: 'badge-new',
  IN_PROGRESS: 'badge-degraded',
  RESOLVED: 'badge-ok',
  CLOSED: 'badge-muted',
}

const priorityLabels: Record<SupportPriority, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
}

const priorityTone: Record<SupportPriority, string> = {
  LOW: 'badge-muted',
  NORMAL: 'badge-scheduled',
  HIGH: 'badge-warning',
  URGENT: 'badge-failed',
}

function StaffSupport() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SupportStatus | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [draftStatus, setDraftStatus] = useState<SupportStatus>('OPEN')
  const [draftPriority, setDraftPriority] = useState<SupportPriority>('NORMAL')
  const [resolution, setResolution] = useState('')

  const tickets = useQuery({
    queryKey: ['support-tickets', page, status, search],
    queryFn: () =>
      supportApi.list({
        page,
        limit: 20,
        ...(status ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
  })

  const update = useMutation({
    mutationFn: (input: { id: string; payload: Parameters<typeof supportApi.update>[1] }) =>
      supportApi.update(input.id, input.payload),
    onSuccess: (ticket) => {
      setSelected(ticket)
      void queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
    },
  })

  const openTicket = (ticket: SupportTicket) => {
    setSelected(ticket)
    setDraftStatus(ticket.status)
    setDraftPriority(ticket.priority)
    setResolution(ticket.resolution ?? '')
  }

  const totalPages = tickets.data ? Math.max(1, tickets.data.pages) : 1

  return (
    <div className="stack">
      <PageHeader
        title="Поддержка"
        subtitle="Обращения пользователей филиала: статус, приоритет и резолюция. Изменения пишутся в аудит."
      />

      <div className="filters">
        <select
          aria-label="Статус обращения"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as SupportStatus | '')
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          aria-label="Поиск по обращениям"
          placeholder="Тема или текст обращения"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      </div>

      {tickets.isLoading ? <div className="state">Загрузка обращений…</div> : null}
      {tickets.error ? <div className="alert alert-error">{errorMessage(tickets.error)}</div> : null}
      {update.error ? <div className="alert alert-error">{errorMessage(update.error)}</div> : null}

      {tickets.data && tickets.data.data.length === 0 ? <Empty>Обращений нет</Empty> : null}

      {tickets.data && tickets.data.data.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Создано</th>
                  <th>Тема</th>
                  <th>Категория</th>
                  <th>Приоритет</th>
                  <th>Статус</th>
                  <th>Исполнитель</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tickets.data.data.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="small">{formatDateTime(ticket.createdAt)}</td>
                    <td>
                      <strong>{ticket.subject}</strong>
                      <div className="muted small">{ticket.message.slice(0, 90)}…</div>
                    </td>
                    <td className="small">{ticket.category}</td>
                    <td>
                      <span className={`badge ${priorityTone[ticket.priority]}`}>
                        {priorityLabels[ticket.priority]}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusTone[ticket.status]}`}>{statusLabels[ticket.status]}</span>
                    </td>
                    <td className="small">
                      {ticket.assignedTo
                        ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`
                        : 'не назначен'}
                    </td>
                    <td>
                      <button className="button button-ghost" type="button" onClick={() => openTicket(ticket)}>
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="button button-ghost"
              type="button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </button>
            <span className="muted">
              Страница {tickets.data.page} из {totalPages} · всего {tickets.data.total}
            </span>
            <button
              className="button button-ghost"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Вперёд
            </button>
          </div>
        </>
      ) : null}

      {selected ? (
        <Section
          title={`Обращение: ${selected.subject}`}
          subtitle={`Создано ${formatDateTime(selected.createdAt)} · пользователь ${selected.userId}`}
          action={
            <button className="button button-ghost" type="button" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          }
        >
          <p style={{ whiteSpace: 'pre-wrap' }}>{selected.message}</p>

          <div className="form-grid">
            <label>
              <span>Статус</span>
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as SupportStatus)}>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Приоритет</span>
              <select
                value={draftPriority}
                onChange={(event) => setDraftPriority(event.target.value as SupportPriority)}
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Резолюция</span>
            <textarea
              rows={4}
              maxLength={2000}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Что сделано и чем закрыто обращение"
            />
          </label>

          <button
            className="button"
            type="button"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                id: selected.id,
                payload: {
                  status: draftStatus,
                  priority: draftPriority,
                  resolution: resolution.trim() ? resolution.trim() : null,
                },
              })
            }
          >
            {update.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </Section>
      ) : null}
    </div>
  )
}

const categoryLabels: Record<string, string> = {
  TECHNICAL: 'Техническая проблема',
  ACCESS: 'Доступ и вход',
  PAYMENT: 'Оплата и счёт',
  SCHEDULE: 'Расписание и занятия',
  OTHER: 'Другое',
}

/** Создание обращения доступно любой роли: сервер сам привязывает его к текущему пользователю. */
function CreateTicketForm({ onCreated }: { onCreated: () => void }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('OTHER')
  const [priority, setPriority] = useState<SupportPriority>('NORMAL')

  const create = useMutation({
    mutationFn: () =>
      supportApi.create({
        subject: subject.trim(),
        message: message.trim(),
        category,
        priority,
      }),
    onSuccess: () => {
      setSubject('')
      setMessage('')
      setCategory('OTHER')
      setPriority('NORMAL')
      onCreated()
    },
  })

  return (
    <Section
      title="Новое обращение"
      subtitle="Опишите проблему: администратор или менеджер филиала ответит и укажет решение в обращении."
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (subject.trim().length < 3) return
          if (message.trim().length < 10) return
          create.mutate()
        }}
      >
        {create.error ? <div className="alert alert-error">{errorMessage(create.error)}</div> : null}

        <div className="form-grid">
          <label className="field">
            <span>Тема</span>
            <input
              value={subject}
              maxLength={160}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Коротко о проблеме"
            />
          </label>

          <label className="field">
            <span>Категория</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Приоритет</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as SupportPriority)}
            >
              <option value="LOW">Низкий</option>
              <option value="NORMAL">Обычный</option>
              <option value="HIGH">Высокий</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>Описание</span>
          <textarea
            rows={5}
            maxLength={5000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Что произошло, на какой странице, что уже пробовали"
          />
        </label>

        <button
          className="button"
          type="submit"
          disabled={create.isPending || subject.trim().length < 3 || message.trim().length < 10}
        >
          {create.isPending ? 'Отправляем…' : 'Отправить обращение'}
        </button>
      </form>
    </Section>
  )
}

/** Кабинет ученика, родителя и наставника: только свои обращения и их решения. */
function MySupport() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)

  const tickets = useQuery({
    queryKey: ['support-tickets', 'mine', page],
    queryFn: () => supportApi.list({ page, limit: 10 }),
  })

  const totalPages = tickets.data ? Math.max(1, tickets.data.pages) : 1

  return (
    <div className="stack">
      <PageHeader
        title="Поддержка"
        subtitle="Ваши обращения в поддержку филиала и ответы по ним. История сохраняется."
      />

      {notice ? <div className="alert">{notice}</div> : null}

      <CreateTicketForm
        onCreated={() => {
          setNotice('Обращение отправлено. Ответ появится в этом разделе.')
          setPage(1)
          void queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
        }}
      />

      <Section title="Мои обращения" subtitle="Статус обновляет поддержка; решение отображается под описанием.">
        {tickets.isLoading ? <p className="muted">Загрузка обращений…</p> : null}
        {tickets.error ? <div className="alert alert-error">{errorMessage(tickets.error)}</div> : null}
        {tickets.data && tickets.data.data.length === 0 ? (
          <Empty>Обращений пока нет</Empty>
        ) : null}

        {tickets.data && tickets.data.data.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Создано</th>
                    <th>Тема</th>
                    <th>Статус</th>
                    <th>Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.data.data.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="small">{formatDateTime(ticket.createdAt)}</td>
                      <td>
                        <strong>{ticket.subject}</strong>
                        <div className="muted small">{ticket.message}</div>
                        {ticket.resolution ? (
                          <div className="small" style={{ marginTop: 6 }}>
                            <strong>Решение: </strong>
                            {ticket.resolution}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge ${statusTone[ticket.status]}`}>
                          {statusLabels[ticket.status]}
                        </span>
                      </td>
                      <td className="small">{formatDateTime(ticket.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                className="button button-ghost"
                type="button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </button>
              <span className="muted">
                Страница {tickets.data.page} из {totalPages} · всего {tickets.data.total}
              </span>
              <button
                className="button button-ghost"
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Вперёд
              </button>
            </div>
          </>
        ) : null}
      </Section>
    </div>
  )
}

export function SupportPage() {
  const role = getSession()?.role
  const staff = role === 'ADMIN' || role === 'MANAGER'
  return staff ? <StaffSupport /> : <MySupport />
}
