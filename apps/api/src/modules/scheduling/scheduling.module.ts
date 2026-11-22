import { Module } from '@nestjs/common'
import { SchedulingController } from './scheduling.controller.js'
import { SchedulingService } from './scheduling.service.js'
import { SchedulingClassroomsService } from './services/scheduling-classrooms.service.js'
import { SchedulingAnalyticsService } from './services/scheduling-analytics.service.js'
import { SchedulingSettingsService } from './services/scheduling-settings.service.js'
import { CalendarService } from './calendar.service.js'
import { VideoService } from './video.service.js'
import { ScheduleChatService } from './schedule-chat.service.js'
import { AiCenterModule } from '../ai-center/ai-center.module.js'

@Module({
  imports: [AiCenterModule],
  controllers: [SchedulingController],
  providers: [
    SchedulingService,
    SchedulingClassroomsService,
    SchedulingAnalyticsService,
    SchedulingSettingsService,
    CalendarService,
    VideoService,
    ScheduleChatService,
  ],
  exports: [
    SchedulingService,
    SchedulingClassroomsService,
    SchedulingAnalyticsService,
    SchedulingSettingsService,
    CalendarService,
    VideoService,
    ScheduleChatService,
  ],
})
export class SchedulingModule {}
