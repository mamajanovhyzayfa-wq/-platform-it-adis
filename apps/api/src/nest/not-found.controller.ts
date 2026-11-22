import { All, Controller, NotFoundException } from '@nestjs/common'
import { Public } from './common/decorators.js'

/**
 * Единый ответ 404 для несуществующих маршрутов.
 *
 * Регистрируется последним, поэтому не перехватывает реальные эндпоинты
 * Nest и Express-слои, подключённые до Nest-роутера.
 */
@Public()
@Controller()
export class NotFoundController {
  @All('*splat')
  notFound(): never {
    throw new NotFoundException('Маршрут не найден')
  }
}
