import type { FinanceExpenseCategory, FinanceInvoiceStatus, FinancePaymentStatus } from '../../api/finance'

/** Общее форматирование и словари для всех вкладок финансового раздела. */

export const money = (value: number) => `${new Intl.NumberFormat('ru-RU').format(value)} KGS`

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(new Date(value))

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

export const statusLabels: Record<FinanceInvoiceStatus, string> = {
  DRAFT: 'Черновик',
  ISSUED: 'Выставлен',
  PARTIALLY_PAID: 'Частично оплачен',
  PAID: 'Оплачен',
  OVERDUE: 'Просрочен',
  CANCELLED: 'Отменён',
}

export const paymentStatusLabels: Record<FinancePaymentStatus, string> = {
  PENDING: 'Ожидает',
  CONFIRMED: 'Подтверждён',
  FAILED: 'Ошибка',
  REFUNDED: 'Возвращён',
}

export const methodLabels: Record<string, string> = {
  CASH: 'Наличные',
  BANK_TRANSFER: 'Банковский перевод',
  ONLINE: 'Онлайн',
}

export const categoryLabels: Record<FinanceExpenseCategory, string> = {
  RENT: 'Аренда',
  SALARY: 'Зарплаты',
  EQUIPMENT: 'Оборудование',
  MARKETING: 'Маркетинг',
  UTILITIES: 'Коммунальные услуги',
  SOFTWARE: 'Программное обеспечение',
  OTHER: 'Прочее',
}

export type Tab = 'overview' | 'invoices' | 'payments' | 'refunds' | 'expenses' | 'pricing' | 'providers' | 'teachers'

export const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'invoices', label: 'Счета' },
  { id: 'payments', label: 'Платежи' },
  { id: 'refunds', label: 'Возвраты' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'pricing', label: 'Тарифы' },
  { id: 'teachers', label: 'Наставники' },
  { id: 'providers', label: 'Онлайн-оплата' },
]

export const todayInput = (daysAhead = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

export const toIso = (date: string) => new Date(`${date}T12:00:00.000Z`).toISOString()
