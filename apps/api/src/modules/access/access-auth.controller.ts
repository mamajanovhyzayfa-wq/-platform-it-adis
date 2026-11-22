import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { CurrentUser, Public, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { signStepUpToken } from '../../lib/security.js'
import { badRequest, unauthorized } from '../../lib/errors.js'
import {
  oauthSchema,
  passwordRecoveryConfirmSchema,
  passwordRecoveryRequestSchema,
  stepUpSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorVerifySchema,
} from '../../modules/access/access.schemas.js'
import { AccessService } from './access.service.js'
import { OAuthService } from './oauth.service.js'

function metaOf(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  }
}

/** Дополнительные маршруты аутентификации: 2FA, step-up, восстановление, OAuth. */
@Controller('api/auth')
export class AccessAuthController {
  constructor(
    private readonly access: AccessService,
    private readonly oauth: OAuthService,
  ) {}

  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.access.setupTwoFactor(user.userId)
  }

  @HttpCode(200)
  @Post('2fa/enable')
  enableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(twoFactorEnableSchema)) body: { password: string; code: string },
  ) {
    return this.access.enableTwoFactor(user.userId, body.password, body.code)
  }

  @HttpCode(204)
  @Post('2fa/disable')
  async disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(twoFactorDisableSchema)) body: { password: string },
  ): Promise<void> {
    await this.access.disableTwoFactor(user.userId, body.password)
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @HttpCode(200)
  @Post('2fa/verify')
  verifyTwoFactor(
    @Body(zodBody(twoFactorVerifySchema))
    body: { challengeToken: string; code: string; deviceId?: string; platform?: string },
    @Req() req: Request,
  ) {
    return this.access.verifyTwoFactor(body.challengeToken, body.code, {
      ...metaOf(req),
      deviceId: body.deviceId,
      platform: body.platform,
    })
  }

  /** Повторный ввод пароля перед важной операцией. Требует действующей сессии. */
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @HttpCode(200)
  @Post('step-up')
  async stepUp(@Body(zodBody(stepUpSchema)) body: { password: string }, @Req() req: Request) {
    const request = req as Request & { user?: AuthUser }
    if (!request.user) throw unauthorized()
    await this.access.stepUp(request.user.userId, body.password)
    return { stepUpToken: signStepUpToken(request.user.userId), expiresInSeconds: 600 }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @HttpCode(202)
  @Post('password/request')
  requestRecovery(
    @Body(zodBody(passwordRecoveryRequestSchema)) body: { identifier: string },
    @Req() req: Request,
  ) {
    return this.access.requestPasswordRecovery(body.identifier, metaOf(req))
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @HttpCode(204)
  @Post('password/confirm')
  async confirmRecovery(
    @Body(zodBody(passwordRecoveryConfirmSchema))
    body: { identifier: string; code: string; password: string; passwordRepeat: string },
  ): Promise<void> {
    await this.access.confirmPasswordRecovery(body.identifier, body.code, body.password)
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @HttpCode(200)
  @Post('oauth/:provider')
  oauthLogin(
    @Param('provider') provider: string,
    @Body(zodBody(oauthSchema)) body: { idToken: string; deviceId?: string; platform?: string },
    @Req() req: Request,
  ) {
    if (provider !== 'google' && provider !== 'apple') throw badRequest('Неизвестный провайдер входа')
    return this.oauth.login(provider, body.idToken, {
      ...metaOf(req),
      deviceId: body.deviceId,
      platform: body.platform,
    })
  }
}
