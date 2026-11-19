import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { errorMessage } from '../api/client'

export function AuditPage() {
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [page, setPage] = useState(1)

  const logs = useQuery({
    queryKey: ['admin-audit', page, action, entity],
    queryFn: () => adminApi.auditLogs({ page, limit: 25, action, entity }),
  })

  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / logs.data.limit)) : 1

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Аудит</h1>
          <p className="muted">Критические действия: роли, блокировки, начисления, изменения данных.</p>
        </div>
      </header>

      <div className="filters">
        <input
          placeholder="Действие, например admin.user.update"
          value={action}
          onChange={(event) => {
            setAction(event.target.value)
            setPage(1)
          }}
        />
        <input
          placeholder="Сущность, например User"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value)
            setPage(1)
          }}
        />
      </div>

      {logs.isLoading ? <div className="state">Загрузка…</div> : null}
      {logs.error ? <div className="alert alert-error">{errorMessage(logs.error)}</div> : null}

      {logs.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Кто</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="small">{new Date(entry.createdAt).toLocaleString('ru-RU')}</td>
                    <td>
                      <div>{entry.actor}</div>
                      <div className="muted small">{entry.actorEmail ?? '—'}</div>
                    </td>
                    <td>
                      <code>{entry.action}</code>
                    </td>
                    <td>
                      {entry.entity}
                      {entry.entityId ? <div className="muted small">{entry.entityId}</div> : null}
                    </td>
                    <td className="small">
                      {entry.metadata ? <code className="code-block">{JSON.stringify(entry.metadata)}</code> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="button button-ghost" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Назад
            </button>
            <span className="muted">
              Страница {page} из {totalPages} · всего {logs.data.total}
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
    </div>
  )
}
