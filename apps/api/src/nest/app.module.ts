import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AppConfigModule } from './config/app-config.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { RbacModule } from './rbac/rbac.module.js'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js'
import { RolesGuard } from './common/guards/roles.guard.js'
import { PermissionsGuard } from './common/guards/permissions.guard.js'
import { StepUpGuard } from './common/guards/step-up.guard.js'
import { AuthModule } from '../modules/auth/auth.module.js'
import { AccessModule } from '../modules/access/access.module.js'
import { PortalModule } from '../modules/portal/portal.module.js'
import { LmsModule } from '../modules/lms/lms.module.js'
import { AssessmentModule } from '../modules/assessment/assessment.module.js'
import { HomeworkModule } from '../modules/homework/homework.module.js'
import { TestsModule } from '../modules/tests/tests.module.js'
import { SchedulingModule } from '../modules/scheduling/scheduling.module.js'
import { UsersModule } from '../modules/users/users.module.js'
import { BranchesModule } from '../modules/branches/branches.module.js'
import { RolesModule } from '../modules/roles/roles.module.js'
import { CoursesModule } from '../modules/courses/courses.module.js'
import { LessonsModule } from '../modules/lessons/lessons.module.js'
import { TeacherModule } from '../modules/teacher/teacher.module.js'
import { ScheduleModule } from '../modules/schedule/schedule.module.js'
import { LeadsModule } from '../modules/leads/leads.module.js'
import { ManagerModule } from '../modules/manager/manager.module.js'
import { FinanceModule } from '../modules/finance/finance.module.js'
import { AnalyticsCenterModule } from '../modules/analytics-center/analytics-center.module.js'
import { AnalyticsModule } from '../modules/analytics/analytics.module.js'
import { CertificatesModule } from '../modules/certificates/certificates.module.js'
import { AchievementsModule } from '../modules/achievements/achievements.module.js'
import { EconomyModule } from '../modules/economy/economy.module.js'
import { AiCenterModule } from '../modules/ai-center/ai-center.module.js'
import { AIHubModule } from '../modules/ai-hub/ai-hub.module.js'
import { PlatformModule } from '../modules/platform/platform.module.js'
import { StudentsModule } from '../modules/students/students.module.js'
import { MentorsModule } from '../modules/mentors/mentors.module.js'
import { ManagersModule } from '../modules/managers/managers.module.js'
import { ParentsModule } from '../modules/parents/parents.module.js'
import { GroupsModule } from '../modules/groups/groups.module.js'
import { MaterialsModule } from '../modules/materials/materials.module.js'
import { ExamsModule } from '../modules/exams/exams.module.js'
import { ClassroomsModule } from '../modules/classrooms/classrooms.module.js'
import { AttendanceModule } from '../modules/attendance/attendance.module.js'
import { LiveDigitalModule } from '../modules/live-digital/live-digital.module.js'
import { AiAutomationModule } from '../modules/ai-automation/ai-automation.module.js'
import { ItCoinsModule } from '../modules/it-coins/it-coins.module.js'
import { RewardsStoreModule } from '../modules/rewards-store/rewards-store.module.js'
import { CompetitionsModule } from '../modules/competitions/competitions.module.js'
import { PaymentsModule } from '../modules/payments/payments.module.js'
import { InvoicesModule } from '../modules/invoices/invoices.module.js'
import { ExpensesModule } from '../modules/expenses/expenses.module.js'
import { MessagingModule } from '../modules/messaging/messaging.module.js'
import { AuditModule } from '../modules/audit/audit.module.js'
import { NotificationsModule } from '../modules/notifications/notifications.module.js'
import { FilesModule } from '../modules/files/files.module.js'
import { BackupModule } from '../modules/backups/backup.module.js'
import { ConsentModule } from '../modules/consent/consent.module.js'
import { CookieModule } from '../modules/cookie/cookie.module.js'
import { SupportModule } from '../modules/support/support.module.js'
import { ReportsModule } from '../modules/reports/reports.module.js'
import { IntegrationsModule } from '../modules/integrations/integrations.module.js'
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
    AccessModule,
    PortalModule,
    LmsModule,
    AssessmentModule,
    HomeworkModule,
    TestsModule,
    SchedulingModule,
    UsersModule,
    BranchesModule,
    RolesModule,
    CoursesModule,
    LessonsModule,
    TeacherModule,
    ScheduleModule,
    LeadsModule,
    ManagerModule,
    FinanceModule,
    AnalyticsCenterModule,
    AnalyticsModule,
    CertificatesModule,
    AchievementsModule,
    EconomyModule,
    AiCenterModule,
    AIHubModule,
    PlatformModule,
    StudentsModule,
    MentorsModule,
    ManagersModule,
    ParentsModule,
    GroupsModule,
    MaterialsModule,
    ExamsModule,
    ClassroomsModule,
    AttendanceModule,
    LiveDigitalModule,
    AiAutomationModule,
    ItCoinsModule,
    RewardsStoreModule,
    CompetitionsModule,
    PaymentsModule,
    InvoicesModule,
    ExpensesModule,
    MessagingModule,
    AuditModule,
    NotificationsModule,
    FilesModule,
    BackupModule,
    ConsentModule,
    CookieModule,
    SupportModule,
    ReportsModule,
    IntegrationsModule,
    // Последним: catch-all 404 не должен перехватывать маршруты других модулей.
    NotFoundModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
})
export class AppModule {}
