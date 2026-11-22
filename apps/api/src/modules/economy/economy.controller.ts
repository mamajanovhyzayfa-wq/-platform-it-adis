import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { EconomyService } from './economy.service.js'
import {
  achievementSchema, appealReviewSchema, appealSchema, awardSchema, orderSchema, orderUpdateSchema,
  penaltySchema, productSchema, productUpdateSchema, rulesSchema,
} from './economy.schemas.js'

const toInt = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

/** Единый API IT Coins для ученика, наставника, родителя и администратора филиала. */
@Controller('api/economy')
export class EconomyController {
  constructor(@Inject(EconomyService) private readonly economy: EconomyService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.economy.overview(user.userId, user.role)
  }

  @Get('transactions')
  transactions(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.economy.transactions(user.userId, user.role, {
      page: toInt(page, 1), limit: toInt(limit, 20),
      sourceType: sourceType as never, status: status as never, from, to, search,
    })
  }

  @Roles('ADMIN', 'MANAGER')
  @Get('pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.economy.pending(user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('awards')
  award(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(awardSchema)) body: z.infer<typeof awardSchema>,
  ) {
    return this.economy.award(user, {
      userId: body.userId, amount: body.amount, reason: body.reason,
      sourceType: body.sourceType as never, sourceId: body.sourceId,
    })
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('transactions/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.economy.approve(id, user)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('transactions/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.economy.reject(id, user)
  }

  @Roles('ADMIN')
  @Post('transactions/:id/reverse')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.economy.reverse(id, user)
  }

  @Roles('ADMIN')
  @Post('penalties')
  penalty(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(penaltySchema)) body: z.infer<typeof penaltySchema>,
  ) {
    return this.economy.penalty(user, body)
  }

  @Post('transactions/:id/appeal')
  appeal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(appealSchema)) body: z.infer<typeof appealSchema>,
  ) {
    return this.economy.appeal(id, user.userId, body.reason)
  }

  @Roles('ADMIN', 'MANAGER')
  @Get('appeals')
  appeals(@CurrentUser() user: AuthUser) {
    return this.economy.appeals(user.role)
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('appeals/:id/review')
  reviewAppeal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(appealReviewSchema)) body: z.infer<typeof appealReviewSchema>,
  ) {
    return this.economy.reviewAppeal(id, user, body)
  }

  @Roles('ADMIN', 'MANAGER')
  @Get('rules')
  rules() {
    return this.economy.rules()
  }

  @Roles('ADMIN')
  @Patch('rules')
  updateRules(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(rulesSchema)) body: z.infer<typeof rulesSchema>,
  ) {
    return this.economy.updateRules(body, user.userId)
  }

  @Get('levels')
  levels() {
    // Уровни публичны для всех авторизованных ролей: это ориентир прогресса, а не рейтинг.
    return this.economy.levels()
  }

  @Get('achievements')
  achievements(@CurrentUser() user: AuthUser) {
    return this.economy.achievements(user.userId)
  }

  @Post('achievements/check')
  checkAchievements(@CurrentUser() user: AuthUser) {
    return this.economy.checkAchievements(user.userId)
  }

  @Roles('ADMIN')
  @Post('achievements')
  createAchievement(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(achievementSchema)) body: z.infer<typeof achievementSchema>,
  ) {
    return this.economy.createAchievement(user, body)
  }

  @Get('quests')
  quests(@CurrentUser() user: AuthUser) {
    return this.economy.quests(user.userId)
  }

  @Post('quests/:id/claim')
  claimQuest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.economy.claimQuest(id, user.userId)
  }

  @Get('season')
  season(@CurrentUser() user: AuthUser) {
    return this.economy.season(user.userId)
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() user: AuthUser, @Query('courseId') courseId?: string) {
    return this.economy.leaderboard(user.userId, user.role, courseId)
  }

  @Roles('PARENT')
  @Get('parent/:studentId')
  parentView(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.economy.parentView(user.userId, studentId, { page: toInt(page, 1), limit: toInt(limit, 25) })
  }

  @Get('shop/products')
  products(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('favorite') favorite?: string,
  ) {
    return this.economy.shopProducts(user.userId, { search, category, favorite: favorite === 'true' }, user.role)
  }

  @Post('shop/products/:id/favorite')
  favorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.economy.toggleFavorite(user.userId, id)
  }

  @Roles('ADMIN')
  @Post('shop/products')
  createProduct(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(productSchema)) body: z.infer<typeof productSchema>,
  ) {
    return this.economy.createProduct(user, body)
  }

  @Roles('ADMIN')
  @Patch('shop/products/:id')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(productUpdateSchema)) body: z.infer<typeof productUpdateSchema>,
  ) {
    return this.economy.updateProduct(user, id, body)
  }

  @Get('shop/orders')
  orders(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.economy.orders(user.userId, user.role, {
      status: status as never, page: toInt(page, 1), limit: toInt(limit, 20),
    })
  }

  @Roles('TEACHER', 'STUDENT')
  @Post('shop/orders')
  createOrder(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(orderSchema)) body: z.infer<typeof orderSchema>,
  ) {
    return this.economy.createOrder(user.userId, user.role, body)
  }

  @Roles('ADMIN', 'MANAGER')
  @Patch('shop/orders/:id')
  updateOrder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(orderUpdateSchema)) body: z.infer<typeof orderUpdateSchema>,
  ) {
    return this.economy.updateOrder(user, id, body)
  }
}
