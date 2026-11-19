import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminCoinTransaction } from '../api/admin'
import { errorMessage } from '../api/client'
import { BarChart } from '../components/Charts'

type Source = NonNullable<AdminCoinTransaction['sourceType']>

const sources: Array<{ value: Source | ''; label: string }> = [
  { value: '', label: 'Все источники' },
  { value: 'HOMEWORK', label: 'Домашние задания' },
  { value: 'TEST', label: 'Тесты' },
  { value: 'ATTENDANCE', label: 'Посещение занятий' },
  { value: 'ACHIEVEMENT', label: 'Достижения' },
  { value: 'SHOP', label: 'Магазин' },
  { value: 'MANUAL', label: 'Начисление вручную' },
]

const sourceLabels: Record<Source, string> = {
  HOMEWORK: 'ДЗ',
  TEST: 'Тест',
  ATTENDANCE: 'Посещение',
  ACHIEVEMENT: 'Достижение',
  SHOP: 'Магазин',
  MANUAL: 'Вручную',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

/** Журнал транзакций IT Coins: начисления, списания, возвраты и баланс платформы. */
export function CoinsPage() {
  const [page, setPage] = useState(1)
  const [source, setSource] = useState<Source | ''>('')
  const [search, setSearch] = useState('')

  const transactions = useQuery({
    queryKey: ['admin-coin-transactions', page, source, search],
    queryFn: () => adminApi.coinTransactions({ page, limit: 25, sourceType: source, search }),
  })

  const totalPages = transactions.data
    ? Math.max(1, Math.ceil(transactions.data.total / transactions.data.limit))
    : 1

  const awarded = transactions.data?.totals.awarded ?? 0
  const spent = transactions.data?.totals.spent ?? 0

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Транзакции IT Coins</h1>
          <p className="muted">Все начисления и списания. Баланс ученика меняется только через транзакции.</p>
        </div>
      </header>

      <section className="grid two">
        <article className="card">
          <h2>Итоги по фильтру</h2>
          <BarChart
            data={[
              { label: 'Начислено', value: awarded, tone: 'success' },
              { label: 'Списано', value: spent, tone: 'danger' },
              { label: 'Чистый поток', value: Math.max(awarded - spent, 0), tone: 'primary' },
            ]}
            unit="монет"
          />
        </article>
        <article className="card">
          <h2>Транзакций в выборке</h2>
          <div className="metrics">
            <div>
              <dt>Всего</dt>
              <dd>{transactions.data?.total ?? '—'}</dd>
            </div>
            <div>
              <dt>Начислено</dt>
              <dd className="amount-positive">{awarded}</dd>
            </div>
            <div>
              <dt>Списано</dt>
              <dd className="amount-negative">{spent}</dd>
            </div>
          </div>
        </article>
      </section>

      <div className="filters">
        <input
          placeholder="Поиск по ученику или причине"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value as Source | '')
            setPage(1)
          }}
        >
          {sources.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {transactions.isLoading ? <div className="state">Загрузка…</div> : null}
      {transactions.error ? <div className="alert alert-error">{errorMessage(transactions.error)}</div> : null}

      {transactions.data ? (
        transactions.data.items.length === 0 ? (
          <div className="card muted">Транзакций по этому фильтру нет.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Ученик</th>
                  <th>Сумма</th>
                  <th>Источник</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {transactions.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="muted small">{formatDate(item.createdAt)}</td>
                    <td>
                      {item.user.firstName} {item.user.lastName}
                      <div className="muted small">{item.user.email}</div>
                    </td>
                    <td className={item.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {item.amount > 0 ? `+${item.amount}` : item.amount}
                    </td>
                    <td>{item.sourceType ? sourceLabels[item.sourceType] : '—'}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      <div className="pagination">
        <button className="button button-ghost" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </button>
        <span className="muted small">
          Страница {page} из {totalPages}
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
