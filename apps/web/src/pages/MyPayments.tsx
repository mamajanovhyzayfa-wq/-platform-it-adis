import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { errorMessage } from '../api/client'
import { financeApi, type FinanceInvoice } from '../api/finance'
import { formatDate, formatDateTime, methodLabels, money, paymentStatusLabels, statusLabels } from './finance/format'

/** Личная история оплат: ученик видит свои счета, родитель — подтверждённых детей. */
export function MyPaymentsPage() {
  const query = useQuery({ queryKey: ['my-finance'], queryFn: financeApi.myFinance })
  const [notice, setNotice] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

  const checkout = useMutation({
    mutationFn: (invoice: FinanceInvoice) => financeApi.checkout(invoice.id),
    onSuccess: (result) => {
      window.location.href = result.redirectUrl
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const download = async (invoice: FinanceInvoice) => {
    try {
      financeApi.downloadBlob(await financeApi.receiptPdf(invoice.id), `${invoice.number}.pdf`)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  if (query.isLoading) return <div className="state">Загрузка истории оплат…</div>
  if (query.error) return <div className="alert alert-error">{errorMessage(query.error)}</div>
  if (!query.data) return null
  const data = query.data

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Мои оплаты</h1>
          <p className="muted">Счета, платежи и квитанции. Онлайн-оплата подтверждается платёжным провайдером.</p>
        </div>
      </header>

      {notice ? <div className="alert alert-error">{notice}</div> : null}

      <section className="stats">
        <article className="stat"><span className="stat-label">К оплате</span><strong className={data.summary.outstanding > 0 ? 'amount-negative' : 'amount-positive'}>{money(data.summary.outstanding)}</strong></article>
        <article className="stat"><span className="stat-label">Оплачено</span><strong>{money(data.summary.paid)}</strong></article>
        <article className="stat"><span className="stat-label">Возвращено</span><strong>{money(data.summary.refunded)}</strong></article>
        <article className="stat"><span className="stat-label">Счетов</span><strong>{data.invoices.length}</strong></article>
      </section>

      {data.children.length > 1 ? (
        <p className="muted">Показаны счета детей: {data.children.map((child) => child.name).join(', ')}.</p>
      ) : null}

      {data.invoices.length === 0 ? <div className="card muted">Счетов пока нет.</div> : null}

      <div className="stack">
        {data.invoices.map((invoice) => (
          <article className="card stack" key={invoice.id}>
            <div className="page-header" style={{ marginBottom: 0 }}>
              <div>
                <h2>{invoice.number}</h2>
                <p className="muted small">
                  {invoice.description}
                  {invoice.course ? ` · ${invoice.course.title}` : ''}
                  {data.children.length > 1 ? ` · ${invoice.student.name}` : ''}
                </p>
              </div>
              <div className="row-actions">
                {invoice.status !== 'CANCELLED' && invoice.totals.remaining > 0 ? (
                  <button className="button button-small" type="button" disabled={checkout.isPending} onClick={() => checkout.mutate(invoice)}>
                    Оплатить онлайн
                  </button>
                ) : null}
                <button className="button button-ghost button-small" type="button" onClick={() => void download(invoice)}>
                  PDF-квитанция
                </button>
                <button className="button button-ghost button-small" type="button" onClick={() => setOpened(opened === invoice.id ? null : invoice.id)}>
                  {opened === invoice.id ? 'Скрыть платежи' : 'Платежи'}
                </button>
              </div>
            </div>

            <div className="grid two">
              <div>
                <span className="muted small">Сумма счёта</span>
                <div><strong>{money(invoice.amount)}</strong></div>
                {invoice.discountAmount > 0 ? <div className="muted small">скидка {money(invoice.discountAmount)}</div> : null}
              </div>
              <div>
                <span className="muted small">Остаток</span>
                <div><strong className={invoice.totals.remaining > 0 ? 'amount-negative' : 'amount-positive'}>{money(invoice.totals.remaining)}</strong></div>
                <div className="muted small">срок {formatDate(invoice.dueAt)}</div>
              </div>
              <div><span className="muted small">Статус</span><div>{statusLabels[invoice.status]}</div></div>
            </div>

            {opened === invoice.id ? (
              invoice.payments.length === 0 ? (
                <p className="muted">Платежей по счёту пока нет.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Дата</th><th>Способ</th><th>Сумма</th><th>Статус</th><th>Провайдер</th></tr></thead>
                    <tbody>
                      {invoice.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="small">{formatDateTime(payment.paidAt)}</td>
                          <td>{methodLabels[payment.method]}</td>
                          <td>{money(payment.amount)}</td>
                          <td>{paymentStatusLabels[payment.status]}</td>
                          <td className="small">{payment.provider ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}

            {invoice.discounts.length > 0 ? (
              <div className="muted small">
                Скидки: {invoice.discounts.map((discount) => `${money(discount.amount)} — ${discount.reason}`).join('; ')}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
