import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../api/access'
import { errorMessage } from '../api/client'
import { privacyApi, type DeletionRequest } from '../api/privacy'

const statusLabels: Record<DeletionRequest['status'], string> = {
  PENDING: 'На рассмотрении',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  CANCELLED: 'Отменено',
}

export function PrivacyAdminPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'deletion' | 'files'>('deletion')
  const [status, setStatus] = useState('PENDING')
  const [selected, setSelected] = useState<DeletionRequest | null>(null)
  const [comment, setComment] = useState('')
  const [legalHold, setLegalHold] = useState(false)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const requests = useQuery({
    queryKey: ['privacy-admin-deletion', status],
    queryFn: () => privacyApi.adminDeletionRequests(status === 'ALL' ? undefined : status),
    enabled: tab === 'deletion',
  })
  const files = useQuery({
    queryKey: ['privacy-admin-files'],
    queryFn: () => privacyApi.fileAudit(),
    enabled: tab === 'files',
  })

  const review = useMutation({
    mutationFn: async (approve: boolean) => {
      if (!selected) throw new Error('Запрос не выбран')
      if (!password.trim()) throw new Error('Введите пароль для повторного подтверждения')
      await accessApi.stepUp(password)
      return privacyApi.reviewDeletion(selected.id, approve, comment.trim() || undefined, legalHold)
    },
    onSuccess: (request) => {
      setMessage(
        request.status === 'APPROVED'
          ? 'Запрос одобрен. Персональные данные удалены, обязательные сведения сохранены.'
          : 'Запрос отклонён, история сохранена.',
      )
      setError('')
      setPassword('')
      setSelected((current) => ({ ...request, user: current?.user }))
      void queryClient.invalidateQueries({ queryKey: ['privacy-admin-deletion'] })
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Конфиденциальность</h1>
          <p className="muted">
            Запросы на удаление аккаунта и журнал загрузок/скачиваний. Решение требует повторной авторизации.
          </p>
        </div>
        <div className="row gap">
          <button className={tab === 'deletion' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('deletion')}>
            Удаление аккаунтов
          </button>
          <button className={tab === 'files' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('files')}>
            Журнал файлов
          </button>
        </div>
      </header>

      {message ? <div className="alert alert-success">{message}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {tab === 'deletion' ? (
        <>
          <div className="filters">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="PENDING">На рассмотрении</option>
              <option value="APPROVED">Одобренные</option>
              <option value="REJECTED">Отклонённые</option>
              <option value="CANCELLED">Отменённые</option>
              <option value="ALL">Все</option>
            </select>
          </div>

          {requests.isLoading ? <div className="state">Загрузка…</div> : null}
          {requests.error ? <div className="alert alert-error">{errorMessage(requests.error)}</div> : null}

          <div className="privacy-admin-layout">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Пользователь</th>
                    <th>Причина</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {(requests.data ?? []).map((request) => (
                    <tr
                      key={request.id}
                      className={selected?.id === request.id ? 'row-active' : undefined}
                      onClick={() => {
                        setSelected(request)
                        setComment(request.adminComment ?? '')
                        setLegalHold(request.legalHold)
                        setMessage('')
                        setError('')
                      }}
                    >
                      <td>{new Date(request.requestedAt).toLocaleString('ru-RU')}</td>
                      <td>
                        {request.user ? `${request.user.firstName} ${request.user.lastName}` : '—'}
                        <div className="muted small">{request.user?.email}</div>
                      </td>
                      <td>{request.reason ?? '—'}</td>
                      <td>
                        <span className="badge">{statusLabels[request.status]}</span>
                      </td>
                    </tr>
                  ))}
                  {!requests.isLoading && !(requests.data ?? []).length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Запросов нет.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {selected ? (
              <aside className="card stack privacy-admin-detail">
                <h2>Запрос</h2>
                <p>
                  <strong>
                    {selected.user?.firstName} {selected.user?.lastName}
                  </strong>
                  <br />
                  <span className="muted">{selected.user?.email}</span>
                  <br />
                  <span className="muted small">
                    Роль: {selected.user?.role} · регистрация{' '}
                    {selected.user ? new Date(selected.user.createdAt).toLocaleDateString('ru-RU') : '—'}
                  </span>
                </p>

                <ul className="timeline">
                  {selected.events.map((event) => (
                    <li key={event.id}>
                      {new Date(event.createdAt).toLocaleString('ru-RU')} — {statusLabels[event.status]}
                      {event.comment ? `: ${event.comment}` : ''}
                    </li>
                  ))}
                </ul>

                {selected.status === 'PENDING' ? (
                  <>
                    <label>
                      Комментарий администратора
                      <textarea
                        rows={3}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="Основание решения, какие данные сохранены"
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={legalHold}
                        onChange={(event) => setLegalHold(event.target.checked)}
                      />
                      Есть законное основание хранить данные (legal hold)
                    </label>
                    <label>
                      Пароль для подтверждения
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <p className="muted small">
                      При одобрении удаляются имя, email, телефон, аватар, профиль, сессии и устройства;
                      обезличиваются сообщения, комментарии, вложения и тексты заданий, заметки, AI-запросы и
                      уведомления. Платёжные, налоговые, сертификатные и аудиторские записи сохраняются в
                      обязательном объёме. Файлы помечаются удалёнными и исключаются из API.
                    </p>
                    <div className="row gap">
                      <button
                        className="btn btn-danger"
                        disabled={review.isPending || legalHold}
                        onClick={() => review.mutate(true)}
                      >
                        Удалить разрешённые данные
                      </button>
                      <button className="btn" disabled={review.isPending} onClick={() => review.mutate(false)}>
                        Отклонить
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">Запрос уже обработан. Повторное решение недоступно.</p>
                )}
              </aside>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {files.isLoading ? <div className="state">Загрузка…</div> : null}
          {files.error ? <div className="alert alert-error">{errorMessage(files.error)}</div> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Кто</th>
                  <th>Действие</th>
                  <th>Файл</th>
                  <th>Проверка</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {(files.data ?? []).map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString('ru-RU')}</td>
                    <td>{log.user ? `${log.user.firstName} ${log.user.lastName}` : 'гость / система'}</td>
                    <td>{log.action === 'UPLOAD' ? 'загрузка' : 'скачивание'}</td>
                    <td>
                      <div>{log.fileName}</div>
                      <div className="muted small">
                        {log.mimeType ?? '—'} · {log.sizeBytes ? `${Math.round(log.sizeBytes / 1024)} КБ` : '—'}
                      </div>
                    </td>
                    <td>
                      <span className={log.scanStatus === 'CLEAN' || log.scanStatus === 'EXTERNAL' ? 'badge badge-success' : 'badge badge-danger'}>
                        {log.scanStatus}
                      </span>
                    </td>
                    <td className="mono small">{log.sha256 ? `${log.sha256.slice(0, 16)}…` : '—'}</td>
                  </tr>
                ))}
                {!files.isLoading && !(files.data ?? []).length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Событий пока нет.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
