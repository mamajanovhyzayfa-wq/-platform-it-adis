import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type FinanceInvoice, type FinanceInvoiceStatus } from '../../api/finance'
import { formatDate, money, statusLabels, todayInput, toIso } from './format'

export function InvoicesTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<FinanceInvoiceStatus | ''>('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [studentSearch, setStudentSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [description, setDescription] = useState('Оплата обучения')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(todayInput(7))
  const [installmentMode, setInstallmentMode] = useState(false)
  const [installmentCount, setInstallmentCount] = useState('3')
  const [periodMonth, setPeriodMonth] = useState(new Date().toISOString().slice(0, 7))

  const [paying, setPaying] = useState<FinanceInvoice | null>(null)
  const [discountFor, setDiscountFor] = useState<FinanceInvoice | null>(null)
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH')
  const [payNote, setPayNote] = useState('')

  const invoices = useQuery({
    queryKey: ['finance-invoices', page, search, status],
    queryFn: () => financeApi.invoices({ page, limit: 20, search, status }),
  })

  const students = useQuery({
    queryKey: ['finance-students', studentSearch],
    queryFn: () => financeApi.students(studentSearch),
    enabled: formOpen && studentSearch.trim().length >= 2,
  })

  const selectedStudent = students.data?.find((student) => student.id === studentId) ?? null
  const selectedCourse = selectedStudent?.courses.find((course) => course.id === courseId) ?? null

  /** Выбор курса подставляет его фиксированную стоимость и модель оплаты. */
  const selectCourse = (nextCourseId: string) => {
    setCourseId(nextCourseId)
    const course = selectedStudent?.courses.find((item) => item.id === nextCourseId)
    if (!course) return
    setAmount(course.priceKgs > 0 ? String(course.priceKgs) : '')
    if (course.billing === 'INSTALLMENT') {
      setInstallmentMode(true)
      setInstallmentCount(String(course.installmentsCount || 3))
    } else {
      setInstallmentMode(false)
    }
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance-invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['finance-payments'] })
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!studentId) throw new Error('Выберите ученика')
      const value = Number(amount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму больше нуля')

      if (installmentMode) {
        return financeApi.createInstallments({
          studentId,
          ...(courseId ? { courseId } : {}),
          description,
          totalAmount: value,
          count: Number(installmentCount),
          firstDueAt: toIso(dueDate),
        })
      }
      return financeApi.createInvoice({
        studentId,
        ...(courseId ? { courseId } : {}),
        description,
        amount: value,
        dueAt: toIso(dueDate),
        ...(selectedCourse?.billing === 'MONTHLY' ? { periodMonth } : {}),
      })
    },
    onSuccess: (result) => {
      const created = 'items' in result ? result.items.length : 1
      setNotice(`Счёт создан${created > 1 ? `и: ${created} шт.` : ''}. Ученик получил уведомление.`)
      setFormOpen(false)
      setAmount('')
      setStudentId('')
      setCourseId('')
      setStudentSearch('')
      setInstallmentMode(false)
      setPeriodMonth(new Date().toISOString().slice(0, 7))
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const pay = useMutation({
    mutationFn: async () => {
      if (!paying) throw new Error('Счёт не выбран')
      const value = Number(payAmount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму больше нуля')
      return financeApi.registerPayment({
        invoiceId: paying.id,
        amount: value,
        method: payMethod,
        ...(payNote ? { note: payNote } : {}),
      })
    },
    onSuccess: (result) => {
      const response = result as { invoice: FinanceInvoice }
      setNotice(`Платёж принят. Остаток по счёту: ${money(response.invoice.totals.remaining)}`)
      setPaying(null)
      setPayAmount('')
      setPayNote('')
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const applyDiscount = useMutation({
    mutationFn: async () => {
      if (!discountFor) throw new Error('Счёт не выбран')
      const value = Number(discountAmount)
      if (!Number.isInteger(value) || value <= 0) throw new Error('Укажите сумму скидки')
      if (discountReason.trim().length < 3) throw new Error('Укажите причину скидки')
      return financeApi.applyDiscount(discountFor.id, { amount: value, reason: discountReason.trim() })
    },
    onSuccess: () => {
      setNotice('Скидка применена, счёт и уведомления обновлены')
      setDiscountFor(null)
      setDiscountAmount('')
      setDiscountReason('')
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const checkout = useMutation({
    mutationFn: (invoice: FinanceInvoice) => financeApi.checkout(invoice.id),
    onSuccess: (result) => {
      setNotice(`Переходим на страницу ${result.provider}. После оплаты статус обновится автоматически.`)
      window.location.href = result.redirectUrl
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: (invoice: FinanceInvoice) => {
      const reason = window.prompt(`Причина отмены счёта ${invoice.number}`, 'Счёт выставлен ошибочно')
      if (reason === null) throw new Error('Отмена прервана')
      return financeApi.cancelInvoice(invoice.id, reason)
    },
    onSuccess: () => {
      setNotice('Счёт отменён')
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const downloadPdf = async (invoiceId: string, number: string) => {
    try {
      const blob = await financeApi.receiptPdf(invoiceId)
      financeApi.downloadBlob(blob, `${number}.pdf`)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const openReceipt = async (invoiceId: string) => {
    const win = window.open('', '_blank')
    try {
      const html = await financeApi.receipt(invoiceId)
      if (!win) {
        setNotice('Разрешите всплывающие окна, чтобы открыть квитанцию')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
    } catch (error) {
      win?.close()
      setNotice(errorMessage(error))
    }
  }

  const totalPages = invoices.data?.pages ?? 1

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}

      <div className="filters">
        <input
          placeholder="Поиск: номер, ученик, описание"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as FinanceInvoiceStatus | '')
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="button" type="button" onClick={() => setFormOpen(!formOpen)}>
          {formOpen ? 'Скрыть форму' : 'Новый счёт'}
        </button>
      </div>

      {formOpen ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <h2>Выставить счёт</h2>
          <div className="form-grid">
            <label className="field">
              <span>Ученик (поиск)</span>
              <input
                value={studentSearch}
                onChange={(event) => {
                  setStudentSearch(event.target.value)
                  setStudentId('')
                  setCourseId('')
                }}
                placeholder="Имя, email или телефон"
              />
            </label>
            <label className="field">
              <span>Найденный ученик</span>
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">— выберите —</option>
                {(students.data ?? []).map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} · {student.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Курс (необязательно)</span>
              <select value={courseId} onChange={(event) => selectCourse(event.target.value)}>
                <option value="">Без курса</option>
                {(selectedStudent?.courses ?? []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} · {money(course.priceKgs)}
                    {course.billing === 'MONTHLY' ? ' · ежемесячно' : course.billing === 'INSTALLMENT' ? ' · рассрочка' : ''}
                  </option>
                ))}
              </select>
              {selectedCourse ? (
                <span className="muted small">
                  Стоимость курса: {money(selectedCourse.priceKgs)}
                  {selectedCourse.billing === 'INSTALLMENT' ? ` · ${selectedCourse.installmentsCount} частей` : ''}
                </span>
              ) : null}
            </label>
            <label className="field">
              <span>Назначение</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} required />
            </label>
            <label className="field">
              <span>{installmentMode ? 'Общая сумма' : 'Сумма, KGS'}</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>{installmentMode ? 'Первый платёж' : 'Срок оплаты'}</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
            </label>
            {!installmentMode && selectedCourse?.billing === 'MONTHLY' ? (
              <label className="field">
                <span>Месяц начисления</span>
                <input type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} required />
              </label>
            ) : null}
            <label className="field">
              <span>Рассрочка</span>
              <select
                value={installmentMode ? 'yes' : 'no'}
                onChange={(event) => setInstallmentMode(event.target.value === 'yes')}
              >
                <option value="no">Один счёт</option>
                <option value="yes">Несколько счетов</option>
              </select>
            </label>
            {installmentMode ? (
              <label className="field">
                <span>Количество частей</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={installmentCount}
                  onChange={(event) => setInstallmentCount(event.target.value)}
                />
              </label>
            ) : null}
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать и уведомить'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {paying ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            pay.mutate()
          }}
        >
          <h2>
            Платёж по счёту {paying.number} · остаток {money(paying.totals.remaining)}
          </h2>
          <div className="form-grid">
            <label className="field">
              <span>Сумма, KGS</span>
              <input
                type="number"
                min={1}
                max={paying.totals.remaining}
                value={payAmount}
                onChange={(event) => setPayAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Способ</span>
              <select
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value as 'CASH' | 'BANK_TRANSFER')}
              >
                <option value="CASH">Наличные</option>
                <option value="BANK_TRANSFER">Банковский перевод</option>
              </select>
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input value={payNote} onChange={(event) => setPayNote(event.target.value)} />
            </label>
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={pay.isPending}>
              {pay.isPending ? 'Сохраняем…' : 'Принять платёж'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setPaying(null)}>
              Закрыть
            </button>
          </div>
        </form>
      ) : null}

      {discountFor ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            applyDiscount.mutate()
          }}
        >
          <h2>Скидка по счёту {discountFor.number}</h2>
          <p className="muted small">Сумма счёта: {money(discountFor.amount)}. Скидка уменьшит остаток и сохранится в истории.</p>
          <div className="form-grid">
            <label className="field">
              <span>Сумма скидки, KGS</span>
              <input type="number" min={1} max={discountFor.amount} value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} required />
            </label>
            <label className="field">
              <span>Причина</span>
              <input value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} minLength={3} required />
            </label>
          </div>
          <div className="row-actions">
            <button className="button" type="submit" disabled={applyDiscount.isPending}>Применить скидку</button>
            <button className="button button-ghost" type="button" onClick={() => setDiscountFor(null)}>Закрыть</button>
          </div>
        </form>
      ) : null}

      {invoices.isLoading ? <div className="state">Загрузка счетов…</div> : null}
      {invoices.error ? <div className="alert alert-error">{errorMessage(invoices.error)}</div> : null}

      {invoices.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Ученик</th>
                  <th>Назначение</th>
                  <th>Сумма</th>
                  <th>Оплачено</th>
                  <th>Остаток</th>
                  <th>Срок</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.data.items.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.number}</strong>
                      <div className="muted small">{formatDate(invoice.createdAt)}</div>
                    </td>
                    <td>
                      {invoice.student.name}
                      <div className="muted small">{invoice.student.email}</div>
                    </td>
                    <td>
                      {invoice.description}
                      {invoice.course ? <div className="muted small">{invoice.course.title}</div> : null}
                    </td>
                    <td>
                      {money(invoice.amount)}
                      {invoice.discountAmount > 0 ? <div className="muted small">скидка {money(invoice.discountAmount)}</div> : null}
                    </td>
                    <td className="amount-positive">{money(invoice.totals.received - invoice.totals.refunded)}</td>
                    <td>{money(invoice.totals.remaining)}</td>
                    <td className="small">{formatDate(invoice.dueAt)}</td>
                    <td>
                      <span className={`badge badge-${invoice.status === 'OVERDUE' ? 'rejected' : invoice.status === 'PAID' ? 'approved' : 'new'}`}>
                        {statusLabels[invoice.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {invoice.status !== 'CANCELLED' && invoice.totals.remaining > 0 ? (
                          <button
                            className="button button-small"
                            type="button"
                            onClick={() => {
                              setPaying(invoice)
                              setPayAmount(String(invoice.totals.remaining))
                            }}
                          >
                            Платёж
                          </button>
                        ) : null}
                        {invoice.status !== 'CANCELLED' && invoice.totals.remaining > 0 ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            disabled={checkout.isPending}
                            onClick={() => checkout.mutate(invoice)}
                          >
                            Онлайн
                          </button>
                        ) : null}
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void openReceipt(invoice.id)}
                        >
                          HTML
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void downloadPdf(invoice.id, invoice.number)}
                        >
                          PDF
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => {
                            setDiscountFor(invoice)
                            setDiscountAmount(String(Math.min(invoice.amount, invoice.totals.remaining)))
                          }}
                        >
                          Скидка
                        </button>
                        {invoice.status !== 'CANCELLED' && invoice.totals.received - invoice.totals.refunded === 0 ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(invoice)}
                          >
                            Отменить
                          </button>
                        ) : null}
                      </div>
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
              Страница {page} из {totalPages} · всего {invoices.data.total}
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
