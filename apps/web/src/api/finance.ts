import { http } from './client'

/** Финансовый API: типы ответов повторяют контракт backend-модуля finance. */

export type FinanceInvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
export type FinancePaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'ONLINE'
export type FinancePaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED'
export type FinanceExpenseCategory =
  | 'RENT'
  | 'SALARY'
  | 'EQUIPMENT'
  | 'MARKETING'
  | 'UTILITIES'
  | 'SOFTWARE'
  | 'OTHER'

export interface InvoiceTotals {
  received: number
  refunded: number
  remaining: number
  overpaid: number
}

interface InvoiceRefund {
  id: string
  amount: number
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED'
  reason: string
  createdAt: string
  reviewComment: string | null
}

export interface InvoicePayment {
  id: string
  amount: number
  method: FinancePaymentMethod
  status: FinancePaymentStatus
  paidAt: string
  note: string | null
  provider: string | null
  externalId: string | null
  refunded: number
  refunds: InvoiceRefund[]
}

export interface InvoiceDiscount {
  id: string
  amount: number
  reason: string
  createdAt: string
  createdBy: string
}

export interface FinanceInvoice {
  id: string
  number: string
  description: string
  amount: number
  grossAmount: number
  discountAmount: number
  discounts: InvoiceDiscount[]
  dueAt: string
  status: FinanceInvoiceStatus
  storedStatus: FinanceInvoiceStatus
  periodMonth: string | null
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
  currency: string
  student: { id: string; name: string; email: string; phone: string | null }
  course: { id: string; title: string } | null
  totals: InvoiceTotals
  payments: InvoicePayment[]
}

interface StudentOption {
  id: string
  name: string
  email: string
  phone: string | null
  courses: Array<{
    id: string
    title: string
    priceKgs: number
    billing: 'FULL' | 'MONTHLY' | 'INSTALLMENT'
    installmentsCount: number
  }>
}

export interface FinancePaymentRow extends InvoicePayment {
  student: { id: string; firstName: string; lastName: string; email: string }
  invoice: { id: string; number: string; amount: number }
  registeredBy: string | null
  pendingRefund: number
}

interface FinanceRefundRow {
  id: string
  amount: number
  reason: string
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED'
  createdAt: string
  reviewedAt: string | null
  reviewComment: string | null
  payment: {
    id: string
    amount: number
    method: FinancePaymentMethod
    paidAt: string
    invoiceNumber: string
    invoiceId: string
    student: { id: string; firstName: string; lastName: string; email: string }
  }
  requestedBy: string
  reviewedBy: string | null
}

interface FinanceExpense {
  id: string
  category: FinanceExpenseCategory
  categoryLabel: string
  amount: number
  spentAt: string
  description: string
  documentUrl: string | null
  documentUrls: string[]
  createdBy: string
  createdAt: string
}

export interface FinancePricingCourse {
  id: string
  title: string
  status: string
  priceKgs: number
  billing: 'FULL' | 'MONTHLY' | 'INSTALLMENT'
  installmentsCount: number
  invoicesCount: number
  studentsCount: number
}

interface FinancePriceHistory {
  id: string
  course: { id: string; title: string } | null
  previousPrice: number
  newPrice: number
  reason: string | null
  changedBy: string
  createdAt: string
}

export interface ProviderAccount {
  id: string
  provider: 'freedompay' | 'elsom'
  label: string
  merchantId: string
  tenantId: string | null
  secretEnvVar: string
  secretConfigured: boolean
  webhookSecretEnvVar: string | null
  baseUrl: string | null
  enabled: boolean
  isDefault: boolean
  settings: Record<string, unknown> | null
  source: 'database' | 'env'
  docsUrl: string | null
}

interface ProviderAccountsResponse {
  items: ProviderAccount[]
  providers: Array<{ value: 'freedompay' | 'elsom'; label: string; docsUrl: string; webhookPath: string }>
  note: string
}

export interface TeacherEarning {
  userId: string
  name: string
  email: string
  specialization: string | null
  isActive: boolean
  lessonRateKgs: number
  lessons: number
  earnedKgs: number
}

interface CheckoutResult {
  paymentId: string
  invoiceId: string
  provider: string
  amount: number
  currency: string
  redirectUrl: string
  disclaimer: string
}

export interface FinanceProviderStatus {
  configured: boolean
  provider: string | null
  missingEnv: string[]
  webhookPath: string
  note: string
  envVars: string[]
}

export interface FinanceOverview {
  currency: string
  range: { from: string; to: string }
  income: { payments: number; refunds: number; net: number }
  expenses: number
  profit: number
  outstanding: { total: number; overdue: number; overdueCount: number; invoices: number }
  counts: { payments: number; invoices: number; refundsPending: number }
  methods: Array<{ method: FinancePaymentMethod; amount: number; count: number }>
  expensesByCategory: Array<{ category: string; label: string; amount: number }>
  courses: Array<{ id: string; title: string; income: number }>
  groups: Array<{ id: string; title: string; students: number; income: number; outstanding: number }>
  monthly: Array<{ month: string; income: number; expenses: number; refunds: number }>
  debtors: Array<{
    student: { id: string; firstName: string; lastName: string; email: string }
    amount: number
    invoices: number
  }>
  provider: FinanceProviderStatus
}

interface Paginated<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
  currency: string
}

interface MeFinance {
  currency: string
  invoices: FinanceInvoice[]
  summary: { outstanding: number; paid: number; refunded: number }
  children: Array<{ id: string; name: string }>
}

export const financeApi = {
  overview: (params?: { from?: string; to?: string }) =>
    http.get<FinanceOverview>('/finance/overview', { params }).then((response) => response.data),

  invoices: (params: {
    page: number
    limit: number
    status?: FinanceInvoiceStatus | ''
    search?: string
  }) =>
    http
      .get<Paginated<FinanceInvoice>>('/finance/invoices', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.status ? { status: params.status } : {}),
          ...(params.search ? { search: params.search } : {}),
        },
      })
      .then((response) => response.data),

  invoice: (id: string) => http.get<FinanceInvoice>(`/finance/invoices/${id}`).then((response) => response.data),

  createInvoice: (payload: {
    studentId: string
    courseId?: string
    description: string
    amount: number
    dueAt: string
    periodMonth?: string
  }) => http.post<FinanceInvoice>('/finance/invoices', payload).then((response) => response.data),

  createInstallments: (payload: {
    studentId: string
    courseId?: string
    description: string
    totalAmount: number
    count: number
    firstDueAt: string
  }) =>
    http
      .post<{ items: FinanceInvoice[]; currency: string }>('/finance/invoices/installments', payload)
      .then((response) => response.data),

  cancelInvoice: (id: string, reason: string) =>
    http.patch<FinanceInvoice>(`/finance/invoices/${id}/cancel`, { reason }).then((response) => response.data),

  registerPayment: (payload: {
    invoiceId: string
    amount: number
    method: 'CASH' | 'BANK_TRANSFER'
    note?: string
  }) => http.post('/finance/payments', payload).then((response) => response.data),

  payments: (params: {
    page: number
    limit: number
    status?: FinancePaymentStatus | ''
    method?: FinancePaymentMethod | ''
    search?: string
  }) =>
    http
      .get<Paginated<FinancePaymentRow>>('/finance/payments', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.status ? { status: params.status } : {}),
          ...(params.method ? { method: params.method } : {}),
          ...(params.search ? { search: params.search } : {}),
        },
      })
      .then((response) => response.data),

  refunds: (status?: 'REQUESTED' | 'APPROVED' | 'REJECTED') =>
    http
      .get<{ items: FinanceRefundRow[]; currency: string }>('/finance/refunds', {
        params: status ? { status } : {},
      })
      .then((response) => response.data),

  requestRefund: (payload: { paymentId: string; amount: number; reason: string }) =>
    http.post('/finance/refunds', payload).then((response) => response.data),

  reviewRefund: (id: string, payload: { decision: 'APPROVE' | 'REJECT'; comment?: string }) =>
    http.patch(`/finance/refunds/${id}`, payload).then((response) => response.data),

  expenses: (params: { page: number; limit: number; category?: FinanceExpenseCategory | '' }) =>
    http
      .get<Paginated<FinanceExpense> & { sum: number }>('/finance/expenses', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.category ? { category: params.category } : {}),
        },
      })
      .then((response) => response.data),

  createExpense: (payload: {
    category: FinanceExpenseCategory
    amount: number
    spentAt?: string
    description: string
    documentUrl?: string
    documentUrls?: string[]
  }) => http.post('/finance/expenses', payload).then((response) => response.data),

  deleteExpense: (id: string) => http.delete(`/finance/expenses/${id}`).then((response) => response.data),

  pricing: () =>
    http
      .get<{ items: FinancePricingCourse[]; history: FinancePriceHistory[]; currency: string }>('/finance/courses')
      .then((response) => response.data),

  updatePrice: (
    id: string,
    payload: { priceKgs: number; billing: 'FULL' | 'MONTHLY' | 'INSTALLMENT'; installmentsCount: number; reason?: string },
  ) => http.patch(`/finance/courses/${id}/price`, payload).then((response) => response.data),

  students: (search?: string) =>
    http
      .get<{ items: StudentOption[] }>('/finance/students', {
        params: { ...(search ? { search } : {}) },
      })
      .then((response) => response.data.items),

  /** Печатная квитанция приходит HTML: её открывают в новой вкладке и печатают в PDF. */
  receipt: (id: string) =>
    http
      .get<string>(`/finance/invoices/${id}/receipt`, { responseType: 'text' })
      .then((response) => response.data as string),

  receiptPdf: (id: string) =>
    http
      .get<Blob>(`/finance/invoices/${id}/pdf`, { responseType: 'blob' })
      .then((response) => response.data),

  myFinance: () => http.get<MeFinance>('/finance/me').then((response) => response.data),

  checkout: (invoiceId: string) =>
    http.post<CheckoutResult>(`/finance/invoices/${invoiceId}/checkout`).then((response) => response.data),

  applyDiscount: (invoiceId: string, payload: { amount: number; reason: string }) =>
    http.patch<FinanceInvoice>(`/finance/invoices/${invoiceId}/discount`, payload).then((response) => response.data),

  adjustPayment: (
    id: string,
    payload: { amount?: number; status?: FinancePaymentStatus; reason: string },
  ) => http.patch(`/finance/payments/${id}`, payload).then((response) => response.data),

  providerAccounts: () =>
    http.get<ProviderAccountsResponse>('/finance/provider-accounts').then((response) => response.data),

  saveProviderAccount: (payload: {
    id?: string
    provider: 'freedompay' | 'elsom'
    label: string
    merchantId: string
    tenantId?: string
    secretEnvVar: string
    baseUrl?: string
    enabled: boolean
    isDefault: boolean
    settings?: Record<string, unknown>
  }) =>
    http
      .request<ProviderAccount>({
        method: payload.id ? 'PATCH' : 'POST',
        url: payload.id ? `/finance/provider-accounts/${payload.id}` : '/finance/provider-accounts',
        data: payload,
      })
      .then((response) => response.data),

  teacherEarnings: (params?: { from?: string; to?: string }) =>
    http
      .get<{ items: TeacherEarning[]; totals: { lessons: number; earnedKgs: number }; currency: string; range: { from: string; to: string } }>(
        '/finance/teacher-earnings',
        { params },
      )
      .then((response) => response.data),

  updateTeacherRate: (userId: string, lessonRateKgs: number) =>
    http.patch(`/finance/teachers/${userId}/rate`, { lessonRateKgs }).then((response) => response.data),

  exportCsv: (params?: { from?: string; to?: string }) =>
    http
      .get<Blob>('/finance/export', { params, responseType: 'blob' })
      .then((response) => response.data),

  accounting: (params?: { from?: string; to?: string }) =>
    http.get('/finance/accounting', { params }).then((response) => response.data),

  downloadBlob: (data: Blob, filename: string) => {
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },

  provider: () => http.get<FinanceProviderStatus>('/finance/provider').then((response) => response.data),

  managerInvoices: (search?: string) =>
    http
      .get<{
        items: Array<{
          id: string
          number: string
          description: string
          amount: number
          dueAt: string
          status: FinanceInvoiceStatus
          remaining: number
          student: { id: string; firstName: string; lastName: string; email: string }
        }>
        currency: string
      }>('/finance/manager/invoices', { params: { ...(search ? { search } : {}) } })
      .then((response) => response.data),

  registerCashPayment: (payload: { invoiceId: string; amount: number; note?: string }) =>
    http
      .post<{ duplicate: boolean; invoice: FinanceInvoice }>('/finance/manager/cash-payments', payload)
      .then((response) => response.data),
}
