import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { Public, CurrentUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  type LoginInput,
} from '../../modules/auth/auth.schemas.js'
import { AuthService, type RequestMeta } from './auth.service.js'
import { createCaptcha } from '../../lib/captcha.js'

/** Метаданные запроса для аудита и привязки устройства. */
function metaOf(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  }
}

/**
 * Аутентификация. Лимит попыток: 20 запросов за 15 минут с одного IP
 * на вход, регистрацию и восстановление пароля.
 */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** CAPTCHA запрашивается клиентом после серии неудачных попыток. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @Get('captcha')
  captcha() {
    return createCaptcha()
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(zodBody(loginSchema)) body: LoginInput, @Req() req: Request) {
    return this.auth.login(body, { ...metaOf(req), deviceId: body.deviceId, platform: body.platform })
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body(zodBody(refreshSchema)) body: { refreshToken: string }, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, metaOf(req))
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body(zodBody(refreshSchema)) body: { refreshToken: string }, @Req() req: Request): Promise<void> {
    await this.auth.logout(body.refreshToken, metaOf(req))
  }

  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: { userId: string }): Promise<void> {
    await this.auth.logoutAll(user.userId)
  }

  /** Активные сессии: пользователь может завершить подозрительную сессию. */
  @Get('sessions')
  sessions(@CurrentUser() user: { userId: string }) {
    return this.auth.listSessions(user.userId)
  }

  @HttpCode(204)
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.revokeSession(user.userId, id, metaOf(req))
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body(zodBody(forgotPasswordSchema)) body: { email: string }): Promise<{ message: string }> {
    await this.auth.forgotPassword(body.email)
    return { message: 'Если аккаунт существует, письмо со ссылкой отправлено' }
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body(zodBody(resetPasswordSchema)) body: { token: string; password: string }): Promise<void> {
    await this.auth.resetPassword(body.token, body.password)
  }
}
