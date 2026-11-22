import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { NotificationsService } from './notifications.service.js'
import {
  notificationListQuerySchema,
  notificationPreferenceSchema,
  type NotificationPreferenceInput,
} from './notifications.schemas.js'

@Controller('api/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(zodBody(notificationListQuerySchema)) query: { limit: number; offset: number },
  ) {
    return this.notifications.list(user.userId, query.limit, query.offset)
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.preferences(user.userId)
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(notificationPreferenceSchema)) body: NotificationPreferenceInput,
  ) {
    return this.notifications.updatePreferences(user.userId, body)
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.readAll(user.userId)
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(id, user.userId)
  }

  @Roles('ADMIN')
  @Post('digest/run')
  runDigest(@CurrentUser() user: AuthUser) {
    return this.notifications.runDigest(user.userId)
  }
}
