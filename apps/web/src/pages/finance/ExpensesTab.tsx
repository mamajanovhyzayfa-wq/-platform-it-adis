import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type FinanceExpenseCategory } from '../../api/finance'
import { categoryLabels, formatDate, money, todayInput, toIso } from './format'

export function ExpensesTab() {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<FinanceExpenseCategory>('OTHER')
  const [amount, setAmount] = useState('')
  const [spentAt, setSpentAt] = useState(todayInput(0))
  const [description, setDescription] = useState('')
  const [documents, setDocuments] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<FinanceExpenseCategory | ''>('')
  const [page, setPage] = useState(1)

  const expenses = useQuery({
    queryKey: ['finance-expenses', page, filter],
    queryFn: () => financeApi.expenses({ page, limit: 20, category: filter }),
  })

  const create = useMutation({
    mutationFn: () => {
      const value = Number(amount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму больше нуля')
      if (description.trim().length < 3) throw new Error('Добавьте описание расхода')
      return financeApi.createExpense({
        category,
        amount: value,
        spentAt: toIso(spentAt),
        description: description.trim(),
        ...(documents.trim()
          ? { documentUrls: documents.split(/[\s,]+/).map((url) => url.trim()).filter(Boolean) }
          : {}),
      })
    },
    onSuccess: () => {
      setNotice('Расход добавлен в учёт')
      setAmount('')
      setDescription('')
      setDocuments('')
      void queryClient.invalidateQueries({ queryKey: ['finance-expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => financeApi.deleteExpense(id),
    onSuccess: () => {
      setNotice('Расход удалён')
      void queryClient.invalidateQueries({ queryKey: ['finance-expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const totalPages = expenses.data?.pages ?? 1

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}

      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <h2>Добавить расход</h2>
        <div className="form-grid">
          <label className="field">
            <span>Категория</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as FinanceExpenseCategory)}>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Сумма, KGS</span>
            <input type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label className="field">
            <span>Дата</span>
            <input type="date" value={spentAt} onChange={(event) => setSpentAt(event.target.value)} />
          </label>
          <label className="field">
            <span>Описание</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Например, аренда за ноябрь"
              required
            />
          </label>
          <label className="field">
            <span>Ссылки на документы (через запятую)</span>
            <input value={documents} onChange={(event) => setDocuments(event.target.value)} placeholder="https://…" />
          </label>
        </div>
        <div className="row-actions">
          <button className="button" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Сохраняем…' : 'Добавить расход'}
          </button>
        </div>
      </form>

      <div className="filters">
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as FinanceExpenseCategory | '')
            setPage(1)
          }}
        >
          <option value="">Все категории</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {expenses.data ? <span className="muted">Итого: {money(expenses.data.sum)}</span> : null}
      </div>

      {expenses.error ? <div className="alert alert-error">{errorMessage(expenses.error)}</div> : null}
      {expenses.isLoading ? <div className="state">Загрузка расходов…</div> : null}

      {expenses.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Сумма</th>
                  <th>Автор</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.data.items.map((expense) => (
                  <tr key={expense.id}>
                    <td className="small">{formatDate(expense.spentAt)}</td>
                    <td>{expense.categoryLabel}</td>
                    <td>
                      {expense.description}
                      {(expense.documentUrls ?? []).length > 0 ? (
                        <div className="small">
                          {expense.documentUrls.map((url, index) => (
                            <a key={url} className="link" href={url} target="_blank" rel="noreferrer">
                              документ {index + 1}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="amount-negative">{money(expense.amount)}</td>
                    <td className="small">{expense.createdBy}</td>
                    <td>
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Удалить расход «${expense.description}»?`)) remove.mutate(expense.id)
                        }}
                      >
                        Удалить
                      </button>
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
              Страница {page} из {totalPages}
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
