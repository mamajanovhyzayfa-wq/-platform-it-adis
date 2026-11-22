import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { env } from '../../config/env.js'
import { FinanceAccessService } from './finance.access.js'
import { CURRENCY } from './finance.calc.js'
import { effectiveStatus, recalculateInvoiceStatus } from './finance.invoice-status.js'
import { notifyInvoiceParties } from './finance.notify.js'
import { invoiceInclude } from './finance.shared.js'
import { elsomAdapter, elsomPaymentStatus } from '../../integrations/payments/adapters/elsom.js'
import { freedomPayAdapter } from '../../integrations/payments/adapters/freedompay.js'
import type {
  PaymentProviderAdapter, ProviderAccountConfig, ProviderCode, ProviderWebhookEvent,
} from '../../integrations/payments/adapters/types.js'

const ADAPTERS: Record<ProviderCode, PaymentProviderAdapter> = {
  freedompay: freedomPayAdapter,
  elsom: elsomAdapter,
}

const PROVIDER_LABELS: Record<ProviderCode, string> = {
  freedompay: 'FreedomPay Кыргызстан',
  elsom: 'Elsom / КИКБ',
}

const PROVIDER_DOCS: Record<ProviderCode, string> = {
  freedompay: 'https://freedompay.kg/docs/merchant-api/pay',
  elsom: 'https://kicb.net/upload/iblock/5e1/cp38grmveeheeywaf6dlbrdexzifvehm/New_API_Merchant_Payment_Partner%20к%20интернет%20эквайрингу.pdf',
}

const isProvider = (value: string): value is ProviderCode => value === 'freedompay' || value === 'elsom'

interface ProviderAccountRow {
  id: string
  provider: string
  label: string
  merchantId: string
  tenantId: string | null
  secretEnvVar: string
  webhookSecretEnvVar: string | null
  baseUrl: string | null
  enabled: boolean
  isDefault: boolean
  settings: Prisma.JsonValue | null
  source?: 'database' | 'env'
}

/** Онлайн-платежи: аккаунты филиала, адаптеры провайдеров и обработка подтверждений. */
@Injectable()
export class OnlinePaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceAccessService) private readonly access: FinanceAccessService,
  ) {}

  private envAccount(provider: ProviderCode): ProviderAccountRow | null {
    if (provider === 'freedompay') {
      if (!env.FREEDOMPAY_MERCHANT_ID && !env.FREEDOMPAY_SECRET_KEY) return null
      return {
        id: `env-${provider}`,
        provider,
        label: `${PROVIDER_LABELS[provider]} (переменные окружения)`,
        merchantId: env.FREEDOMPAY_MERCHANT_ID ?? '',
        tenantId: null,
        secretEnvVar: 'FREEDOMPAY_SECRET_KEY',
        webhookSecretEnvVar: null,
        baseUrl: env.FREEDOMPAY_BASE_URL,
        enabled: true,
        isDefault: true,
        settings: { testing: env.FREEDOMPAY_TESTING_MODE },
        source: 'env',
      }
    }
    if (!env.ELSOM_PARTNER_CODE && !env.ELSOM_PASSWORD) return null
    return {
      id: `env-${provider}`,
      provider,
      label: `${PROVIDER_LABELS[provider]} (переменные окружения)`,
      merchantId: env.ELSOM_PARTNER_CODE ?? '',
      tenantId: env.ELSOM_TENANT_ID ?? null,
      secretEnvVar: 'ELSOM_PASSWORD',
      webhookSecretEnvVar: null,
      baseUrl: env.ELSOM_BASE_URL ?? null,
      enabled: true,
      isDefault: true,
      settings: null,
      source: 'env',
    }
  }

  private async rows(): Promise<ProviderAccountRow[]> {
    const database = await this.prisma.client.paymentProviderAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
    const rows: ProviderAccountRow[] = database.map((row) => ({ ...row, source: 'database' }))
    for (const provider of ['freedompay', 'elsom'] as ProviderCode[]) {
      if (!rows.some((row) => row.provider === provider)) {
        const virtual = this.envAccount(provider)
        if (virtual) rows.push(virtual)
      }
    }
    return rows
  }

  private configured(row: ProviderAccountRow): boolean {
    return Boolean(row.merchantId && process.env[row.secretEnvVar])
  }

  private toConfig(row: ProviderAccountRow): ProviderAccountConfig {
    const provider = isProvider(row.provider) ? row.provider : null
    if (!provider) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', `Неизвестный платёжный провайдер: ${row.provider}`)
    const secret = process.env[row.secretEnvVar]
    if (!secret) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', `Не задан секрет ${row.secretEnvVar} для ${PROVIDER_LABELS[provider]}`)
    const settings = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : {}
    return {
      id: row.id,
      provider,
      label: row.label,
      merchantId: row.merchantId,
      tenantId: row.tenantId,
      secret,
      baseUrl: row.baseUrl ?? undefined,
      testing: settings.testing === true,
      settings,
    }
  }

  async accounts() {
    const rows = await this.rows()
    return {
      items: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        label: row.label,
        merchantId: row.merchantId,
        tenantId: row.tenantId,
        secretEnvVar: row.secretEnvVar,
        secretConfigured: Boolean(process.env[row.secretEnvVar]),
        webhookSecretEnvVar: row.webhookSecretEnvVar,
        baseUrl: row.baseUrl,
        enabled: row.enabled,
        isDefault: row.isDefault,
        settings: row.settings,
        source: row.source ?? 'database',
        docsUrl: isProvider(row.provider) ? PROVIDER_DOCS[row.provider] : null,
      })),
      providers: (Object.keys(ADAPTERS) as ProviderCode[]).map((provider) => ({
        value: provider,
        label: PROVIDER_LABELS[provider],
        docsUrl: PROVIDER_DOCS[provider],
        webhookPath: `/api/finance/webhooks/${provider}`,
      })),
      note: 'Каждый филиал хранит свой аккаунт в собственной БД. Секрет задаётся переменной окружения сервера и не сохраняется в базе.',
    }
  }

  async upsertAccount(actor: { userId: string; role: RoleName }, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Платёжные аккаунты настраивает администратор филиала')
    const provider = String(input.provider ?? '')
    if (!isProvider(provider)) throw badRequest('Поддерживаются FreedomPay и Elsom')
    const merchantId = String(input.merchantId ?? '').trim()
    if (!merchantId) throw badRequest('Укажите merchantId / PartnerCode')
    const secretEnvVar = String(input.secretEnvVar ?? (provider === 'freedompay' ? 'FREEDOMPAY_SECRET_KEY' : 'ELSOM_PASSWORD')).trim()
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(secretEnvVar)) throw badRequest('Имя переменной окружения должно быть в формате UPPER_SNAKE_CASE')
    const data = {
      provider,
      label: String(input.label ?? PROVIDER_LABELS[provider]).slice(0, 120),
      merchantId,
      tenantId: input.tenantId ? String(input.tenantId) : null,
      secretEnvVar,
      webhookSecretEnvVar: input.webhookSecretEnvVar ? String(input.webhookSecretEnvVar) : null,
      baseUrl: input.baseUrl ? String(input.baseUrl) : null,
      enabled: input.enabled !== false,
      isDefault: input.isDefault === true,
      settings: (input.settings ?? {}) as Prisma.InputJsonValue,
    }
    const id = input.id ? String(input.id) : null
    const saved = await this.prisma.client.$transaction(async (tx) => {
      if (data.isDefault) await tx.paymentProviderAccount.updateMany({ data: { isDefault: false } })
      if (id) {
        const existing = await tx.paymentProviderAccount.findUnique({ where: { id } })
        if (!existing) throw notFound('Платёжный аккаунт не найден')
        return tx.paymentProviderAccount.update({ where: { id }, data })
      }
      return tx.paymentProviderAccount.create({ data })
    })
    await writeAudit({ actorId: actor.userId, action: 'finance.provider_account.saved', entity: 'PaymentProviderAccount', entityId: saved.id, metadata: { provider, merchantId } })
    return saved
  }

  private async defaultAccount(provider?: ProviderCode): Promise<ProviderAccountRow> {
    const rows = await this.rows()
    const candidates = rows.filter((row) => row.enabled && (!provider || row.provider === provider) && this.configured(row))
    const selected = candidates.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))[0]
    if (!selected) {
      throw new AppError(503, 'ONLINE_PAYMENTS_NOT_CONFIGURED', 'Онлайн-оплата не настроена: добавьте платёжный аккаунт и переменную окружения с секретом.')
    }
    return selected
  }

  async status() {
    const accounts = await this.accounts()
    const configured = accounts.items.filter((item) => item.enabled && item.secretConfigured && item.merchantId)
    return {
      configured: configured.length > 0,
      providers: accounts.items,
      available: accounts.providers,
      note: accounts.note,
    }
  }

  async checkout(invoiceId: string, user: { userId: string; role: RoleName }) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude })
    if (!invoice) throw notFound('Счёт не найден')
    await this.access.assertCanView(invoice.studentId, user)
    if (invoice.status === 'CANCELLED') throw badRequest('Счёт отменён')
    const totals = invoice.payments
      .filter((payment) => payment.status === 'CONFIRMED' || payment.status === 'REFUNDED')
      .reduce((sum, payment) => sum + payment.amount, 0)
    const refunded = invoice.payments.reduce((sum, payment) => sum + payment.refunds.filter((refund) => refund.status === 'APPROVED').reduce((value, refund) => value + refund.amount, 0), 0)
    const remaining = Math.max(0, invoice.amount - totals + refunded)
    if (remaining <= 0) throw badRequest('Счёт уже оплачен')

    const row = await this.defaultAccount()
    const config = this.toConfig(row)
    const adapter = ADAPTERS[config.provider]
    const publicBase = (env.API_PUBLIC_URL ?? env.APP_ORIGIN).replace(/\/$/, '')
    const result = await adapter.createCheckout(config, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: remaining,
      description: invoice.description,
      studentEmail: invoice.student.email,
      studentPhone: invoice.student.phone,
      callbackUrl: `${publicBase}/api/finance/webhooks`,
      returnUrl: `${env.APP_ORIGIN.replace(/\/$/, '')}/payments?invoice=${encodeURIComponent(invoice.id)}`,
    })

    const existingPayment = await this.prisma.client.payment.findUnique({ where: { externalId: result.externalId } })
    if (existingPayment && existingPayment.invoiceId !== invoice.id) {
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Провайдер вернул идентификатор, уже связанный с другим счётом')
    }
    if (existingPayment && (existingPayment.status === 'CONFIRMED' || existingPayment.status === 'REFUNDED')) {
      throw badRequest('Этот платёж уже подтверждён')
    }
    const payment = existingPayment
      ? await this.prisma.client.payment.update({
          where: { id: existingPayment.id },
          data: { amount: remaining, status: 'PENDING', note: `Онлайн-оплата через ${config.label}` },
        })
      : await this.prisma.client.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: remaining,
            method: 'ONLINE',
            status: 'PENDING',
            provider: config.provider,
            externalId: result.externalId,
            registeredById: user.userId,
            note: `Онлайн-оплата через ${config.label}`,
          },
        })
    await writeAudit({ actorId: user.userId, action: 'finance.online.checkout', entity: 'Payment', entityId: payment.id, metadata: { invoiceId: invoice.id, provider: config.provider, amount: remaining } })
    return {
      paymentId: payment.id,
      invoiceId: invoice.id,
      provider: config.provider,
      amount: remaining,
      currency: CURRENCY,
      redirectUrl: result.redirectUrl,
      disclaimer: 'Оплата проходит на стороне платёжного провайдера. Зачисление подтверждается только его уведомлением.',
    }
  }

  async handleWebhook(provider: ProviderCode, rawBody: string, contentType?: string): Promise<{ status: number; contentType: string; body: string }> {
    const rows = (await this.rows()).filter((item) => item.provider === provider && item.enabled && this.configured(item))
    if (rows.length === 0) {
      throw new AppError(503, 'ONLINE_PAYMENTS_NOT_CONFIGURED', 'Платёжный провайдер не настроен')
    }

    // У филиала может быть несколько аккаунтов одного провайдера. FreedomPay
    // не передаёт merchant_id в уведомлении, поэтому выбираем аккаунт по
    // подписи: callback, подписанный секретом другого аккаунта, не должен
    // отклоняться из-за порядка строк в базе.
    const adapter = ADAPTERS[provider]
    let selected: { config: ProviderAccountConfig; event: ProviderWebhookEvent } | null = null
    let signatureError: AppError | null = null
    for (const row of rows) {
      const config = this.toConfig(row)
      try {
        selected = { config, event: await adapter.parseWebhook(config, rawBody, contentType) }
        break
      } catch (error) {
        if (provider === 'freedompay' && error instanceof AppError && error.code === 'INVALID_SIGNATURE') {
          signatureError = error
          continue
        }
        throw error
      }
    }
    if (!selected) throw signatureError ?? new AppError(401, 'INVALID_SIGNATURE', 'Подпись уведомления неверна')

    const { config, event } = selected
    if (event.status === 'SUCCEEDED' && provider === 'elsom') {
      // Elsom не подписывает callback. Перед подтверждением проверяем статус
      // официальным запросом PartnerGetPaymentStatus.
      const verified = await elsomPaymentStatus(config, event.externalId)
      if (verified !== 'A') event.status = verified === '1' ? 'PENDING' : 'FAILED'
    }
    await this.applyEvent(provider, event)
    return adapter.webhookResponse(event)
  }

  private async applyEvent(provider: ProviderCode, event: ProviderWebhookEvent) {
    const existing = await this.prisma.client.payment.findFirst({
      where: { externalId: event.externalId, provider },
      include: { invoice: { select: { id: true, number: true } } },
    })
    const invoice = existing?.invoice ?? (event.invoiceId
      ? await this.prisma.client.invoice.findUnique({ where: { id: event.invoiceId }, select: { id: true, number: true } })
      : provider === 'elsom'
        ? await this.prisma.client.invoice.findUnique({ where: { number: event.externalId }, select: { id: true, number: true } })
        : null)
    if (!invoice) throw notFound('Счёт для уведомления не найден')

    if (event.status === 'FAILED') {
      if (existing && existing.status === 'PENDING') {
        await this.prisma.client.payment.update({ where: { id: existing.id }, data: { status: 'FAILED', note: event.message?.slice(0, 300) ?? 'Провайдер отклонил платёж' } })
      }
      return
    }
    if (event.status !== 'SUCCEEDED') return
    if (existing?.status === 'CONFIRMED' || existing?.status === 'REFUNDED') return

    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`
      const current = await tx.invoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude })
      if (!current) throw notFound('Счёт не найден')
      if (current.status === 'CANCELLED') throw badRequest('Счёт отменён')
      const amount = existing?.amount ?? event.amount
      if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Провайдер не передал сумму платежа')
      if (provider === 'freedompay' && event.amount > 0 && event.amount !== amount) {
        throw badRequest('Сумма уведомления не совпадает с созданным платежом')
      }
      const { totals } = effectiveStatus(current)
      if (amount > totals.remaining) throw badRequest('Сумма платежа превышает остаток по счёту')
      if (existing) {
        await tx.payment.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: null } })
      } else {
        await tx.payment.create({
          data: { invoiceId: current.id, amount, method: 'ONLINE', status: 'CONFIRMED', provider, externalId: event.externalId, confirmedAt: new Date() },
        })
      }
      await recalculateInvoiceStatus(tx, current.id)
      return { amount, invoiceNumber: current.number }
    })
    await notifyInvoiceParties({
      invoiceId: invoice.id,
      type: 'PAYMENT_RECEIVED',
      title: 'Онлайн-платёж зачислен',
      body: `${result.amount} ${CURRENCY} по счёту ${invoice.number}`,
    })
  }
}
