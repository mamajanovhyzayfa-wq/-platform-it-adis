import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AccessController } from './access.controller.js'
import { AccessAuthController } from './access-auth.controller.js'
import { AccessService } from './access.service.js'
import { OAuthService } from './oauth.service.js'

@Module({
  imports: [AuthModule],
  controllers: [AccessController, AccessAuthController],
  providers: [AccessService, OAuthService],
  exports: [AccessService],
})
export class AccessModule {}
