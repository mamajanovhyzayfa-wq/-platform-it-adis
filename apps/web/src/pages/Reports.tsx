import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage } from '../api/client'
import { useSession } from '../hooks/useSession'
import { reportsApi } from '../api/reports'
import { Empty, PageHeader, Section, StatCard, formatKgs } from '../components/ui'

type Tab = 'overview' | 'finance' | 'academic'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'finance', label: 'Финансы' },
  { id: 'academic', label: 'Академическая часть' },
]

function today(): Date {
  return new Date()
}

function firstDayOfMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function dateInput(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function toIso(value: string, endOfDay = false): string {
  const date = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function CountTable({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <Empty>Нет данных за период</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{title}</th>
            <th>Количество</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function sumValues(data: Record<string, number>): number {
  return Object.values(data).reduce((total, value) => total + value, 0)
}

export function ReportsPage() {
  const session = useSession()
  const isAdmin = session?.role === 'ADMIN'
  const [tab, setTab] = useState<Tab>('overview')
  const [from, setFrom] = useState(() => dateInput(firstDayOfMonth()))
  const [to, setTo] = useState(() => dateInput(today()))
  const visibleTabs = isAdmin ? tabs : tabs.filter((item) => item.id !== 'finance')

  // У менеджера нет финансового кабинета и финансовой аналитики.
  useEffect(() => {
    if (!isAdmin && tab === 'finance') setTab('overview')
  }, [isAdmin, tab])

  const params = { from: toIso(from), to: toIso(to, true) }

  const overview = useQuery({
    queryKey: ['report-overview', params.from, params.to],
    queryFn: () => reportsApi.overview(params),
    enabled: tab === 'overview',
  })
  const finance = useQuery({
    queryKey: ['report-finance', params.from, params.to],
    queryFn: () => reportsApi.finance(params),
    enabled: tab === 'finance' && isAdmin,
  })
  const academic = useQuery({
    queryKey: ['report-academic', params.from, params.to],
    queryFn: () => reportsApi.academic(params),
    enabled: tab === 'academic',
  })

  const active = tab === 'overview' ? overview : tab === 'finance' ? finance : academic

  return (
    <div className="stack">
      <PageHeader
        title="Отчёты"
        subtitle={
          isAdmin
            ? 'Сводка по филиалу за период: пользователи, обучение, финансы, посещаемость и обращения.'
            : 'Организационная сводка филиала: пользователи, обучение, посещаемость и обращения.'
        }
      />

      <div className="filters">
        <label>
          <span className="muted small">С</span>
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          <span className="muted small">По</span>
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>

      <div className="tabs">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {active.isLoading ? <div className="state">Считаем отчёт…</div> : null}
      {active.error ? <div className="alert alert-error">{errorMessage(active.error)}</div> : null}

      {tab === 'overview' && overview.data ? (
        <>
          <div className="stats">
            <StatCard
              label="Пользователи"
              value={sumValues(overview.data.users)}
              hint={`${overview.data.users.STUDENT ?? 0} учеников`}
              icon="users"
            />
            <StatCard label="Активные записи" value={overview.data.activeEnrollments} hint="на курсы" icon="book" />
            {overview.data.finance ? (
              <>
                <StatCard label="Выручка" value={formatKgs(overview.data.finance.revenue)} hint={`${overview.data.finance.paymentsCount} платежей`} tone="success" icon="wallet" />
                <StatCard label="Расходы" value={formatKgs(overview.data.finance.expenses)} hint={`${overview.data.finance.expensesCount} операций`} tone="warning" icon="wallet" />
                <StatCard
                  label="Маржа"
                  value={formatKgs(overview.data.finance.margin)}
                  tone={overview.data.finance.margin >= 0 ? 'success' : 'danger'}
                  icon="spark"
                />
              </>
            ) : null}
            <StatCard label="Сертификаты" value={overview.data.certificatesIssued} hint="выдано за период" icon="shield" />
            <StatCard
              label="Открытые обращения"
              value={overview.data.openSupportTickets}
              tone={overview.data.openSupportTickets > 0 ? 'warning' : 'muted'}
              icon="bell"
            />
          </div>

          <div className="grid-2">
            <Section title="Пользователи по ролям">
              <CountTable title="Роль" data={overview.data.users} />
            </Section>
            <Section title="Курсы по статусам">
              <CountTable title="Статус" data={overview.data.courses} />
            </Section>
          </div>

          <Section title="Посещаемость за период">
            <CountTable title="Статус" data={overview.data.attendance} />
          </Section>
        </>
      ) : null}

      {tab === 'finance' && finance.data ? (
        <>
          <div className="stats">
            <StatCard
              label="Поступления"
              value={formatKgs(finance.data.payments.reduce((total, row) => total + row.amount, 0))}
              hint={`${finance.data.payments.reduce((total, row) => total + row.count, 0)} платежей`}
              tone="success"
              icon="wallet"
            />
            <StatCard
              label="Расходы"
              value={formatKgs(finance.data.expenses.reduce((total, row) => total + row.amount, 0))}
              hint={`${finance.data.expenses.reduce((total, row) => total + row.count, 0)} операций`}
              tone="warning"
              icon="wallet"
            />
            <StatCard label="Возвраты" value={formatKgs(finance.data.refunds.amount)} hint={`${finance.data.refunds.count} одобрено`} tone="danger" icon="wallet" />
            <StatCard label="Долг по счетам" value={formatKgs(finance.data.outstandingInvoices.amount)} hint={`${finance.data.outstandingInvoices.count} счетов`} tone="muted" icon="book" />
          </div>

          <Section title="Платежи по методам">
            {finance.data.payments.length === 0 ? (
              <Empty>Платежей за период нет</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Метод</th>
                      <th>Количество</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.data.payments.map((row) => (
                      <tr key={row.method}>
                        <td>{row.method}</td>
                        <td>{row.count}</td>
                        <td>{formatKgs(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Расходы по категориям">
            {finance.data.expenses.length === 0 ? (
              <Empty>Расходов за период нет</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Категория</th>
                      <th>Количество</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.data.expenses.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{row.count}</td>
                        <td>{formatKgs(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : null}

      {tab === 'academic' && academic.data ? (
        <>
          <div className="stats">
            <StatCard
              label="Средний результат тестов"
              value={`${Math.round(academic.data.testAttempts.averagePercent)}%`}
              hint={`${academic.data.testAttempts.count} попыток`}
              tone="success"
              icon="check"
            />
            <StatCard label="Активные курсы" value={academic.data.publishedCourses} hint="опубликованы" icon="book" />
            <StatCard
              label="Сдач ДЗ"
              value={sumValues(academic.data.submissions)}
              hint="за период"
              icon="folder"
            />
            <StatCard
              label="Посещений"
              value={sumValues(academic.data.attendance)}
              hint="отметок за период"
              tone="muted"
              icon="calendar"
            />
          </div>

          <div className="grid-2">
            <Section title="Посещаемость">
              <CountTable title="Статус" data={academic.data.attendance} />
            </Section>
            <Section title="Домашние задания">
              <CountTable title="Статус" data={academic.data.submissions} />
            </Section>
          </div>
        </>
      ) : null}
    </div>
  )
}
