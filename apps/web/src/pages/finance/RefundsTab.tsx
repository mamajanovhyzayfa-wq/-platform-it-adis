import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi } from '../../api/finance'
import { formatDateTime, money } from './format'

export function RefundsTab() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const refunds = useQuery({ queryKey: ['finance-refunds'], queryFn: () => financeApi.refunds() })

  const review = useMutation({
    mutationFn: (payload: { id: string; decision: 'APPROVE' | 'REJECT' }) => {
      const comment = window.prompt(
        payload.decision === 'APPROVE' ? 'Комментарий к возврату (необязательно)' : 'Причина отказа',
        '',
      )
      if (comment === null) throw new Error('Действие отменено')
      return financeApi.reviewRefund(payload.id, {
        decision: payload.decision,
        ...(comment ? { comment } : {}),
      })
    },
    onSuccess: () => {
      setNotice('Решение сохранено, ученик и родитель уведомлены')
      void queryClient.invalidateQueries({ queryKey: ['finance-refunds'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}
      {refunds.isLoading ? <div className="state">Загрузка возвратов…</div> : null}
      {refunds.error ? <div className="alert alert-error">{errorMessage(refunds.error)}</div> : null}

      {refunds.data && refunds.data.items.length === 0 ? <div className="state">Заявок пока нет.</div> : null}

      {refunds.data && refunds.data.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Ученик</th>
                <th>Счёт</th>
                <th>Платёж</th>
                <th>Возврат</th>
                <th>Причина</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {refunds.data.items.map((refund) => (
                <tr key={refund.id}>
                  <td className="small">{formatDateTime(refund.createdAt)}</td>
                  <td>
                    {refund.payment.student.firstName} {refund.payment.student.lastName}
                  </td>
                  <td>{refund.payment.invoiceNumber}</td>
                  <td>{money(refund.payment.amount)}</td>
                  <td>{money(refund.amount)}</td>
                  <td className="small">{refund.reason}</td>
                  <td>
                    <span className={`badge badge-${refund.status === 'APPROVED' ? 'approved' : refund.status === 'REJECTED' ? 'rejected' : 'new'}`}>
                      {refund.status === 'REQUESTED' ? 'На рассмотрении' : refund.status === 'APPROVED' ? 'Одобрен' : 'Отклонён'}
                    </span>
                    {refund.reviewComment ? <div className="muted small">{refund.reviewComment}</div> : null}
                  </td>
                  <td>
                    {refund.status === 'REQUESTED' ? (
                      <div className="row-actions">
                        <button
                          className="button button-small"
                          type="button"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: refund.id, decision: 'APPROVE' })}
                        >
                          Одобрить
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: refund.id, decision: 'REJECT' })}
                        >
                          Отклонить
                        </button>
                      </div>
                    ) : null}
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
