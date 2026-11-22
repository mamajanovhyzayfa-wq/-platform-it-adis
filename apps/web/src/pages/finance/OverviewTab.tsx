import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi } from '../../api/finance'
import { BarChart } from '../../components/Charts'
import { methodLabels, money, todayInput, toIso } from './format'

export function OverviewTab() {
  const [period, setPeriod] = useState({
    from: todayInput(-30),
    to: todayInput(1),
  })

  const overview = useQuery({
    queryKey: ['finance-overview', period.from, period.to],
    queryFn: () => financeApi.overview({ from: toIso(period.from), to: toIso(period.to) }),
  })
  const providerAccounts = useQuery({ queryKey: ['finance-provider-accounts'], queryFn: financeApi.providerAccounts })

  if (overview.isLoading) return <div className="state">Загрузка финансов…</div>
  if (overview.error) return <div className="alert alert-error">{errorMessage(overview.error)}</div>
  if (!overview.data) return null

  const data = overview.data
  const onlineConfigured = (providerAccounts.data?.items ?? []).some((account) => account.enabled && account.secretConfigured && account.merchantId)
  const exportCsv = async () => {
    financeApi.downloadBlob(
      await financeApi.exportCsv({ from: toIso(period.from), to: toIso(period.to) }),
      `itadis-finance-${period.from}.csv`,
    )
  }
  const exportAccounting = async () => {
    const payload = await financeApi.accounting({ from: toIso(period.from), to: toIso(period.to) })
    financeApi.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `itadis-accounting-${period.from}.json`)
  }
  const monthLabel = (month: string) => {
    const [year, index] = month.split('-')
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    return `${names[Number(index) - 1] ?? index} ${year?.slice(2)}`
  }

  return (
    <div className="stack">
      <div className="filters">
        <label className="field">
          <span>С даты</span>
          <input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
        </label>
        <label className="field">
          <span>По дату</span>
          <input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
        </label>
        <button className="button button-ghost" type="button" onClick={() => void exportCsv()}>CSV</button>
        <button className="button button-ghost" type="button" onClick={() => void exportAccounting()}>JSON для бухгалтерии</button>
      </div>

      {!onlineConfigured ? (
        <div className="alert alert-error">
          <strong>Онлайн-оплата не подключена.</strong> Добавьте платёжный аккаунт во вкладке «Онлайн-оплата»
          и задайте секрет в переменной окружения сервера.
        </div>
      ) : (
        <div className="alert">
          <strong>Онлайн-оплата настроена.</strong> Провайдер подтверждает оплату собственным уведомлением.
        </div>
      )}

      <section className="stats">
        <article className="stat">
          <span className="stat-label">Поступления</span>
          <strong>{money(data.income.payments)}</strong>
          <span className="stat-hint">за период</span>
        </article>
        <article className="stat">
          <span className="stat-label">Возвраты</span>
          <strong>{money(data.income.refunds)}</strong>
          <span className="stat-hint">одобренные</span>
        </article>
        <article className="stat">
          <span className="stat-label">Расходы</span>
          <strong>{money(data.expenses)}</strong>
          <span className="stat-hint">за период</span>
        </article>
        <article className="stat">
          <span className="stat-label">Прибыль</span>
          <strong className={data.profit >= 0 ? 'amount-positive' : 'amount-negative'}>{money(data.profit)}</strong>
          <span className="stat-hint">доходы минус расходы</span>
        </article>
        <article className="stat">
          <span className="stat-label">Задолженность</span>
          <strong>{money(data.outstanding.total)}</strong>
          <span className="stat-hint">
            просрочено {money(data.outstanding.overdue)} · {data.outstanding.overdueCount} счетов
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">Заявки на возврат</span>
          <strong>{data.counts.refundsPending}</strong>
          <span className="stat-hint">ожидают решения</span>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Поступления по месяцам</h2>
          <BarChart
            data={data.monthly.map((item) => ({ label: monthLabel(item.month), value: item.income, tone: 'primary' as const }))}
            unit="KGS"
          />
        </article>
        <article className="card">
          <h2>Расходы по месяцам</h2>
          <BarChart
            data={data.monthly.map((item) => ({ label: monthLabel(item.month), value: item.expenses, tone: 'danger' as const }))}
            unit="KGS"
          />
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Курсы и группы</h2>
          {data.groups.length === 0 ? <p className="muted">Курсов пока нет.</p> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Курс / группа</th>
                <th>Учеников</th>
                <th>Поступления</th>
                <th>Долг</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((group) => (
                <tr key={group.id}>
                  <td>{group.title}</td>
                  <td>{group.students}</td>
                  <td className="amount-positive">{money(group.income)}</td>
                  <td className={group.outstanding > 0 ? 'amount-negative' : undefined}>
                    {money(group.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card">
          <h2>Способы оплаты</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Способ</th>
                <th>Платежей</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.methods.map((method) => (
                <tr key={method.method}>
                  <td>{methodLabels[method.method]}</td>
                  <td>{method.count}</td>
                  <td>{money(method.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      <section className="card">
        <h2>Задолженность по ученикам</h2>
        {data.debtors.length === 0 ? <p className="muted">Задолженностей нет.</p> : null}
        {data.debtors.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Счетов</th>
                <th>Остаток</th>
              </tr>
            </thead>
            <tbody>
              {data.debtors.map((debtor) => (
                <tr key={debtor.student.id}>
                  <td>
                    <strong>
                      {debtor.student.firstName} {debtor.student.lastName}
                    </strong>
                    <div className="muted small">{debtor.student.email}</div>
                  </td>
                  <td>{debtor.invoices}</td>
                  <td className="amount-negative">{money(debtor.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  )
}
