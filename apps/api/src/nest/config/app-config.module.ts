import { Global, Module } from '@nestjs/common'
import { env } from '../../config/env.js'

/** Токен для внедрения провалидированной конфигурации. */
export const APP_ENV = Symbol('APP_ENV')

/**
 * Конфигурация уже проверена zod в config/env.ts при импорте: приложение не
 * стартует с неверными переменными окружения. Модуль лишь публикует её для DI.
 */
@Global()
@Module({
  providers: [{ provide: APP_ENV, useValue: env }],
  exports: [APP_ENV],
})
export class AppConfigModule {}

