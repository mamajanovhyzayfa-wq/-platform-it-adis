import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { errorMessage } from '../api/client'

type Tab = 'homework' | 'tests'

const submissionStatuses = [
  { value: 'SUBMITTED', label: 'На проверке' },
  { value: 'REVIEWED', label: 'Проверено' },
  { value: 'RETURNED', label: 'На доработке' },
  { value: 'ALL', label: 'Все' },
] as const

const statusLabels: Record<string, string> = {
  SUBMITTED: 'На проверке',
  REVIEWED: 'Проверено',
  RETURNED: 'На доработке',
  IN_PROGRESS: 'Идёт',
  COMPLETED: 'Завершён',
  EXPIRED: 'Истёк',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

/** Проверка домашних работ и результатов тестов: сервер уже посчитал баллы. */
export function ReviewPage() {
  const [tab, setTab] = useState<Tab>('homework')
  const [status, setStatus] = useState<(typeof submissionStatuses)[number]['value']>('SUBMITTED')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const submissions = useQuery({
    queryKey: ['admin-submissions', page, status, search],
    queryFn: () => adminApi.submissions({ page, limit: 20, status, search }),
    enabled: tab === 'homework',
  })

  const attempts = useQuery({
    queryKey: ['admin-test-attempts', page],
    queryFn: () => adminApi.testAttempts({ page, limit: 20 }),
    enabled: tab === 'tests',
  })

  const total = tab === 'homework' ? submissions.data?.total ?? 0 : attempts.data?.total ?? 0
  const limit = tab === 'homework' ? submissions.data?.limit ?? 20 : attempts.data?.limit ?? 20
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Проверка работ</h1>
          <p className="muted">Очередь домашних заданий и результаты тестов. Баллы считает сервер.</p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'homework'}
          className={tab === 'homework' ? 'tab tab-active' : 'tab'}
          onClick={() => {
            setTab('homework')
            setPage(1)
          }}
        >
          Домашние работы
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tests'}
          className={tab === 'tests' ? 'tab tab-active' : 'tab'}
          onClick={() => {
            setTab('tests')
            setPage(1)
          }}
        >
          Тесты
        </button>
      </div>

      {tab === 'homework' ? (
        <>
          <div className="filters">
            <input
              placeholder="Поиск по ученику или заданию"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status)
                setPage(1)
              }}
            >
              {submissionStatuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {submissions.isLoading ? <div className="state">Загрузка…</div> : null}
          {submissions.error ? <div className="alert alert-error">{errorMessage(submissions.error)}</div> : null}

          {submissions.data ? (
            submissions.data.items.length === 0 ? (
              <div className="card muted">В этой очереди пока нет работ.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ученик</th>
                      <th>Задание</th>
                      <th>Курс</th>
                      <th>Статус</th>
                      <th>Балл</th>
                      <th>Сдано</th>
                      <th>Работа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.student.firstName} {item.student.lastName}
                          <div className="muted small">{item.student.email}</div>
                        </td>
                        <td>
                          {item.homework.title}
                          <div className="muted small">попытка {item.attempt}</div>
                        </td>
                        <td>{item.homework.course.title}</td>
                        <td>
                          <span className={`badge badge-${item.status.toLowerCase()}`}>
                            {statusLabels[item.status] ?? item.status}
                          </span>
                        </td>
                        <td>
                          {item.review ? `${item.review.score} / ${item.homework.maxScore}` : '—'}
                        </td>
                        <td className="muted small">{formatDate(item.submittedAt)}</td>
                        <td>
                          {item.projectUrl ? (
                            <a href={item.projectUrl} target="_blank" rel="noreferrer">
                              ссылка
                            </a>
                          ) : null}
                          {item.files?.length ? (
                            <div className="code-block">
                              {item.files.map((file) => (
                                <a key={file.url} href={file.url} target="_blank" rel="noreferrer">
                                  {file.name}
                                  <br />
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {item.text ? <div className="code-block">{item.text.slice(0, 120)}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </>
      ) : (
        <>
          {attempts.isLoading ? <div className="state">Загрузка…</div> : null}
          {attempts.error ? <div className="alert alert-error">{errorMessage(attempts.error)}</div> : null}

          {attempts.data ? (
            attempts.data.items.length === 0 ? (
              <div className="card muted">Попыток тестов пока нет.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ученик</th>
                      <th>Тест</th>
                      <th>Курс</th>
                      <th>Балл</th>
                      <th>Проходной</th>
                      <th>Итог</th>
                      <th>Начат</th>
                      <th>Завершён</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.student.firstName} {item.student.lastName}
                          <div className="muted small">{item.student.email}</div>
                        </td>
                        <td>{item.test.title}</td>
                        <td>{item.test.course.title}</td>
                        <td>{item.score ?? '—'}</td>
                        <td>{item.test.passingScore}</td>
                        <td>
                          {item.passed === null ? (
                            <span className="badge">{statusLabels[item.status] ?? item.status}</span>
                          ) : (
                            <span className={item.passed ? 'badge badge-passed' : 'badge badge-failed'}>
                              {item.passed ? 'Сдано' : 'Не сдано'}
                            </span>
                          )}
                        </td>
                        <td className="muted small">{formatDate(item.startedAt)}</td>
                        <td className="muted small">{formatDate(item.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </>
      )}

      <div className="pagination">
        <button className="button button-ghost" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </button>
        <span className="muted small">
          Страница {page} из {totalPages} · всего {total}
        </span>
        <button
          className="button button-ghost"
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Вперёд
        </button>
      </div>
    </div>
  )
}
