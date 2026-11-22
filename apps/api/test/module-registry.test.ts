import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { MODULE_METADATA } from '@nestjs/common/constants.js'
import { AppModule } from '../src/nest/app.module.js'
import { AuthModule } from '../src/modules/auth/auth.module.js'
import { UsersModule } from '../src/modules/users/users.module.js'
import { RolesModule } from '../src/modules/roles/roles.module.js'
import { BranchesModule } from '../src/modules/branches/branches.module.js'
import { StudentsModule } from '../src/modules/students/students.module.js'
import { MentorsModule } from '../src/modules/mentors/mentors.module.js'
import { ManagersModule } from '../src/modules/managers/managers.module.js'
import { ParentsModule } from '../src/modules/parents/parents.module.js'
import { GroupsModule } from '../src/modules/groups/groups.module.js'
import { CoursesModule } from '../src/modules/courses/courses.module.js'
import { LessonsModule } from '../src/modules/lessons/lessons.module.js'
import { MaterialsModule } from '../src/modules/materials/materials.module.js'
import { HomeworkModule } from '../src/modules/homework/homework.module.js'
import { TestsModule } from '../src/modules/tests/tests.module.js'
import { ExamsModule } from '../src/modules/exams/exams.module.js'
import { ScheduleModule } from '../src/modules/schedule/schedule.module.js'
import { ClassroomsModule } from '../src/modules/classrooms/classrooms.module.js'
import { AttendanceModule } from '../src/modules/attendance/attendance.module.js'
import { LiveDigitalModule } from '../src/modules/live-digital/live-digital.module.js'
import { AIHubModule } from '../src/modules/ai-hub/ai-hub.module.js'
import { AIAutomationModule } from '../src/modules/ai-automation/ai-automation.module.js'
import { ITCoinsModule } from '../src/modules/it-coins/it-coins.module.js'
import { RewardsStoreModule } from '../src/modules/rewards-store/rewards-store.module.js'
import { AchievementsModule } from '../src/modules/achievements/achievements.module.js'
import { CompetitionsModule } from '../src/modules/competitions/competitions.module.js'
import { PaymentsModule } from '../src/modules/payments/payments.module.js'
import { FinanceModule } from '../src/modules/finance/finance.module.js'
import { InvoicesModule } from '../src/modules/invoices/invoices.module.js'
import { ExpensesModule } from '../src/modules/expenses/expenses.module.js'
import { MessagingModule } from '../src/modules/messaging/messaging.module.js'
import { NotificationsModule } from '../src/modules/notifications/notifications.module.js'
import { CertificatesModule } from '../src/modules/certificates/certificates.module.js'
import { AnalyticsModule } from '../src/modules/analytics/analytics.module.js'
import { FilesModule } from '../src/modules/files/files.module.js'
import { AuditModule } from '../src/modules/audit/audit.module.js'
import { ConsentModule } from '../src/modules/consent/consent.module.js'
import { CookieModule } from '../src/modules/cookie/cookie.module.js'
import { SupportModule } from '../src/modules/support/support.module.js'
import { ReportsModule } from '../src/modules/reports/reports.module.js'
import { BackupModule } from '../src/modules/backups/backup.module.js'
import { IntegrationsModule } from '../src/modules/integrations/integrations.module.js'

const required = [
  ['AuthModule', AuthModule],
  ['UsersModule', UsersModule],
  ['RolesModule', RolesModule],
  ['BranchesModule', BranchesModule],
  ['StudentsModule', StudentsModule],
  ['MentorsModule', MentorsModule],
  ['ManagersModule', ManagersModule],
  ['ParentsModule', ParentsModule],
  ['GroupsModule', GroupsModule],
  ['CoursesModule', CoursesModule],
  ['LessonsModule', LessonsModule],
  ['MaterialsModule', MaterialsModule],
  ['HomeworkModule', HomeworkModule],
  ['TestsModule', TestsModule],
  ['ExamsModule', ExamsModule],
  ['ScheduleModule', ScheduleModule],
  ['ClassroomsModule', ClassroomsModule],
  ['AttendanceModule', AttendanceModule],
  ['LiveDigitalModule', LiveDigitalModule],
  ['AIHubModule', AIHubModule],
  ['AIAutomationModule', AIAutomationModule],
  ['ITCoinsModule', ITCoinsModule],
  ['RewardsStoreModule', RewardsStoreModule],
  ['AchievementsModule', AchievementsModule],
  ['CompetitionsModule', CompetitionsModule],
  ['PaymentsModule', PaymentsModule],
  ['FinanceModule', FinanceModule],
  ['InvoicesModule', InvoicesModule],
  ['ExpensesModule', ExpensesModule],
  ['MessagingModule', MessagingModule],
  ['NotificationsModule', NotificationsModule],
  ['CertificatesModule', CertificatesModule],
  ['AnalyticsModule', AnalyticsModule],
  ['FilesModule', FilesModule],
  ['AuditModule', AuditModule],
  ['ConsentModule', ConsentModule],
  ['CookieModule', CookieModule],
  ['SupportModule', SupportModule],
  ['ReportsModule', ReportsModule],
  ['BackupModule', BackupModule],
  ['IntegrationsModule', IntegrationsModule],
] as const

describe('реестр backend-модулей', () => {
  it('содержит все 41 модуль из ТЗ', () => {
    expect(required).toHaveLength(41)
    expect(new Set(required.map(([name]) => name)).size).toBe(41)
    for (const [name, moduleClass] of required) expect(moduleClass.name, name).toBe(name)
  })

  it('подключает обязательные модули в AppModule', () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? []) as unknown[]
    for (const [name, moduleClass] of required) expect(imports, name).toContain(moduleClass)
  })
})
