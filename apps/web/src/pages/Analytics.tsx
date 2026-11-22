import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import { analyticsApi, type AnalyticsOverview } from '../api/analytics'
import { financeApi } from '../api/finance'
import { LineChart } from '../components/Charts'
import { roleLabels } from '../app/navigation'
import { money, todayInput, toIso } from './finance/format'

const metricLabels: Record<string, string> = {
  students: 'Ученики',
  groups: 'Группы',
  teachers: 'Наставники',
  lessons: 'Занятия',
  hours: 'Часы',
  applications: 'Заявки',
  newApplications: 'Новые заявки',
  convertedApplications: 'Зачислено',
  attendanceRate: 'Посещаемость',
  averageScore: 'Средний результат',
  assignmentCompletion: 'Выполнение заданий',
  assignmentQuality: 'Качество заданий',
  progress: 'Прогресс',
  achievements: 'Достижения',
  efficiency: 'Эффективность',
  incomeKgs: 'Доход',
  expensesKgs: 'Расходы',
  profitKgs: 'Прибыль',
  debtKgs: 'Задолженность',
  refundsKgs: 'Возвраты',
  paymentsKgs: 'Поступления',
  coins: 'IT Coins',
  nextScore: 'Прогноз результата',
  nextAttendance: 'Прогноз посещаемости',
  nextAverageScore: 'Прогноз среднего результата',
  nextEfficiency: 'Прогноз эффективности',
}

const percentMetrics = new Set([
  'attendanceRate',
  'averageScore',
  'assignmentCompletion',
  'assignmentQuality',
  'progress',
  'efficiency',
  'nextScore',
  'nextAttendance',
  'nextAverageScore',
  'nextEfficiency',
])
const moneyMetrics = new Set(['incomeKgs', 'expensesKgs', 'profitKgs', 'debtKgs', 'refundsKgs', 'paymentsKgs'])

function metricValue(key: string, value: number) {
  if (moneyMetrics.has(key)) return money(value)
  if (percentMetrics.has(key)) return `${value}%`
  return new Intl.NumberFormat('ru-RU').format(value)
}

function MetricCards({ metrics }: { metrics: Record<string, number> }) {
  return (
    <section className="stats">
      {Object.entries(metrics).map(([key, value]) => (
        <article className="stat" key={key}>
          <span className="stat-label">{metricLabels[key] ?? key}</span>
          <strong className={key === 'profitKgs' && value < 0 ? 'amount-negative' : undefined}>{metricValue(key, value)}</strong>
        </article>
      ))}
    </section>
  )
}

function RiskTable({ data }: { data: AnalyticsOverview }) {
  if (!data.atRisk?.length) return <p className="muted">Учеников в зоне риска не выявлено.</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ученик</th>
            <th>Показатель</th>
            <th>Причина</th>
          </tr>
        </thead>
        <tbody>
          {data.atRisk.map((student) => (
            <tr key={student.userId}>
              <td>
                <strong>{student.name}</strong>
                <div className="muted small">{student.email}</div>
              </td>
              <td>
                {[
                  student.attendanceRate != null ? `посещаемость ${student.attendanceRate}%` : null,
                  student.attendanceRate == null && student.absenceRate != null ? `пропуски ${student.absenceRate}%` : null,
                  student.averageScore != null ? `средний результат ${student.averageScore}%` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </td>
              <td className="small">{student.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AnalyticsPage() {
  const session = getSession()
  const [period, setPeriod] = useState({ from: todayInput(-90), to: todayInput(1) })
  const query = useQuery({
    queryKey: ['analytics-center', period.from, period.to],
    queryFn: () => analyticsApi.overview({ from: toIso(period.from), to: toIso(period.to) }),
  })

  if (query.isLoading) return <div className="state">Считаем аналитику…</div>
  if (query.error) return <div className="alert alert-error">{errorMessage(query.error)}</div>
  if (!query.data) return null
  const data = query.data
  const trend = data.trend ?? []
  const comparison = Object.entries(data.comparison ?? {}).filter(
    (entry): entry is [string, { current: number; previous: number; delta: number }] => 'current' in entry[1],
  )
  const forecast = Object.entries(data.forecast ?? {}).filter(([key]) => key !== 'note' && key !== 'confidence')

  const exportCsv = async () => {
    const blob = await financeApi.exportCsv({ from: toIso(period.from), to: toIso(period.to) })
    financeApi.downloadBlob(blob, 'itadis-finance.csv')
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Аналитика и отчётность</h1>
          <p className="muted">
            {session ? roleLabels[session.role] : ''} · прогнозы и ученики, которым нужна поддержка.
          </p>
        </div>
      </header>

      <div className="filters">
        <label className="field">
          <span>С даты</span>
          <input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
        </label>
        <label className="field">
          <span>По дату</span>
          <input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
        </label>
        {data.role === 'ADMIN' ? (
          <button className="button button-ghost" type="button" onClick={() => void exportCsv()}>
            Экспорт CSV
          </button>
        ) : null}
      </div>

      <MetricCards metrics={data.metrics} />

      {comparison.length > 0 ? (
        <section className="card">
          <h2>Сравнение с предыдущим периодом</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Показатель</th>
                  <th>Сейчас</th>
                  <th>Было</th>
                  <th>Изменение</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([key, value]) => (
                  <tr key={key}>
                    <td>{metricLabels[key] ?? key}</td>
                    <td>{percentMetrics.has(key) ? `${value.current}%` : moneyMetrics.has(key) ? money(value.current) : value.current}</td>
                    <td className="muted">{percentMetrics.has(key) ? `${value.previous}%` : moneyMetrics.has(key) ? money(value.previous) : value.previous}</td>
                    <td className={value.delta >= 0 ? 'amount-positive' : 'amount-negative'}>{value.delta > 0 ? '+' : ''}{value.delta}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="grid two">
        <article className="card">
          <h2>Посещаемость по месяцам</h2>
          <LineChart data={trend.map((point) => ({ label: point.label, value: point.attendanceRate }))} unit="%" tone="success" />
        </article>
        <article className="card">
          <h2>Средний результат по месяцам</h2>
          <LineChart data={trend.map((point) => ({ label: point.label, value: point.averageScore }))} unit="%" tone="primary" />
        </article>
      </section>

      {data.role === 'STUDENT' ? (
        <>
          <section className="grid two">
            <article className="card">
              <h2>Результаты по курсам</h2>
              {(data.courses ?? []).length === 0 ? <p className="muted">Данных пока нет.</p> : null}
              <table className="table">
                <thead>
                  <tr>
                    <th>Курс</th>
                    <th>Результат</th>
                    <th>Посещаемость</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.courses ?? []).map((course) => (
                    <tr key={course.course ?? course.title}>
                      <td>{course.course ?? course.title}</td>
                      <td>{course.average === null || course.average === undefined ? '—' : `${course.average}%`}</td>
                      <td>{course.attendanceRate === null || course.attendanceRate === undefined ? '—' : `${course.attendanceRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Посещаемость: <strong>{data.attendance?.rate ?? 0}%</strong> · был(а) {data.attendance?.present ?? 0} из {data.attendance?.total ?? 0}, пропусков {data.attendance?.absent ?? 0}, опозданий {data.attendance?.late ?? 0}.
              </p>
            </article>
            <article className="card">
              <h2>Сильные и слабые темы</h2>
              <p className="muted small">Сильные: {(data.strengths ?? []).join(', ') || 'пока не определены'}</p>
              <p className="muted small">Требуют внимания: {(data.weaknesses ?? []).join(', ') || 'нет'}</p>
              <h3>Рекомендации</h3>
              <ul>
                {(data.recommendations ?? []).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          </section>

          <section className="grid two">
            <article className="card">
              <h2>Последние задания</h2>
              {(data.assignments ?? []).length === 0 ? <p className="muted">Заданий за период нет.</p> : null}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Задание</th><th>Статус</th><th>Результат</th></tr>
                  </thead>
                  <tbody>
                    {(data.assignments ?? []).slice(0, 12).map((item) => (
                      <tr key={`${item.title}-${item.submittedAt}`}>
                        <td>{item.title}<div className="muted small">{item.course}</div></td>
                        <td className="small">{item.status}</td>
                        <td>{item.percent === null ? '—' : `${item.percent}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="card">
              <h2>Достижения</h2>
              {(data.achievements ?? []).length === 0 ? <p className="muted">Достижения появятся по мере обучения.</p> : null}
              <ul>
                {(data.achievements ?? []).map((item) => <li key={item.title}><strong>{item.title}</strong> — {item.description}</li>)}
              </ul>
            </article>
          </section>
        </>
      ) : null}

      {data.role === 'TEACHER' ? (
        <>
        <section className="grid two">
          <article className="card">
            <h2>Прогресс групп</h2>
            {(data.groups ?? []).length === 0 ? <p className="muted">Групп пока нет.</p> : null}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Группа</th><th>Ученики</th><th>Прогресс</th><th>Посещаемость</th></tr></thead>
                <tbody>
                  {(data.groups ?? []).map((group) => (
                    <tr key={group.id}>
                      <td>{group.title}</td>
                      <td>{group.students}</td>
                      <td>{group.progress}%</td>
                      <td>{group.attendanceRate ?? 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className="card">
            <h2>Нужна поддержка</h2>
            <RiskTable data={data} />
          </article>
        </section>
        <section className="card">
          <h2>Результаты учеников</h2>
          {(data.students ?? []).length === 0 ? <p className="muted">Данных по ученикам пока нет.</p> : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ученик</th><th>Группы</th><th>Средний результат</th><th>Посещаемость</th></tr></thead>
              <tbody>
                {(data.students ?? []).map((student) => (
                  <tr key={student.userId}>
                    <td><strong>{student.name}</strong><div className="muted small">{student.email}</div></td>
                    <td className="small">{student.courses.join(', ') || '—'}</td>
                    <td>{student.averageScore === null ? '—' : `${student.averageScore}%`}</td>
                    <td>{student.attendanceRate === null ? '—' : `${student.attendanceRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
      ) : null}

      {data.role === 'MANAGER' ? (
        <>
        <section className="grid two">
          <article className="card">
            <h2>Заявки по статусам</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Статус</th><th>Количество</th></tr></thead>
                <tbody>
                  {(data.applicationsByStatus ?? []).map((row) => <tr key={row.status}><td>{row.status}</td><td>{row.count}</td></tr>)}
                </tbody>
              </table>
            </div>
          </article>
          <article className="card">
            <h2>Ученики в зоне риска</h2>
            <RiskTable data={data} />
          </article>
        </section>
        <section className="card">
          <h2>Группы</h2>
          {(data.groups ?? []).length === 0 ? <p className="muted">Групп пока нет.</p> : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Группа</th><th>Ученики</th><th>Прогресс</th><th>Посещаемость</th></tr></thead>
              <tbody>
                {(data.groups ?? []).map((group) => (
                  <tr key={group.id}>
                    <td>{group.title}</td>
                    <td>{group.students}</td>
                    <td>{group.progress}%</td>
                    <td>{group.attendanceRate ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h2>Наставники</h2>
          {(data.teachers ?? []).length === 0 ? <p className="muted">Наставников пока нет.</p> : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Наставник</th><th>Занятий за период</th><th>Статус</th></tr></thead>
              <tbody>
                {(data.teachers ?? []).map((teacher) => (
                  <tr key={teacher.userId}>
                    <td><strong>{teacher.name}</strong><div className="muted small">{teacher.email}</div></td>
                    <td>{teacher.lessons}</td>
                    <td>{teacher.isActive ? 'активен' : 'неактивен'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
      ) : null}

      {data.role === 'ADMIN' ? (
        <>
          {data.finance ? (
            <section className="stats">
              <article className="stat"><span className="stat-label">Поступления</span><strong>{money(data.finance.income.net)}</strong></article>
              <article className="stat"><span className="stat-label">Расходы</span><strong>{money(data.finance.expenses)}</strong></article>
              <article className="stat"><span className="stat-label">Прибыль</span><strong className={data.finance.profit < 0 ? 'amount-negative' : 'amount-positive'}>{money(data.finance.profit)}</strong></article>
              <article className="stat"><span className="stat-label">Задолженность</span><strong>{money(data.finance.outstanding.total)}</strong></article>
            </section>
          ) : null}
          <section className="grid two">
            <article className="card">
              <h2>Курсы и группы</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Курс</th><th>Ученики</th><th>Прогресс</th></tr></thead>
                  <tbody>
                    {(data.courses ?? []).map((course) => (
                      <tr key={course.id ?? course.title}><td>{course.title}</td><td>{course.students ?? 0}</td><td>{course.progress ?? 0}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="card">
              <h2>Наставники</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Наставник</th><th>Занятий</th><th>Ставка</th></tr></thead>
                  <tbody>
                    {(data.teachers ?? []).map((teacher) => (
                      <tr key={teacher.userId}><td>{teacher.name}</td><td>{teacher.lessons}</td><td>{money(teacher.lessonRateKgs ?? 0)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
          <section className="grid two">
            <article className="card"><h2>Поддержка учеников</h2><RiskTable data={data} /></article>
            <article className="card">
              <h2>IT Coins</h2>
              <p><strong>{data.coins?.total ?? 0}</strong> монет начислено за период.</p>
              <p className="muted small">{data.coins?.note}</p>
            </article>
          </section>
        </>
      ) : null}

      <section className="grid two">
        <article className="card">
          <h2>Прогноз</h2>
          {forecast.length === 0 ? <p className="muted">Недостаточно данных для прогноза.</p> : null}
          {forecast.map(([key, value]) => (
            <p key={key}>
              <strong>{metricLabels[key] ?? key}:</strong>{' '}
              {typeof value === 'number' ? `${value}${percentMetrics.has(key) ? '%' : ''}` : String(value ?? '—')}
            </p>
          ))}
          <p className="muted small">{String(data.forecast?.note ?? '')}</p>
        </article>
        <article className="card">
          <h2>Рекомендации</h2>
          <ul>{(data.recommendations ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
          {data.needsSupport ? (
            <div className="alert alert-error">
              Нужна дополнительная поддержка: {(data.supportReasons ?? []).join('; ')}
            </div>
          ) : null}
        </article>
      </section>
    </div>
  )
}
