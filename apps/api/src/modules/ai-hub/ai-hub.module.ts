import { Module } from '@nestjs/common'
import { AiCenterModule } from '../ai-center/ai-center.module.js'

/** Публичное имя домена AI Hub; реализация — AiCenterModule. */
@Module({
  imports: [AiCenterModule],
  exports: [AiCenterModule],
})
export class AIHubModule {}
