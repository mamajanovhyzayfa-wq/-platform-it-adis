import { Module } from '@nestjs/common'
import { NotFoundController } from './not-found.controller.js'

/**
 * Модуль-заглушка для 404. Импортируется в AppModule **последним**:
 * Nest регистрирует маршруты в порядке обхода модулей, поэтому этот
 * catch-all не перехватывает реальные эндпоинты.
 */
@Module({
  controllers: [NotFoundController],
})
export class NotFoundModule {}
