import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type FinancePaymentRow, type FinancePaymentStatus } from '../../api/finance'
import { formatDateTime, methodLabels, money, paymentStatusLabels } from './format'

export function PaymentsTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<FinancePaymentStatus | ''>('')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  const [refundFor, setRefundFor] = useState<{ paymentId: string; available: number; invoice: string } | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [adjustFor, setAdjustFor] = useState<FinancePaymentRow | null>(null)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustStatus, setAdjustStatus] = useState<FinancePaymentStatus>('CONFIRMED')
  const [adjustReason, setAdjustReason] = useState('')

  const payments = useQuery({
    queryKey: ['finance-payments', page, search, status],
    queryFn: () => financeApi.payments({ page, limit: 20, search, status }),
  })

  const refund = useMutation({
    mutationFn: async () => {
      if (!refundFor) throw new Error('Платёж не выбран')
      const value = Number(refundAmount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму возврата')
      return financeApi.requestRefund({ paymentId: refundFor.paymentId, amount: value, reason: refundReason })
    },
    onSuccess: () => {
      setNotice('Заявка на возврат создана и ждёт решения администратора')
      setRefundFor(null)
      setRefundAmount('')
      setRefundReason('')
      void queryClient.invalidateQueries({ queryKey: ['finance-payments'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-refunds'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const adjust = useMutation({
    mutationFn: async () => {
      if (!adjustFor) throw new Error('Платёж не выбран')
      const value = Number(adjustAmount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму платежа')
      if (adjustReason.trim().length < 5) throw new Error('Опишите причину корректировки')
      return financeApi.adjustPayment(adjustFor.id, { amount: value, status: adjustStatus, reason: adjustReason.trim() })
    },
    onSuccess: () => {
      setNotice('Корректировка сохранена в истории, счёт пересчитан')
      setAdjustFor(null)
      setAdjustAmount('')
      setAdjustReason('')
      void queryClient.invalidateQueries({ queryKey: ['finance-payments'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const totalPages = payments.data?.pages ?? 1

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}

      <div className="filters">
        <input
          placeholder="Поиск: ученик, номер счёта"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as FinancePaymentStatus | '')
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          {Object.entries(paymentStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {refundFor ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            refund.mutate()
          }}
        >
          <h2>Возврат по счёту {refundFor.invoice}</h2>
          <p className="muted small">Доступно к возврату: {money(refundFor.available)}</p>
          <div className="form-grid">
            <label className="field">
              <span>Сумма, KGS</span>
              <input
                type="number"
                min={1}
                max={refundFor.available}
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Причина</span>
              <input
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                minLength={5}
                required
              />
            </label>
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={refund.isPending}>
              Отправить на рассмотрение
            </button>
            <button className="button button-ghost" type="button" onClick={() => setRefundFor(null)}>
              Закрыть
            </button>
          </div>
        </form>
      ) : null}

      {adjustFor ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            adjust.mutate()
          }}
        >
          <h2>Корректировка платежа по счёту {adjustFor.invoice.number}</h2>
          <p className="muted small">Изменение суммы или статуса фиксируется в истории, счёт пересчитывается автоматически.</p>
          <div className="form-grid">
            <label className="field">
              <span>Сумма, KGS</span>
              <input type="number" min={1} value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} required />
            </label>
            <label className="field">
              <span>Статус</span>
              <select value={adjustStatus} onChange={(event) => setAdjustStatus(event.target.value as FinancePaymentStatus)}>
                <option value="CONFIRMED">Подтверждён</option>
                <option value="PENDING">Ожидает</option>
                <option value="FAILED">Ошибка</option>
              </select>
            </label>
            <label className="field">
              <span>Причина</span>
              <input value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} minLength={5} required />
            </label>
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={adjust.isPending}>Сохранить корректировку</button>
            <button className="button button-ghost" type="button" onClick={() => setAdjustFor(null)}>Закрыть</button>
          </div>
        </form>
      ) : null}

      {payments.isLoading ? <div className="state">Загрузка платежей…</div> : null}
      {payments.error ? <div className="alert alert-error">{errorMessage(payments.error)}</div> : null}

      {payments.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Ученик</th>
                  <th>Счёт</th>
                  <th>Способ</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Кто принял</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.data.items.map((payment) => {
                  const available = payment.amount - payment.refunded - payment.pendingRefund
                  return (
                    <tr key={payment.id}>
                      <td className="small">{formatDateTime(payment.paidAt)}</td>
                      <td>
                        {payment.student.firstName} {payment.student.lastName}
                        <div className="muted small">{payment.student.email}</div>
                      </td>
                      <td>{payment.invoice.number}</td>
                      <td>{methodLabels[payment.method]}</td>
                      <td>{money(payment.amount)}</td>
                      <td>
                        <span className={`badge badge-${payment.status === 'CONFIRMED' ? 'approved' : payment.status === 'REFUNDED' ? 'rejected' : 'new'}`}>
                          {paymentStatusLabels[payment.status]}
                        </span>
                        {payment.refunded > 0 ? (
                          <div className="muted small">возвращено {money(payment.refunded)}</div>
                        ) : null}
                      </td>
                      <td className="small">{payment.registeredBy ?? '—'}</td>
                      <td>
                        {payment.status === 'CONFIRMED' || payment.status === 'PENDING' ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={() => {
                              setAdjustFor(payment)
                              setAdjustAmount(String(payment.amount))
                              setAdjustStatus(payment.status)
                            }}
                          >
                            Корректировка
                          </button>
                        ) : null}
                        {payment.status === 'CONFIRMED' && payment.method !== 'ONLINE' && available > 0 ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={() => {
                              setRefundFor({
                                paymentId: payment.id,
                                available,
                                invoice: payment.invoice.number,
                              })
                              setRefundAmount(String(available))
                            }}
                          >
                            Возврат
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="button button-ghost" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Назад
            </button>
            <span className="muted">
              Страница {page} из {totalPages} · всего {payments.data.total}
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
