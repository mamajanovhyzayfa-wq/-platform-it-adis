import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminShopOrder } from '../api/admin'
import { errorMessage } from '../api/client'

const statuses = [
  { value: 'NEW', label: 'Новые' },
  { value: 'APPROVED', label: 'Одобрены' },
  { value: 'ISSUED', label: 'Выданы' },
  { value: 'REJECTED', label: 'Отклонены' },
  { value: 'ALL', label: 'Все' },
] as const

const statusLabels: Record<AdminShopOrder['status'], string> = {
  NEW: 'Новая',
  APPROVED: 'Одобрена',
  ISSUED: 'Выдана',
  REJECTED: 'Отклонена',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

/**
 * Модерация магазина: отклонение возвращает монеты и остаток на складе —
 * это делает сервер в одной транзакции, панель только отправляет статус.
 */
export function ShopPage() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<(typeof statuses)[number]['value']>('NEW')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ['admin-shop-orders', page, status],
    queryFn: () => adminApi.shopOrders({ page, limit: 20, status }),
  })

  const update = useMutation({
    mutationFn: (payload: { id: string; status: 'APPROVED' | 'ISSUED' | 'REJECTED' }) =>
      adminApi.updateShopOrder(payload.id, payload.status),
    onSuccess: (_data, payload) => {
      setNotice(
        payload.status === 'REJECTED'
          ? 'Заявка отклонена: монеты и остаток возвращены автоматически.'
          : payload.status === 'ISSUED'
            ? 'Награда отмечена как выданная, ученик получил уведомление.'
            : 'Заявка одобрена, ученик получил уведомление.',
      )
      void queryClient.invalidateQueries({ queryKey: ['admin-shop-orders'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const totalPages = orders.data ? Math.max(1, Math.ceil(orders.data.total / orders.data.limit)) : 1

  const changeStatus = (order: AdminShopOrder, next: 'APPROVED' | 'ISSUED' | 'REJECTED') => {
    if (next === 'REJECTED') {
      const confirmed = window.confirm(
        `Отклонить заявку на «${order.product.title}»? ${order.product.priceCoins} изикоинов вернутся ученику.`,
      )
      if (!confirmed) return
    }
    update.mutate({ id: order.id, status: next })
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Магазин</h1>
          <p className="muted">Заявки на награды за изикоины и их выдача.</p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {statuses.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={status === item.value}
            className={status === item.value ? 'tab tab-active' : 'tab'}
            onClick={() => {
              setStatus(item.value)
              setPage(1)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice ? <div className="alert">{notice}</div> : null}
      {orders.isLoading ? <div className="state">Загрузка…</div> : null}
      {orders.error ? <div className="alert alert-error">{errorMessage(orders.error)}</div> : null}

      {orders.data ? (
        orders.data.items.length === 0 ? (
          <div className="card muted">Заявок в этом статусе нет.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Награда</th>
                  <th>Стоимость</th>
                  <th>Статус</th>
                  <th>Создана</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      {order.user.firstName} {order.user.lastName}
                      <div className="muted small">{order.user.email}</div>
                    </td>
                    <td>
                      {order.product.title}
                      <div className="muted small">{order.product.category}</div>
                      {order.comment ? <div className="code-block">{order.comment}</div> : null}
                    </td>
                    <td>{order.product.priceCoins}</td>
                    <td>
                      <span className={`badge badge-${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span>
                    </td>
                    <td className="muted small">{formatDate(order.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        {order.status === 'NEW' ? (
                          <button
                            className="button button-small"
                            type="button"
                            disabled={update.isPending}
                            onClick={() => changeStatus(order, 'APPROVED')}
                          >
                            Одобрить
                          </button>
                        ) : null}
                        {(order.status === 'NEW' || order.status === 'APPROVED') ? (
                          <button
                            className="button button-small"
                            type="button"
                            disabled={update.isPending}
                            onClick={() => changeStatus(order, 'ISSUED')}
                          >
                            Выдать
                          </button>
                        ) : null}
                        {order.status !== 'REJECTED' && order.status !== 'ISSUED' ? (
                          <button
                            className="button button-small button-ghost"
                            type="button"
                            disabled={update.isPending}
                            onClick={() => changeStatus(order, 'REJECTED')}
                          >
                            Отклонить
                          </button>
                        ) : null}
                      </div>
                    </td>
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
          Страница {page} из {totalPages} · всего {orders.data?.total ?? 0}
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
