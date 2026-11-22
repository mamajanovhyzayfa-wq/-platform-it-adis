import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import { financeApi } from '../api/finance'

const money = (value: number) => `${new Intl.NumberFormat('ru-RU').format(value)} KGS`

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(new Date(value))

/**
 * Касса менеджера.
 *
 * Менеджер видит только незакрытые счета и остаток по ним, принимает наличные
 * и не получает доступа к доходам, расходам и аналитике филиала.
 */
export function CashPage() {
  const queryClient = useQueryClient()
  const session = getSession()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const invoices = useQuery({
    queryKey: ['cash-invoices', search],
    queryFn: () => financeApi.managerInvoices(search),
  })

  const selected = invoices.data?.items.find((invoice) => invoice.id === selectedId) ?? null

  const register = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Выберите счёт')
      const value = Number(amount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Введите сумму наличных')
      return financeApi.registerCashPayment({
        invoiceId: selected.id,
        amount: value,
        ...(note ? { note } : {}),
      })
    },
    onSuccess: (result) => {
      setNotice(
        `Платёж принят по счёту ${result.invoice.number}. Остаток: ${money(result.invoice.totals.remaining)}`,
      )
      setSelectedId('')
      setAmount('')
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['cash-invoices'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Касса</h1>
          <p className="muted">
            Приём наличных платежей. Вы вошли как {session?.firstName ?? 'менеджер'}: доступны только счета и
            остатки, финансовая аналитика закрыта.
          </p>
        </div>
      </header>

      {notice ? <div className="alert">{notice}</div> : null}

      <div className="filters">
        <input
          placeholder="Поиск: ученик или номер счёта"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {selected ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            register.mutate()
          }}
        >
          <h2>
            {selected.student.firstName} {selected.student.lastName} · счёт {selected.number}
          </h2>
          <p className="muted">
            {selected.description} · остаток {money(selected.remaining)} · срок {formatDate(selected.dueAt)}
          </p>
          <div className="form-grid">
            <label className="field">
              <span>Принято наличными, KGS</span>
              <input
                type="number"
                min={1}
                max={selected.remaining}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={register.isPending}>
              {register.isPending ? 'Сохраняем…' : 'Принять платёж'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setSelectedId('')}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {invoices.isLoading ? <div className="state">Загрузка счетов…</div> : null}
      {invoices.error ? <div className="alert alert-error">{errorMessage(invoices.error)}</div> : null}
      {invoices.data && invoices.data.items.length === 0 ? (
        <div className="state">Незакрытых счетов нет.</div>
      ) : null}

      {invoices.data && invoices.data.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Счёт</th>
                <th>Ученик</th>
                <th>Назначение</th>
                <th>Остаток</th>
                <th>Срок</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.data.items.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.number}</td>
                  <td>
                    {invoice.student.firstName} {invoice.student.lastName}
                    <div className="muted small">{invoice.student.email}</div>
                  </td>
                  <td className="small">{invoice.description}</td>
                  <td>{money(invoice.remaining)}</td>
                  <td className="small">{formatDate(invoice.dueAt)}</td>
                  <td>
                    <button
                      className="button button-small"
                      type="button"
                      onClick={() => {
                        setSelectedId(invoice.id)
                        setAmount(String(invoice.remaining))
                        setNote('')
                        setNotice(null)
                      }}
                    >
                      Выбрать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
