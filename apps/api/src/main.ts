import 'reflect-metadata'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import swaggerUi from 'swagger-ui-express'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from '@nestjs/common'
import { AppModule } from './nest/app.module.js'
import { AllExceptionsFilter } from './nest/common/all-exceptions.filter.js'
import { env } from './config/env.js'
import { errorHandler, isJsonSyntaxError, sendJsonParseError } from './lib/errors.js'
import { prisma } from './lib/prisma.js'
import { controlPrisma } from './lib/control-prisma.js'
import { disconnectBranchClients } from './lib/tenant.js'
import { tenantMiddleware, tenantUploadsStatic } from './lib/tenant.middleware.js'
import { legacyMounts } from './legacy-routers.js'
import { liveDigitalWebhookRouter } from './modules/scheduling/livedigital.webhook.js'
import { financeWebhookRouter } from './modules/finance/finance.webhook.js'
import { startLessonReminderLoop } from './modules/schedule/reminders.js'
import { startHomeworkReminderLoop } from './modules/assessment/homework-reminders.js'
import { startPaymentDueReminderLoop } from './modules/finance/finance.reminders.js'
import { startNotificationDigestLoop } from './jobs/notification-digest.js'
import { openApiDocument } from './docs/openapi.js'
import { closeRealtime, initRealtime } from './websocket/realtime.js'
import { metricsMiddleware, renderMetrics } from './lib/metrics.js'
import { rejectNulBytes } from './lib/input-guard.js'
import { startBackupScheduler } from './modules/backups/backup.service.js'
import { ensurePrimaryBranch } from './lib/primary-branch.js'

const logger = new Logger('Bootstrap')

async function bootstrap(): Promise<void> {
  // bodyParser отключён: вебхукам LiveDigital нужно сырое тело до express.json.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })

  // req.ip и req.protocol берутся из X-Forwarded-* только если явно указано,
  // сколько прокси перед приложением доверять. Без этого лимит запросов был
  // общим на всех клиентов (они виделись адресом контейнера nginx), а ссылки на
  // вложения собирались со схемой http за TLS-терминатором.
  if (env.TRUST_PROXY_HOPS > 0) app.set('trust proxy', env.TRUST_PROXY_HOPS)

  // cross-origin нужен, чтобы вложения из /uploads открывались в мобильном приложении и панели.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors({ origin: env.APP_ORIGIN, credentials: true }))
  app.use(metricsMiddleware)
  // Документация и метрики раскрывают карту API и нагрузку без авторизации,
  // поэтому в production они не монтируются вовсе.
  const exposeDiagnostics = env.NODE_ENV !== 'production'
  if (exposeDiagnostics) {
    // Scrape endpoint для Prometheus; не содержит персональных данных.
    app.use('/metrics', (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') {
        next()
        return
      }
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      res.send(renderMetrics())
    })
  }
  // Филиал выбирается по Host до любых обработчиков: БД, файлы и токены — филиальные.
  app.use(tenantMiddleware)
  app.use('/uploads', tenantUploadsStatic)
  // LiveDigital подписывает вебхук по сырому телу — до express.json.
  app.use('/api/scheduling/livedigital', express.raw({ type: 'application/json', limit: '1mb' }), liveDigitalWebhookRouter)
  // Подпись платёжного вебхука считается по сырому телу — до express.json.
  // FreedomPay присылает application/x-www-form-urlencoded, Elsom — JSON.
  app.use(
    '/api/finance/webhooks',
    express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'], limit: '256kb' }),
    financeWebhookRouter,
  )
  app.use(express.json({ limit: '1mb' }))
  // Битый JSON от body-parser: 400 с общим текстом, без деталей парсера.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (isJsonSyntaxError(error)) {
      sendJsonParseError(res)
      return
    }
    next(error)
  })
  // NUL-байт в любом поле давал 500 от PostgreSQL, а не 400: отклоняем до маршрутов.
  app.use(rejectNulBytes)
  if (env.NODE_ENV !== 'test') {
    // IP клиента обязателен: без него по строке 5xx не понять, чей запрос упал
    // (за обратным прокси все клиенты выглядели бы адресом контейнера).
    app.use(morgan(':remote-addr :method :url :status :res[content-length] - :response-time ms'))
  }
  if (exposeDiagnostics) app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

  // Модули, ещё не перенесённые в Nest: тот же сервер, тот же пул БД.
  // Каждый монтируется со своим обработчиком ошибок, чтобы 500 не проваливался в Nest.
  for (const { prefix, router } of legacyMounts) {
    app.use(prefix, router, errorHandler)
  }

  app.useGlobalFilters(new AllExceptionsFilter())
  app.enableShutdownHooks()

  // До первого запроса привязываем основной филиал к production-домену.
  await ensurePrimaryBranch()

  await app.listen(env.PORT)
  const server = app.getHttpServer()
  initRealtime(server)

  // Напоминания о занятиях: цикл живёт в процессе API и останавливается при shutdown.
  const stopReminders = startLessonReminderLoop()
  const stopHomeworkReminders = startHomeworkReminderLoop()
  const stopPaymentReminders = startPaymentDueReminderLoop()
  const stopDigests = startNotificationDigestLoop()
  const stopBackups = startBackupScheduler()

  logger.log(
    `ITadis API: http://localhost:${env.PORT} (health: /healthz${exposeDiagnostics ? ', Swagger: /docs' : ''})`,
  )

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Получен ${signal}, завершаем работу`)
    stopReminders()
    stopHomeworkReminders()
    stopPaymentReminders()
    stopDigests()
    stopBackups()
    closeRealtime()
    await app.close()
    await disconnectBranchClients()
    await controlPrisma.$disconnect()
    await prisma.$disconnect()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void bootstrap().catch((error: unknown) => {
  logger.error('Не удалось запустить приложение', error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
