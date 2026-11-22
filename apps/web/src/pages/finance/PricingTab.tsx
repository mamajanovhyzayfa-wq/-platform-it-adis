import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type FinancePricingCourse } from '../../api/finance'
import { formatDateTime, money } from './format'

function PricingRow({ course }: { course: FinancePricingCourse }) {
  const queryClient = useQueryClient()
  const [price, setPrice] = useState(String(course.priceKgs))
  const [billing, setBilling] = useState(course.billing)
  const [count, setCount] = useState(String(course.installmentsCount))
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      financeApi.updatePrice(course.id, {
        priceKgs: Number(price),
        billing,
        installmentsCount: Number(count),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      setNotice('Сохранено')
      void queryClient.invalidateQueries({ queryKey: ['finance-pricing'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <tr>
      <td>
        <strong>{course.title}</strong>
        <div className="muted small">
          {course.studentsCount} учеников · {course.invoicesCount} счетов
        </div>
        {notice ? <div className="small muted">{notice}</div> : null}
      </td>
      <td>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          style={{ minWidth: 120 }}
        />
      </td>
      <td>
        <select value={billing} onChange={(event) => setBilling(event.target.value as FinancePricingCourse['billing'])}>
          <option value="FULL">Полная оплата</option>
          <option value="MONTHLY">Ежемесячно</option>
          <option value="INSTALLMENT">Рассрочка</option>
        </select>
      </td>
      <td>
        {billing === 'INSTALLMENT' ? (
          <input
            type="number"
            min={2}
            max={60}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            style={{ minWidth: 80 }}
          />
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина изменения" style={{ minWidth: 150 }} />
        <button className="button button-small" type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          Сохранить
        </button>
      </td>
    </tr>
  )
}

export function PricingTab() {
  const pricing = useQuery({ queryKey: ['finance-pricing'], queryFn: financeApi.pricing })

  if (pricing.isLoading) return <div className="state">Загрузка тарифов…</div>
  if (pricing.error) return <div className="alert alert-error">{errorMessage(pricing.error)}</div>
  if (!pricing.data) return null

  return (
    <div className="stack">
      <p className="muted">
        Стоимость фиксируется за курсом. Изменение цены не пересчитывает уже выставленные счета — оно влияет на новые
        счета и отображается в истории.
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Курс</th>
              <th>Цена, KGS</th>
              <th>Модель оплаты</th>
              <th>Частей</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pricing.data.items.map((course) => (
              <PricingRow key={`${course.id}-${course.priceKgs}-${course.billing}`} course={course} />
            ))}
          </tbody>
        </table>
      </div>

      <article className="card">
        <h2>История изменения цен</h2>
        {pricing.data.history.length === 0 ? <p className="muted">Изменений пока нет.</p> : null}
        {pricing.data.history.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Курс</th>
                <th>Было</th>
                <th>Стало</th>
                <th>Причина</th>
                <th>Автор</th>
              </tr>
            </thead>
            <tbody>
              {pricing.data.history.map((entry) => (
                <tr key={entry.id}>
                  <td className="small">{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.course?.title ?? '—'}</td>
                  <td>{money(entry.previousPrice)}</td>
                  <td>{money(entry.newPrice)}</td>
                  <td className="small">{entry.reason ?? '—'}</td>
                  <td className="small">{entry.changedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </article>
    </div>
  )
}
