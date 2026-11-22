import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import { economyApi, type ShopOrder, type ShopProduct } from '../api/economy'
import { Empty, PageHeader, Section, StatusBadge, formatDateTime } from '../components/ui'

const categoryLabels: Record<string, string> = {
  DIGITAL: 'Цифровые награды',
  DISCOUNT: 'Скидки',
  MATERIAL: 'Учебные материалы',
  PRIVILEGE: 'Привилегии',
  PHYSICAL: 'Физические подарки',
}

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  APPROVED: 'Одобрена',
  READY: 'Готова к выдаче',
  ISSUED: 'Выдана',
  REJECTED: 'Отклонена',
  CANCELLED: 'Отменена',
}

const defaultProduct = {
  title: '', description: '', category: 'DIGITAL', priceCoins: '50', kind: 'DIGITAL', fulfillment: 'AUTOMATIC',
  deliveryUrl: '', terms: '', unlimitedStock: true, stock: '10',
}

/** Магазин филиала: каталог для учеников и управление наградами для администратора. */
export function ShopPage() {
  const role = getSession()?.role ?? 'STUDENT'
  const isAdmin = role === 'ADMIN'
  const canBuy = role === 'STUDENT' || role === 'TEACHER'
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'catalog' | 'orders' | 'manage'>('catalog')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selected, setSelected] = useState<ShopProduct | null>(null)
  const [comment, setComment] = useState('')
  const [deliveryDetails, setDeliveryDetails] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>(defaultProduct)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState('')

  const products = useQuery({
    queryKey: ['economy-products', search, category, favoriteOnly],
    queryFn: () => economyApi.products({ ...(search ? { search } : {}), ...(category ? { category } : {}), ...(favoriteOnly ? { favorite: true } : {}) }),
  })
  const orders = useQuery({
    queryKey: ['economy-orders', orderStatus],
    queryFn: () => economyApi.orders({ page: 1, limit: 100, ...(orderStatus ? { status: orderStatus } : {}) }),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['economy-products'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-orders'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-overview'] })
  }

  const favorite = useMutation({
    mutationFn: (id: string) => economyApi.favorite(id),
    onSuccess: () => refresh(),
    onError: (error) => setNotice(errorMessage(error)),
  })
  const buy = useMutation({
    mutationFn: (product: ShopProduct) => economyApi.createOrder({ productId: product.id, comment: comment || undefined, deliveryDetails: deliveryDetails || undefined }),
    onSuccess: (order) => {
      setNotice(order.status === 'ISSUED' ? 'Награда выдана автоматически и доступна в личном кабинете.' : 'Заявка отправлена: администратор подтвердит получение подарка.')
      setSelected(null)
      setComment('')
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const create = useMutation({
    mutationFn: () => economyApi.createProduct({ ...form, priceCoins: Number(form.priceCoins), stock: Number(form.stock), unlimitedStock: Boolean(form.unlimitedStock) }),
    onSuccess: () => {
      setNotice('Награда добавлена в каталог филиала.')
      setForm(defaultProduct)
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const update = useMutation({
    mutationFn: () => economyApi.updateProduct(editingId!, { ...form, priceCoins: Number(form.priceCoins), stock: Number(form.stock), unlimitedStock: Boolean(form.unlimitedStock) }),
    onSuccess: () => {
      setNotice('Награда обновлена.')
      setEditingId(null)
      setForm(defaultProduct)
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const setOrder = useMutation({
    mutationFn: (payload: { id: string; status: string; reason?: string }) => economyApi.updateOrder(payload.id, { status: payload.status, reason: payload.reason }),
    onSuccess: (_data, payload) => {
      setNotice(payload.status === 'REJECTED' || payload.status === 'CANCELLED' ? 'Заявка закрыта, монеты возвращены автоматически.' : 'Статус заявки обновлён.')
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const catalog = products.data ?? []
  const favoriteCount = useMemo(() => catalog.filter((item) => item.favorite).length, [catalog])
  const visible = tab === 'manage' ? catalog : catalog.filter((item) => isAdmin || item.isActive)

  const startEdit = (product: ShopProduct) => {
    setEditingId(product.id)
    setForm({
      title: product.title, description: product.description, category: product.category, priceCoins: String(product.priceCoins),
      kind: product.category === 'PHYSICAL' ? 'PHYSICAL' : 'DIGITAL',
      fulfillment: product.category === 'PHYSICAL' ? 'MANUAL' : 'AUTOMATIC',
      deliveryUrl: product.deliveryUrl ?? '', terms: product.terms ?? '',
      unlimitedStock: product.unlimitedStock, stock: String(product.stock ?? 10), isActive: product.isActive,
    })
    setTab('manage')
  }

  return (
    <div className="stack">
      <PageHeader title="Магазин IT Coins" subtitle="Отдельный каталог филиала: цифровые награды выдаются автоматически, физические подарки — после согласования получения." />
      {notice ? <div className="alert">{notice}</div> : null}

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'tab tab-active' : 'tab'} onClick={() => setTab('catalog')}>Каталог</button>
        <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'tab tab-active' : 'tab'} onClick={() => setTab('orders')}>{isAdmin ? 'Заявки' : 'Мои покупки'}</button>
        {isAdmin ? <button type="button" role="tab" aria-selected={tab === 'manage'} className={tab === 'manage' ? 'tab tab-active' : 'tab'} onClick={() => setTab('manage')}>Управление наградами</button> : null}
      </div>

      {tab === 'catalog' ? (
        <>
          <div className="filters">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск награды" />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Все категории</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className={`button button-small ${favoriteOnly ? '' : 'button-ghost'}`} type="button" onClick={() => setFavoriteOnly((value) => !value)}>
              Избранное · {favoriteCount}
            </button>
          </div>
          {products.isLoading ? <div className="state">Загрузка каталога…</div> : null}
          {products.error ? <div className="alert alert-error">{errorMessage(products.error)}</div> : null}
          {visible.length === 0 ? <Empty>Наград по этому фильтру нет.</Empty> : (
            <div className="shop-grid">
              {visible.map((product) => (
                <article className={`card shop-card ${product.available ? '' : 'shop-card-disabled'}`} key={product.id}>
                  <div className="row-between">
                    <span className="badge badge-muted">{categoryLabels[product.category] ?? product.category}</span>
                    <button className={product.favorite ? 'icon-button icon-button-active' : 'icon-button'} type="button" aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'} onClick={() => favorite.mutate(product.id)}>
                      {product.favorite ? '★' : '☆'}
                    </button>
                  </div>
                  {product.imageUrl ? <img className="shop-image" src={product.imageUrl} alt={product.title} /> : <div className="shop-image shop-placeholder">IT Coins</div>}
                  <h3>{product.title}</h3>
                  <p className="muted small shop-description">{product.description}</p>
                  <div className="row-between">
                    <strong className="amount-positive">{product.priceCoins} IT Coins</strong>
                    <span className="muted small">{product.kind === 'PHYSICAL' ? 'Физический подарок' : 'Цифровая награда'}</span>
                  </div>
                  <div className="row-actions">
                    <button className="button button-small button-ghost" type="button" onClick={() => setSelected(product)}>Подробнее</button>
                    {canBuy ? <button className="button button-small" type="button" disabled={!product.available || buy.isPending} onClick={() => { setSelected(product); setComment('') }}>{product.available ? 'Купить' : 'Нет в наличии'}</button> : <span className="muted small">Управление филиалом</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === 'orders' ? (
        <Section title={isAdmin ? 'Заявки магазина' : 'История покупок и обменов'} subtitle={isAdmin ? 'Цифровые награды выдаются сразу, физические — после согласования' : 'Статусы и детали получения'}>
          {isAdmin ? (
            <div className="filters">
              <select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
                <option value="">Все статусы</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          ) : null}
          {orders.isLoading ? <div className="state">Загрузка заявок…</div> : null}
          {orders.error ? <div className="alert alert-error">{errorMessage(orders.error)}</div> : null}
          {orders.data?.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Дата</th>{isAdmin ? <th>Ученик</th> : null}<th>Награда</th><th>Стоимость</th><th>Статус</th><th>Детали получения</th><th>Действия</th></tr></thead>
                <tbody>
                  {orders.data.items.map((order: ShopOrder) => (
                    <tr key={order.id}>
                      <td className="muted small">{formatDateTime(order.createdAt)}</td>
                      {isAdmin ? <td>{order.user ? `${order.user.firstName} ${order.user.lastName}` : '—'}</td> : null}
                      <td>{order.product.title}<div className="muted small">{categoryLabels[order.product.category] ?? order.product.category}</div></td>
                      <td>{order.priceCoins ?? order.product.priceCoins}</td>
                      <td><StatusBadge status={order.status} /> <span className="muted small">{statusLabels[order.status]}</span></td>
                      <td className="small">{order.deliveryDetails ?? order.comment ?? '—'}{order.rejectionReason ? <div className="muted">Причина: {order.rejectionReason}</div> : null}</td>
                      <td>
                        {isAdmin ? (
                          <div className="row-actions">
                            {order.status === 'NEW' ? <button className="button button-small" type="button" disabled={setOrder.isPending} onClick={() => setOrder.mutate({ id: order.id, status: 'APPROVED' })}>Одобрить</button> : null}
                            {order.status === 'APPROVED' ? <button className="button button-small" type="button" disabled={setOrder.isPending} onClick={() => setOrder.mutate({ id: order.id, status: 'READY' })}>Готова</button> : null}
                            {['NEW', 'APPROVED', 'READY'].includes(order.status) ? <button className="button button-small" type="button" disabled={setOrder.isPending} onClick={() => setOrder.mutate({ id: order.id, status: 'ISSUED' })}>Выдать</button> : null}
                            {['NEW', 'APPROVED', 'READY'].includes(order.status) ? <button className="button button-small button-ghost" type="button" disabled={setOrder.isPending} onClick={() => setOrder.mutate({ id: order.id, status: 'REJECTED', reason: 'Заявка отклонена администратором' })}>Отклонить</button> : null}
                          </div>
                        ) : <span className="muted small">{order.status === 'ISSUED' ? 'Получено' : order.status === 'READY' ? 'Можно забирать' : 'В обработке'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Покупок пока нет.</Empty>}
        </Section>
      ) : null}

      {tab === 'manage' && isAdmin ? (
        <>
          <Section title="Каталог филиала" subtitle="Количество наград по умолчанию не ограничено">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Название</th><th>Категория</th><th>Стоимость</th><th>Тип</th><th>Запас</th><th>Активна</th><th /></tr></thead>
                <tbody>
                  {catalog.map((product) => (
                    <tr key={product.id}>
                      <td>{product.title}</td>
                      <td>{categoryLabels[product.category] ?? product.category}</td>
                      <td>{product.priceCoins}</td>
                      <td>{product.kind === 'PHYSICAL' ? 'Физический' : 'Цифровой'} · {product.fulfillment === 'AUTOMATIC' ? 'авто' : 'вручную'}</td>
                      <td>{product.unlimitedStock ? 'Без ограничений' : product.stock}</td>
                      <td><span className={`badge ${product.isActive ? 'badge-active' : 'badge-muted'}`}>{product.isActive ? 'Да' : 'Нет'}</span></td>
                      <td><button className="button button-small button-ghost" type="button" onClick={() => startEdit(product)}>Изменить</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={editingId ? 'Изменить награду' : 'Новая награда'} subtitle="Администратор филиала создаёт собственные награды">
            <div className="form-grid">
              <label>Название<input value={String(form.title ?? '')} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>Категория<select value={String(form.category ?? 'DIGITAL')} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value, kind: event.target.value === 'PHYSICAL' ? 'PHYSICAL' : 'DIGITAL', fulfillment: event.target.value === 'PHYSICAL' ? 'MANUAL' : 'AUTOMATIC' }))}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="span-2">Описание<textarea rows={2} value={String(form.description ?? '')} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label>Стоимость<input type="number" min="1" value={String(form.priceCoins ?? '')} onChange={(event) => setForm((current) => ({ ...current, priceCoins: event.target.value }))} /></label>
              <label>Тип<select value={String(form.kind ?? 'DIGITAL')} disabled><option value="DIGITAL">Цифровая награда</option><option value="PHYSICAL">Физический подарок</option></select></label>
              <label>Выдача<select value={String(form.fulfillment ?? 'AUTOMATIC')} disabled><option value="AUTOMATIC">Автоматически</option><option value="MANUAL">После подтверждения</option></select></label>
              <label>Ссылка на цифровую награду<input value={String(form.deliveryUrl ?? '')} onChange={(event) => setForm((current) => ({ ...current, deliveryUrl: event.target.value }))} placeholder="https://…" /></label>
              <label className="span-2">Условия<input value={String(form.terms ?? '')} onChange={(event) => setForm((current) => ({ ...current, terms: event.target.value }))} /></label>
              <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.unlimitedStock)} onChange={(event) => setForm((current) => ({ ...current, unlimitedStock: event.target.checked }))} /> Запас не ограничен</label>
              {!form.unlimitedStock ? <label>Остаток<input type="number" min="0" value={String(form.stock ?? '0')} onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))} /></label> : null}
              {editingId ? <label className="checkbox-label"><input type="checkbox" checked={form.isActive !== false} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Показывать в каталоге</label> : null}
            </div>
            <div className="row-actions">
              <button className="button" type="button" disabled={String(form.title ?? '').trim().length < 2 || String(form.description ?? '').trim().length < 3 || create.isPending || update.isPending} onClick={() => (editingId ? update.mutate() : create.mutate())}>
                {editingId ? 'Сохранить изменения' : 'Добавить награду'}
              </button>
              {editingId ? <button className="button button-ghost" type="button" onClick={() => { setEditingId(null); setForm(defaultProduct) }}>Отмена</button> : null}
            </div>
          </Section>
        </>
      ) : null}

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={selected.title}>
          <div className="modal card stack">
            <div className="row-between">
              <h2>{selected.title}</h2>
              <button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            </div>
            <span className="badge badge-muted">{categoryLabels[selected.category] ?? selected.category}</span>
            <p>{selected.description}</p>
            {selected.terms ? <p className="muted small">Условия: {selected.terms}</p> : null}
            <p><strong>{selected.priceCoins} IT Coins</strong> · {selected.kind === 'PHYSICAL' ? 'получение подтверждает администратор' : 'выдаётся автоматически'}</p>
            <label>Комментарий<input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необязательно" /></label>
            {selected.kind === 'PHYSICAL' ? <label>Как удобно получить<input value={deliveryDetails} onChange={(event) => setDeliveryDetails(event.target.value)} placeholder="Например: на занятии в филиале" /></label> : null}
            {canBuy ? <button className="button" type="button" disabled={!selected.available || buy.isPending} onClick={() => buy.mutate(selected)}>Купить за {selected.priceCoins} IT Coins</button> : <p className="muted small">Эта карточка доступна ученикам и наставникам. Администратор управляет каталогом филиала.</p>}
            <p className="muted small">IT Coins — внутренняя валюта. Она не выводится и не передаётся другим ученикам.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
