import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { adminApi } from '../api/admin'
import { errorMessage } from '../api/client'
import { BarChart, DonutChart } from '../components/Charts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['admin-dashboard'], queryFn: adminApi.dashboard })
  const analytics = useQuery({ queryKey: ['admin-analytics'], queryFn: adminApi.analytics })

  if (dashboard.isLoading) return <div className="state">Загрузка данных…</div>
  if (dashboard.error) return <div className="alert alert-error">{errorMessage(dashboard.error)}</div>
  if (!dashboard.data) return null

  const data = dashboard.data

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Обзор платформы</h1>
          <p className="muted">Сводка по пользователям, курсам и активности.</p>
        </div>
      </header>

      <section className="stats">
        <article className="stat">
          <span className="stat-label">Ученики</span>
          <strong>{data.users.students}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Преподаватели</span>
          <strong>{data.users.teachers}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Активные курсы</span>
          <strong>{data.courses.active}</strong>
          <span className="stat-hint">черновиков: {data.courses.draft}</span>
        </article>
        <article className="stat">
          <span className="stat-label">Ближайшие занятия</span>
          <strong>{data.upcomingLessons}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Завершённых записей</span>
          <strong>{data.courses.completedEnrollments}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Новые пользователи</span>
          <strong>{data.activity.newUsers}</strong>
          <span className="stat-hint">за 7 дней</span>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Аналитика</h2>
          {analytics.isLoading ? <p className="muted">Загрузка…</p> : null}
          {analytics.error ? <p className="muted">{errorMessage(analytics.error)}</p> : null}
          {analytics.data ? (
            <dl className="metrics">
              <div>
                <dt>Попыток тестов</dt>
                <dd>{analytics.data.testAttempts.total}</dd>
              </div>
              <div>
                <dt>Средний балл</dt>
                <dd>{analytics.data.testAttempts.averageScore}</dd>
              </div>
              <div>
                <dt>Посещений занятий</dt>
                <dd>{analytics.data.attendance.sessions}</dd>
              </div>
              <div>
                <dt>Минут на занятиях</dt>
                <dd>{analytics.data.attendance.totalMinutes}</dd>
              </div>
              <div>
                <dt>Активных учеников (30 дней)</dt>
                <dd>{analytics.data.activeStudents}</dd>
              </div>
            </dl>
          ) : null}
        </article>

        <article className="card">
          <h2>Последние действия</h2>
          {data.recentAudit.length === 0 ? <p className="muted">Записей пока нет.</p> : null}
          <ul className="list">
            {data.recentAudit.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.action}</strong>
                  <span className="muted">
                    {' '}
                    · {entry.entity} · {entry.actor}
                  </span>
                </div>
                <span className="muted small">{formatDate(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Link className="link" to="/audit">
            Все записи аудита →
          </Link>
        </article>
      </section>

      {analytics.data ? (
        <section className="grid two">
          <article className="card">
            <h2>Записи на курсы</h2>
            <DonutChart
              centerLabel="записей"
              data={[
                { label: 'Активные', value: analytics.data.enrollments.ACTIVE ?? 0, tone: 'success' },
                { label: 'Ожидают', value: analytics.data.enrollments.PENDING ?? 0, tone: 'warning' },
                { label: 'На паузе', value: analytics.data.enrollments.PAUSED ?? 0, tone: 'muted' },
                { label: 'Завершены', value: analytics.data.enrollments.COMPLETED ?? 0, tone: 'primary' },
              ]}
            />
          </article>

          <article className="card">
            <h2>Домашние работы</h2>
            <BarChart
              data={[
                { label: 'На проверке', value: analytics.data.submissions.SUBMITTED ?? 0, tone: 'warning' },
                { label: 'Проверено', value: analytics.data.submissions.REVIEWED ?? 0, tone: 'success' },
                { label: 'На доработке', value: analytics.data.submissions.RETURNED ?? 0, tone: 'danger' },
              ]}
            />
            <p className="muted small" style={{ marginTop: 14 }}>
              Очередь проверки — в разделе <Link to="/review">«Проверка работ»</Link>.
            </p>
          </article>
        </section>
      ) : null}

      {analytics.data && analytics.data.popularCourses.length > 0 ? (
        <section className="card">
          <h2>Популярные курсы</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Курс</th>
                <th>Статус</th>
                <th>Записей</th>
              </tr>
            </thead>
            <tbody>
              {analytics.data.popularCourses.map((course) => (
                <tr key={course.id}>
                  <td>{course.title}</td>
                  <td>
                    <span className={`badge badge-${course.status.toLowerCase()}`}>{course.status}</span>
                  </td>
                  <td>{course.enrollments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  )
}
