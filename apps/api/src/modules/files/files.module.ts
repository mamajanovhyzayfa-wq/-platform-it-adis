import { Module } from '@nestjs/common'

/**
 * Файловая библиотека. Пока используется legacy Express-роутер из-за
 * multipart/stream-контракта; модуль фиксирует границу домена и будет
 * подключён к Nest-контроллеру при поэтапном переносе.
 */
@Module({})
export class FilesModule {}
