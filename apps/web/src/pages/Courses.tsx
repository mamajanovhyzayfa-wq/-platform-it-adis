import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { errorMessage } from '../api/client'

const statusLabels: Record<string, string> = { DRAFT: 'черновик', ACTIVE: 'активен', ARCHIVED: 'архив' }

export function CoursesPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const courses = useQuery({
    queryKey: ['admin-courses', page, search, status],
    queryFn: () => adminApi.courses({ page, limit: 20, search, status }),
  })

  const totalPages = courses.data ? Math.max(1, Math.ceil(courses.data.total / courses.data.limit)) : 1

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Курсы</h1>
          <p className="muted">Программы платформы, преподаватели и количество записей.</p>
        </div>
      </header>

      <div className="filters">
        <input
          placeholder="Поиск по названию или описанию"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          <option value="DRAFT">Черновики</option>
          <option value="ACTIVE">Активные</option>
          <option value="ARCHIVED">Архив</option>
        </select>
      </div>

      {courses.isLoading ? <div className="state">Загрузка…</div> : null}
      {courses.error ? <div className="alert alert-error">{errorMessage(courses.error)}</div> : null}

      {courses.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Курс</th>
                  <th>Преподаватель</th>
                  <th>Уровень</th>
                  <th>Модули</th>
                  <th>Записи</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {courses.data.items.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <strong>{course.title}</strong>
                      <div className="muted small">{course.description.slice(0, 90)}</div>
                    </td>
                    <td>{course.teacher}</td>
                    <td className="small">{course.level}</td>
                    <td>{course.modules}</td>
                    <td>{course.enrollments}</td>
                    <td>
                      <span className={`badge badge-${course.status.toLowerCase()}`}>
                        {statusLabels[course.status] ?? course.status}
                      </span>
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
              Страница {page} из {totalPages} · всего {courses.data.total}
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
