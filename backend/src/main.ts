import 'reflect-metadata'
import express from 'express'
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
import { errorHandler } from './lib/errors.js'
import { prisma } from './lib/prisma.js'
import { legacyMounts } from './legacy-routers.js'
import { videoWebhookRouter } from './modules/video/video.routes.js'
import { uploadsDir } from './modules/uploads/uploads.routes.js'
import { startLessonReminderLoop } from './modules/schedule/reminders.js'
import { openApiDocument } from './docs/openapi.js'
import { closeRealtime, initRealtime } from './realtime.js'

const logger = new Logger('Bootstrap')

async function bootstrap(): Promise<void> {
  // bodyParser отключён: вебхукам LiveKit нужно сырое тело до express.json.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })

  // cross-origin нужен, чтобы вложения из /uploads открывались в мобильном приложении и панели.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors({ origin: env.APP_ORIGIN, credentials: true }))
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', index: false, fallthrough: false }))
  app.use('/api/video/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), videoWebhookRouter)
  app.use(express.json({ limit: '1mb' }))
  if (env.NODE_ENV !== 'test') app.use(morgan('tiny'))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

  // Модули, ещё не перенесённые в Nest: тот же сервер, тот же пул БД.
  // Каждый монтируется со своим обработчиком ошибок, чтобы 500 не проваливался в Nest.
  for (const { prefix, router } of legacyMounts) {
    app.use(prefix, router, errorHandler)
  }

  app.useGlobalFilters(new AllExceptionsFilter())
  app.enableShutdownHooks()

  await app.listen(env.PORT)
  const server = app.getHttpServer()
  initRealtime(server)

  // Напоминания о занятиях: цикл живёт в процессе API и останавливается при shutdown.
  const stopReminders = startLessonReminderLoop()

  logger.log(`ITadis API: http://localhost:${env.PORT} (Swagger: /docs, health: /healthz)`)

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Получен ${signal}, завершаем работу`)
    stopReminders()
    closeRealtime()
    await app.close()
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
