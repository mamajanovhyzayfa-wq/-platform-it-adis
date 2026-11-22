import { Controller, Get, Post } from '@nestjs/common'
import { CurrentUser, type AuthUser } from '../../nest/common/decorators.js'
import { AchievementsService } from './achievements.service.js'

@Controller('api/achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.achievements.list(user.userId)
  }

  @Post('check')
  check(@CurrentUser() user: AuthUser) {
    return this.achievements.check(user.userId)
  }
}
