import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AppConfigModule } from './config/app-config.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { RbacModule } from './rbac/rbac.module.js'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js'
import { RolesGuard } from './common/guards/roles.guard.js'
import { PermissionsGuard } from './common/guards/permissions.guard.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { UsersModule } from './modules/users/users.module.js'
import { CoursesModule } from './modules/courses/courses.module.js'
import { LessonsModule } from './modules/lessons/lessons.module.js'
import { TeacherModule } from './modules/teacher/teacher.module.js'
import { ScheduleModule } from './modules/schedule/schedule.module.js'
import { LeadsModule } from './modules/leads/leads.module.js'
import { ManagerModule } from './modules/manager/manager.module.js'
import { HealthController } from './health.controller.js'
import { NotFoundModule } from './not-found.module.js'

/**
 * Корневой модуль API.
 *
 * Порядок глобальных guard'ов важен:
 * 1. ThrottlerGuard — лимит запросов;
 * 2. JwtAuthGuard — проверка access-токена (всё закрыто, кроме @Public);
 * 3. RolesGuard — RBAC по ролям из токена;
 * 4. PermissionsGuard — тонкие права роли из БД.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    RbacModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    LessonsModule,
    TeacherModule,
    ScheduleModule,
    LeadsModule,
    ManagerModule,
    // Последним: catch-all 404 не должен перехватывать маршруты других модулей.
    NotFoundModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
