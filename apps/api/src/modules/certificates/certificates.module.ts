import { Module } from '@nestjs/common'
import { CertificatesController } from './certificates.controller.js'
import { CertificatesService } from './certificates.service.js'

/** Сертификаты об окончании курсов: выдача, проверка по коду, отзыв. */
@Module({
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
