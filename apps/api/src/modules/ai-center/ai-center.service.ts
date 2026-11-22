import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { Prisma, RoleName } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { env } from '../../config/env.js'

type Source = { title: string; url?: string | null; kind: 'COURSE' | 'LESSON' | 'MATERIAL' | 'DOCUMENT' | 'PLATFORM' | 'EXTERNAL' | 'MODEL'; note?: string }
type Tool = { id: string; title: string; description: string; group: string; icon: string; requiresProvider?: boolean }
type AiInput = {
  feature: string
  message?: string
  courseId?: string
  studentId?: string
  homeworkId?: string
  submissionId?: string
  leadId?: string
  language?: string
  externalUrls?: string[]
  conversationId?: string
  voice?: boolean
}
type Limits = { dailyRequests: number; monthlyTokens: number; allowedFeatures: string[]; model: string; enabled: boolean; allowExternalSources: boolean }
type AiContext = { facts: string[]; sources: Source[]; metrics: Record<string, unknown> }
type Actor = { userId: string; role: RoleName }
type Generated = { answer: string; assumptions: string[]; confidence: number; tokens?: number }

const DISCLAIMER = 'Ответ сгенерирован AI-инструментом ITadis. Проверяйте важные сведения: AI может ошибаться, не заменяет преподавателя и не выставляет официальные оценки.'
const LOCAL_DISCLAIMER = 'Ответ сформирован локальным аналитическим помощником без генеративной модели. Это не заключение преподавателя.'
const PROVIDER_REQUIRED = new Set([
  'teacher.test_generation',
  'teacher.homework_generation',
  'teacher.lesson_plan',
  'teacher.material',
  'teacher.homework_review',
])

const TOOL_CATALOG: Record<RoleName, Tool[]> = {
  STUDENT: [
    { id: 'student.explain', title: 'Объяснить тему', description: 'Разбор темы по материалам курса, без готового решения задания.', group: 'Учёба', icon: 'book' },
    { id: 'student.homework_help', title: 'Помощь с заданием', description: 'План выполнения и подсказки к текущему заданию.', group: 'Учёба', icon: 'check' },
    { id: 'student.error_analysis', title: 'Анализ ошибок', description: 'Почему возникли ошибки и что повторить.', group: 'Учёба', icon: 'search' },
    { id: 'student.recommendations', title: 'Рекомендации', description: 'Следующие шаги на основе прогресса и активности.', group: 'План', icon: 'spark' },
    { id: 'student.study_plan', title: 'Учебный план', description: 'Персональный план на ближайшую неделю.', group: 'План', icon: 'calendar' },
    { id: 'student.adapt', title: 'Адаптация сложности', description: 'Подходящий уровень заданий и темп.', group: 'План', icon: 'grid' },
    { id: 'student.course_qa', title: 'Вопрос по материалам', description: 'Ответ со ссылками на уроки и материалы курса.', group: 'Источники', icon: 'book' },
    { id: 'student.chat', title: 'Учебный диалог', description: 'Вопросы по учёбе и разбор затруднений.', group: 'Диалог', icon: 'message' },
  ],
  TEACHER: [
    { id: 'teacher.test_generation', title: 'Генерация теста', description: 'Черновик теста с вопросами по теме курса.', group: 'Материалы', icon: 'book', requiresProvider: true },
    { id: 'teacher.homework_generation', title: 'Генерация задания', description: 'Черновик практического задания и критериев.', group: 'Материалы', icon: 'check', requiresProvider: true },
    { id: 'teacher.lesson_plan', title: 'Подготовка урока', description: 'План занятия с целями, этапами и вопросами.', group: 'Материалы', icon: 'calendar', requiresProvider: true },
    { id: 'teacher.material', title: 'Учебный материал', description: 'Черновик конспекта или памятки для учеников.', group: 'Материалы', icon: 'book', requiresProvider: true },
    { id: 'teacher.homework_review', title: 'Предварительная проверка', description: 'Структурированный разбор сданной работы.', group: 'Проверка', icon: 'check', requiresProvider: true },
    { id: 'teacher.error_analysis', title: 'Анализ ошибок', description: 'Типичные ошибки ученика или группы.', group: 'Проверка', icon: 'search' },
    { id: 'teacher.student_recommendations', title: 'Рекомендации ученику', description: 'Что делать конкретному ученику дальше.', group: 'Ученики', icon: 'users' },
    { id: 'teacher.study_plan', title: 'Индивидуальный план', description: 'План для ученика с учётом его результатов.', group: 'Ученики', icon: 'calendar' },
    { id: 'teacher.group_analysis', title: 'Анализ группы', description: 'Успеваемость, посещаемость и вовлечённость группы.', group: 'Группа', icon: 'users' },
    { id: 'teacher.report', title: 'Отчёт по группе', description: 'Готовый черновик отчёта для методиста.', group: 'Группа', icon: 'book' },
    { id: 'teacher.chat', title: 'AI-диалог наставника', description: 'Вопросы по методике, группе и проверке.', group: 'Диалог', icon: 'message' },
  ],
  MANAGER: [
    { id: 'manager.attendance', title: 'Посещаемость', description: 'Динамика посещаемости и проблемные группы.', group: 'Аналитика', icon: 'calendar' },
    { id: 'manager.performance', title: 'Успеваемость', description: 'Средние результаты, динамика и риски.', group: 'Аналитика', icon: 'spark' },
    { id: 'manager.group_efficiency', title: 'Эффективность групп', description: 'Сравнение групп по прогрессу и активности.', group: 'Группы', icon: 'users' },
    { id: 'manager.teacher_efficiency', title: 'Эффективность наставников', description: 'Нагрузка, проверки и результаты учеников.', group: 'Команда', icon: 'users' },
    { id: 'manager.report', title: 'Отчёт филиала', description: 'Черновик отчёта по операционным показателям.', group: 'Отчёты', icon: 'book' },
    { id: 'manager.risk', title: 'Прогноз рисков', description: 'Ученики и группы, требующие внимания.', group: 'Риски', icon: 'shield' },
    { id: 'manager.resources', title: 'Распределение ресурсов', description: 'Где не хватает наставников и внимания.', group: 'Ресурсы', icon: 'grid' },
    { id: 'manager.chat', title: 'AI-диалог менеджера', description: 'Вопросы по операционным данным филиала.', group: 'Диалог', icon: 'message' },
  ],
  ADMIN: [
    { id: 'admin.branch', title: 'Аналитика филиала', description: 'Ключевые показатели, динамика и зоны внимания.', group: 'Аналитика', icon: 'grid' },
    { id: 'admin.suspicious', title: 'Подозрительная активность', description: 'Аномалии в начислениях, оплатах и заявках.', group: 'Контроль', icon: 'shield' },
    { id: 'admin.schedule', title: 'Анализ расписания', description: 'Нагрузка, конфликты и свободные окна.', group: 'Ресурсы', icon: 'calendar' },
    { id: 'admin.resources', title: 'Управление ресурсами', description: 'Загрузка наставников и аудиторий.', group: 'Ресурсы', icon: 'grid' },
    { id: 'admin.leads', title: 'Анализ заявок', description: 'Очередь заявок и скорость обработки.', group: 'Заявки', icon: 'users' },
    { id: 'admin.reply', title: 'Ответ на заявку', description: 'Черновик ответа клиенту по заявке.', group: 'Заявки', icon: 'message' },
    { id: 'admin.routine', title: 'Рутинные процессы', description: 'Что можно автоматизировать без риска.', group: 'Автоматизация', icon: 'spark' },
    { id: 'admin.chat', title: 'AI-диалог администратора', description: 'Вопросы по управлению филиалом.', group: 'Диалог', icon: 'message' },
  ],
  PARENT: [],
}

const ROLE_DEFAULTS: Record<RoleName, number> = { STUDENT: 30, TEACHER: 40, MANAGER: 30, ADMIN: 50, PARENT: 0 }

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function dayStart() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}
function monthStart() {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** AI-центр: инструменты ролей, источники, лимиты, история и автоматизации. */
@Injectable()
export class AiCenterService implements OnModuleInit, OnModuleDestroy {
  private scheduler?: ReturnType<typeof setInterval>
  private scheduling = false

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.scheduler = setInterval(() => { void this.runScheduled() }, 30_000)
    this.scheduler.unref?.()
  }

  onModuleDestroy() {
    if (this.scheduler) clearInterval(this.scheduler)
  }

  /** Минимальный планировщик: ежедневное время или день недели + время, без внешнего cron. */
  private scheduleMatches(schedule: string, now: Date, lastRunAt: Date | null) {
    const time = schedule.match(/(\d{1,2}):(\d{2})/)
    if (!time) return false
    const hours = Number(time[1])
    const minutes = Number(time[2])
    if (now.getHours() !== hours || now.getMinutes() !== minutes) return false
    if (lastRunAt && lastRunAt.getFullYear() === now.getFullYear() && lastRunAt.getMonth() === now.getMonth() && lastRunAt.getDate() === now.getDate() && lastRunAt.getHours() === now.getHours() && lastRunAt.getMinutes() === now.getMinutes()) return false
    const normalized = schedule.toLowerCase()
    const days: Array<[string, number]> = [['понедельник', 1], ['вторник', 2], ['среда', 3], ['среду', 3], ['четверг', 4], ['пятница', 5], ['пятницу', 5], ['суббота', 6], ['субботу', 6], ['воскресенье', 0]]
    const explicitDay = days.find(([name]) => normalized.includes(name))
    return explicitDay ? now.getDay() === explicitDay[1] : true
  }

  private async runScheduled() {
    if (this.scheduling) return
    this.scheduling = true
    try {
      const now = new Date()
      const automations = await this.prisma.client.aiAutomation.findMany({
        where: { enabled: true, triggerType: 'SCHEDULE', schedule: { not: null } },
      })
      for (const automation of automations) {
        if (!automation.schedule || !this.scheduleMatches(automation.schedule, now, automation.lastRunAt)) continue
        try {
          await this.runAutomation(automation.id, { userId: automation.createdById, role: 'ADMIN' }, false, { trigger: 'SCHEDULE' })
          await this.prisma.client.aiAutomation.update({ where: { id: automation.id }, data: { lastRunAt: new Date() } })
        } catch (error) {
          await this.reportFailure({
            userId: automation.createdById,
            role: 'ADMIN',
            feature: 'automation.schedule',
            message: automation.name,
            error: error instanceof Error ? error.message : 'Ошибка планировщика',
          }).catch(() => undefined)
        }
      }
    } finally {
      this.scheduling = false
    }
  }

  private async setting() {
    return this.prisma.client.aiSetting.upsert({
      where: { id: 'branch' },
      update: {},
      create: { id: 'branch' },
    })
  }

  private async roleLimit(role: RoleName) {
    return this.prisma.client.aiRoleLimit.upsert({
      where: { role },
      update: {},
      create: { role, dailyRequests: ROLE_DEFAULTS[role] || 20 },
    })
  }

  private async limits(userId: string, role: RoleName): Promise<Limits> {
    const [setting, roleLimit, userLimit] = await Promise.all([
      this.setting(),
      this.roleLimit(role),
      this.prisma.client.aiUserLimit.findUnique({ where: { userId } }),
    ])
    const featurePermissions = asRecord(setting.featurePermissions)
    const settingAllowed = featurePermissions[role] === undefined ? null : asArray(featurePermissions[role])
    const roleAllowed = roleLimit.allowedFeatures === null ? null : asArray(roleLimit.allowedFeatures)
    const userAllowed = userLimit?.allowedFeatures == null ? null : asArray(userLimit.allowedFeatures)
    const catalogIds = new Set((TOOL_CATALOG[role] ?? []).map((tool) => tool.id))
    // Пустой массив — это явный запрет всех функций, а null/undefined — наследование.
    const configured = userAllowed ?? roleAllowed ?? settingAllowed ?? [...catalogIds]
    // Настройки могут только сузить каталог роли, но не выдать чужой инструмент.
    const allowedFeatures = configured.filter((feature) => catalogIds.has(feature))
    return {
      dailyRequests: userLimit?.dailyRequests ?? roleLimit.dailyRequests ?? setting.dailyDefault,
      monthlyTokens: userLimit?.monthlyTokens ?? roleLimit.monthlyTokens,
      allowedFeatures,
      model: userLimit?.model || roleLimit.model || setting.model || env.OPENAI_MODEL,
      enabled: setting.enabled,
      allowExternalSources: setting.allowExternalSources,
    }
  }

  async status(userId: string, role: RoleName) {
    const [setting, limits, todayCount, monthTokens] = await Promise.all([
      this.setting(),
      this.limits(userId, role),
      this.prisma.client.aiRequest.count({ where: { userId, createdAt: { gte: dayStart() } } }),
      this.prisma.client.aiRequest.aggregate({ where: { userId, createdAt: { gte: monthStart() } }, _sum: { tokens: true } }),
    ])
    return {
      configured: Boolean(env.OPENAI_API_KEY),
      provider: setting.provider,
      model: limits.model,
      enabled: limits.enabled,
      mode: env.OPENAI_API_KEY ? 'model' : 'local',
      tools: (TOOL_CATALOG[role] ?? []).filter((tool) => limits.allowedFeatures.includes(tool.id)),
      limits: { dailyRequests: limits.dailyRequests, monthlyTokens: limits.monthlyTokens, allowedFeatures: limits.allowedFeatures },
      allowExternalSources: limits.allowExternalSources,
      usage: { today: todayCount, tokensThisMonth: monthTokens._sum.tokens ?? 0 },
      disclaimer: env.OPENAI_API_KEY ? DISCLAIMER : LOCAL_DISCLAIMER,
    }
  }

  async tools(userId: string, role: RoleName) {
    const limits = await this.limits(userId, role)
    return { tools: (TOOL_CATALOG[role] ?? []).filter((tool) => limits.allowedFeatures.includes(tool.id)) }
  }

  private async checkAccess(userId: string, role: RoleName, feature: string) {
    if (!['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN'].includes(role)) throw forbidden('AI-инструменты доступны ученикам, наставникам, менеджерам и администраторам')
    const catalogIds = (TOOL_CATALOG[role] ?? []).map((tool) => tool.id)
    if (!catalogIds.includes(feature)) throw forbidden('Этот AI-инструмент недоступен для вашей роли')
    const limits = await this.limits(userId, role)
    if (!limits.enabled) throw forbidden('AI-инструменты отключены администратором филиала')
    if (!limits.allowedFeatures.includes(feature)) throw forbidden('Эта AI-функция недоступна для вашей роли')
    const used = await this.prisma.client.aiRequest.count({ where: { userId, createdAt: { gte: dayStart() } } })
    if (used >= limits.dailyRequests) throw new AppError(429, 'AI_QUOTA', `Дневной лимит AI: ${limits.dailyRequests} запросов. Лимит можно изменить в настройках филиала.`)
    const month = await this.prisma.client.aiRequest.aggregate({ where: { userId, createdAt: { gte: monthStart() } }, _sum: { tokens: true } })
    if ((month._sum.tokens ?? 0) >= limits.monthlyTokens) throw new AppError(429, 'AI_TOKEN_QUOTA', 'Месячный лимит токенов AI исчерпан')
    return limits
  }

  private async reportFailure(input: { userId: string; role: RoleName; feature: string; message: string; error: string }) {
    const request = await this.prisma.client.aiRequest.create({
      data: {
        userId: input.userId, role: input.role, feature: input.feature,
        prompt: input.message.slice(0, 4000), status: 'ERROR', error: input.error.slice(0, 2000),
        provider: 'openai', model: env.OPENAI_MODEL,
      },
    })
    const report = await this.prisma.client.aiErrorReport.create({
      data: { requestId: request.id, userId: input.userId, feature: input.feature, message: input.error.slice(0, 2000) },
    })
    const staff = await this.prisma.client.user.findMany({
      where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (staff.length) {
      await this.prisma.client.notification.createMany({
        data: staff.map((person) => ({
          userId: person.id, type: 'SYSTEM' as const, title: 'Ошибка AI-инструмента',
          body: `${input.feature}: ${input.error.slice(0, 500)}`,
          data: { kind: 'ai_error', reportId: report.id, requestId: request.id },
        })),
      }).catch(() => undefined)
    }
    await writeAudit({ actorId: input.userId, action: 'ai.error', entity: 'AiErrorReport', entityId: report.id, metadata: { feature: input.feature } })
    return report
  }

  // ---------- контекст и источники ----------

  private async studentContext(userId: string, message: string, input: AiInput): Promise<AiContext> {
    const [enrollments, attendance, submissions, attempts, coins, achievements, knowledge, targetHomework] = await Promise.all([
      this.prisma.client.courseEnrollment.findMany({
        where: { studentId: userId, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] }, ...(input.courseId ? { courseId: input.courseId } : {}) },
        include: {
          course: {
            select: {
              id: true, title: true, description: true, level: true,
              modules: { orderBy: { position: 'asc' }, take: 4, select: { title: true, lessons: { orderBy: { position: 'asc' }, take: 4, select: { id: true, title: true, description: true, materials: { select: { title: true, url: true, type: true } } } } } },
            },
          },
        },
      }),
      this.prisma.client.attendance.count({ where: { userId, status: { not: 'ABSENT' }, joinedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
      this.prisma.client.homeworkSubmission.findMany({
        where: { studentId: userId },
        orderBy: { submittedAt: 'desc' }, take: 8,
        select: { id: true, status: true, score: true, submittedAt: true, homework: { select: { title: true, maxScore: true, description: true, course: { select: { title: true } } } } },
      }),
      this.prisma.client.testAttempt.findMany({
        where: { studentId: userId, status: 'SUBMITTED' },
        orderBy: { submittedAt: 'desc' }, take: 8,
        select: { percent: true, score: true, maxScore: true, submittedAt: true, test: { select: { title: true } } },
      }),
      this.prisma.client.coinBalance.findUnique({ where: { userId }, select: { balance: true } }),
      this.prisma.client.userAchievement.count({ where: { userId } }),
      this.prisma.client.knowledgeMaterial.findMany({
        where: {
          isPublished: true,
          ...(message.trim() ? { OR: [{ title: { contains: message.slice(0, 80), mode: 'insensitive' as const } }, { description: { contains: message.slice(0, 80), mode: 'insensitive' as const } }, { content: { contains: message.slice(0, 80), mode: 'insensitive' as const } }] } : {}),
        },
        orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, title: true, description: true, content: true, fileUrl: true, videoUrl: true, type: true },
      }),
      input.homeworkId
        ? this.prisma.client.homework.findFirst({
            where: { id: input.homeworkId, course: { enrollments: { some: { studentId: userId } } } },
            select: {
              id: true, title: true, description: true, dueAt: true, maxScore: true,
              course: { select: { id: true, title: true } },
              lesson: { select: { title: true } },
            },
          })
        : Promise.resolve(null),
    ])
    const facts: string[] = []
    const sources: Source[] = []
    for (const enrollment of enrollments) {
      facts.push(`Курс «${enrollment.course.title}», уровень ${enrollment.course.level}, прогресс ${enrollment.progress}%.`)
      facts.push(`Описание курса: ${enrollment.course.description.slice(0, 700)}`)
      sources.push({ title: `Курс «${enrollment.course.title}»`, url: `/learn/${enrollment.course.id}`, kind: 'COURSE' })
      for (const module of enrollment.course.modules) {
        for (const lesson of module.lessons) {
          facts.push(`Урок «${lesson.title}» (${module.title}): ${(lesson.description ?? '').slice(0, 500)}`)
          sources.push({ title: `Урок «${lesson.title}»`, url: `/learn/${enrollment.course.id}`, kind: 'LESSON' })
          for (const material of lesson.materials) sources.push({ title: material.title, url: material.url, kind: ['DOCUMENT', 'PDF', 'FILE', 'PRESENTATION'].includes(material.type) ? 'DOCUMENT' : 'MATERIAL' })
        }
      }
    }
    if (attendance) facts.push(`Посещено занятий за 30 дней: ${attendance}.`)
    if (submissions.length) facts.push(`Последние работы: ${submissions.map((item) => `${item.homework.title} — ${item.status}, ${item.score ?? '—'}/${item.homework.maxScore}`).join('; ')}.`)
    if (attempts.length) facts.push(`Последние тесты: ${attempts.map((item) => `${item.test.title} — ${item.percent ?? '?'}%`).join('; ')}.`)
    facts.push(`Баланс IT Coins: ${coins?.balance ?? 0}; достижений: ${achievements}.`)
    if (targetHomework) {
      facts.push(`Задание «${targetHomework.title}» (${targetHomework.course.title}${targetHomework.lesson ? `, урок «${targetHomework.lesson.title}»` : ''}): ${targetHomework.description.slice(0, 900)}. Максимум баллов: ${targetHomework.maxScore}; срок: ${targetHomework.dueAt.toISOString()}.`)
      sources.push({ title: `Задание «${targetHomework.title}»`, url: '/homework', kind: 'MATERIAL' })
    }
    for (const item of knowledge) {
      facts.push(`Материал платформы «${item.title}»: ${(item.description || item.content || '').slice(0, 600)}`)
      sources.push({ title: item.title, url: item.fileUrl ?? item.videoUrl ?? '/library', kind: ['DOCUMENT', 'PDF', 'FILE', 'PRESENTATION'].includes(item.type) ? 'DOCUMENT' : 'MATERIAL' })
    }
    return { facts, sources, metrics: { courses: enrollments.length, attendance, submissions: submissions.length, attempts: attempts.length } }
  }

  private async teacherContext(userId: string, role: RoleName, input: AiInput): Promise<AiContext> {
    const courses = await this.prisma.client.course.findMany({
      where: role === 'ADMIN' ? {} : { teacherId: userId },
      orderBy: { updatedAt: 'desc' }, take: 10,
      select: { id: true, title: true, status: true, _count: { select: { enrollments: true } } },
    })
    const ids = courses.map((course) => course.id)
    const [submissions, reviews, attendance, target, lessons, targetSubmission] = await Promise.all([
      this.prisma.client.homeworkSubmission.findMany({
        where: { homework: { courseId: { in: ids } }, status: 'SUBMITTED' },
        orderBy: { submittedAt: 'asc' }, take: 8,
        select: { id: true, submittedAt: true, student: { select: { firstName: true, lastName: true } }, homework: { select: { title: true, course: { select: { title: true } } } } },
      }),
      this.prisma.client.homeworkReview.aggregate({ where: { reviewerId: userId }, _avg: { score: true }, _count: true }),
      this.prisma.client.attendance.count({ where: { schedule: { teacherId: userId }, status: { not: 'ABSENT' }, joinedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
      input.studentId
        ? this.prisma.client.user.findFirst({
            where: { id: input.studentId, role: 'STUDENT', enrollments: { some: { course: { teacherId: userId } } } },
            select: { id: true, firstName: true, lastName: true, email: true, coinProfile: true, enrollments: { where: { courseId: { in: ids } }, select: { progress: true, course: { select: { title: true } } } } },
          })
        : Promise.resolve(null),
      this.prisma.client.lesson.findMany({
        where: { module: { courseId: { in: ids } } },
        orderBy: { updatedAt: 'desc' }, take: 12,
        select: { id: true, title: true, description: true, module: { select: { courseId: true, title: true } } },
      }),
      input.submissionId || input.homeworkId
        ? this.prisma.client.homeworkSubmission.findFirst({
            where: input.submissionId
              ? { id: input.submissionId, homework: { courseId: { in: ids } } }
              : { homeworkId: input.homeworkId, homework: { courseId: { in: ids } } },
            orderBy: { submittedAt: 'desc' },
            select: {
              id: true, status: true, text: true, projectUrl: true, files: true, comments: true, submittedAt: true,
              student: { select: { id: true, firstName: true, lastName: true } },
              homework: { select: { id: true, title: true, description: true, maxScore: true, course: { select: { id: true, title: true } } } },
              review: { select: { score: true, comment: true, aiFeedback: true, returnForRevision: true } },
            },
          })
        : Promise.resolve(null),
    ])
    const facts = courses.map((course) => `Группа «${course.title}»: ${course._count.enrollments} учеников, статус ${course.status}.`)
    facts.push(`Непроверенных работ: ${submissions.length}; проверено работ: ${reviews._count}; средний балл проверок: ${Math.round(reviews._avg.score ?? 0)}.`)
    facts.push(`Посещений занятий наставника за 30 дней: ${attendance}.`)
    if (target) {
      facts.push(`Ученик ${target.firstName} ${target.lastName}: ${target.enrollments.map((item) => `${item.course.title} — ${item.progress}%`).join('; ')}.`)
    }
    const sources: Source[] = courses.map((course) => ({ title: `Группа «${course.title}»`, url: `/courses/${course.id}/preview`, kind: 'COURSE' }))
    for (const lesson of lessons) sources.push({ title: `Урок «${lesson.title}»`, url: `/courses/${lesson.module.courseId}/preview`, kind: 'LESSON' })
    for (const submission of submissions.slice(0, 5)) facts.push(`Ожидает проверки: «${submission.homework.title}», ${submission.student.firstName} ${submission.student.lastName}.`)
    if (targetSubmission) {
      const studentName = `${targetSubmission.student.firstName} ${targetSubmission.student.lastName}`.trim()
      facts.push(`Проверяемая работа «${targetSubmission.homework.title}» ученика ${studentName}, статус ${targetSubmission.status}, отправлена ${targetSubmission.submittedAt.toISOString()}.`)
      facts.push(`Задание: ${targetSubmission.homework.description.slice(0, 900)}. Максимум баллов: ${targetSubmission.homework.maxScore}.`)
      if (targetSubmission.text?.trim()) facts.push(`Текст работы: ${targetSubmission.text.slice(0, 2500)}`)
      if (targetSubmission.projectUrl) facts.push(`Ссылка на работу: ${targetSubmission.projectUrl}`)
      if (Array.isArray(targetSubmission.files) && targetSubmission.files.length) facts.push(`Файлов приложено: ${targetSubmission.files.length}.`)
      if (targetSubmission.comments) facts.push(`Комментарии ученика: ${JSON.stringify(targetSubmission.comments).slice(0, 1200)}`)
      if (targetSubmission.review?.aiFeedback) facts.push(`Предыдущая AI-проверка: ${JSON.stringify(targetSubmission.review.aiFeedback).slice(0, 1200)}`)
      sources.push({ title: `Работа «${targetSubmission.homework.title}» · ${studentName}`, url: `/review?submission=${targetSubmission.id}`, kind: 'MATERIAL' })
    }
    return { facts, sources, metrics: { courses: courses.length, pending: submissions.length, reviews: reviews._count, target, submission: targetSubmission?.id ?? null } }
  }

  private async managerContext(role: RoleName, input: AiInput): Promise<AiContext> {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    const [students, teachers, courses, attendance, overdue, newLeads, recentPayments, groups] = await Promise.all([
      this.prisma.client.user.count({ where: { role: 'STUDENT', isActive: true, deletedAt: null } }),
      this.prisma.client.user.count({ where: { role: 'TEACHER', isActive: true, deletedAt: null } }),
      this.prisma.client.course.findMany({ where: role === 'ADMIN' ? {} : { status: 'ACTIVE' }, select: { id: true, title: true, teacherId: true, _count: { select: { enrollments: true } } }, take: 12 }),
      this.prisma.client.attendance.count({ where: { status: { not: 'ABSENT' }, joinedAt: { gte: weekAgo } } }),
      this.prisma.client.invoice.count({ where: { status: { in: ['ISSUED', 'OVERDUE'] }, dueAt: { lt: now } } }),
      this.prisma.client.lead.count({ where: { status: 'NEW' } }),
      this.prisma.client.payment.aggregate({ where: { paidAt: { gte: weekAgo }, status: 'CONFIRMED' }, _sum: { amount: true } }),
      this.prisma.client.courseEnrollment.groupBy({ by: ['courseId'], where: { status: 'ACTIVE' }, _avg: { progress: true }, _count: true }),
    ])
    const facts = [
      `Учеников: ${students}; наставников: ${teachers}; активных групп: ${courses.length}.`,
      `Посещаемость за 7 дней: ${attendance} отметок.`,
      `Просроченных счетов: ${overdue}; новых заявок: ${newLeads}; оплаты за неделю: ${recentPayments._sum.amount ?? 0} KGS.`,
    ]
    for (const group of groups.slice(0, 10)) {
      const course = courses.find((item) => item.id === group.courseId)
      if (course) facts.push(`Группа «${course.title}»: ${group._count} учеников, средний прогресс ${Math.round(group._avg.progress ?? 0)}%.`)
    }
    const sources: Source[] = courses.map((course) => ({ title: `Группа «${course.title}»`, url: `/courses/${course.id}/preview`, kind: 'COURSE' }))
    if (input.courseId) {
      const selected = courses.find((course) => course.id === input.courseId)
      if (selected) facts.push(`Выбранная группа для анализа: «${selected.title}».`)
    }
    return { facts, sources, metrics: { students, teachers, courses: courses.length, attendance, overdue, newLeads } }
  }

  private async adminContext(input: AiInput): Promise<AiContext> {
    const [users, pendingCoins, upcoming, openLeads, errors, schedule, targetLead, refunds] = await Promise.all([
      this.prisma.client.user.groupBy({ by: ['role'], where: { isActive: true, deletedAt: null }, _count: true }),
      this.prisma.client.coinTransaction.count({ where: { status: 'PENDING' } }),
      this.prisma.client.schedule.count({ where: { startsAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'ONGOING'] } } }),
      this.prisma.client.lead.count({ where: { status: 'NEW' } }),
      this.prisma.client.aiErrorReport.count({ where: { status: 'OPEN' } }),
      this.prisma.client.schedule.findMany({
        where: { startsAt: { gte: new Date(Date.now() - 86400000) }, status: { in: ['SCHEDULED', 'ONGOING'] } },
        orderBy: { startsAt: 'asc' }, take: 10,
        select: { id: true, title: true, startsAt: true, teacherId: true },
      }),
      input.leadId
        ? this.prisma.client.lead.findUnique({
            where: { id: input.leadId },
            select: { id: true, name: true, phone: true, email: true, audience: true, message: true, status: true, createdAt: true, assignedTo: { select: { firstName: true, lastName: true } } },
          })
        : Promise.resolve(null),
      this.prisma.client.refund.count({ where: { status: 'REQUESTED' } }),
    ])
    const facts = users.map((item) => `${item.role}: ${item._count}.`)
    facts.push(`Ожидают подтверждения IT Coins: ${pendingCoins}; ближайших занятий: ${upcoming}; новых заявок: ${openLeads}; открытых ошибок AI: ${errors}; возвратов на проверке: ${refunds}.`)
    for (const lesson of schedule) facts.push(`Занятие «${lesson.title}»: ${lesson.startsAt.toISOString()}, преподаватель ${lesson.teacherId}.`)
    if (targetLead) {
      facts.push(`Заявка «${targetLead.name}»: статус ${targetLead.status}, аудитория ${targetLead.audience}, создана ${targetLead.createdAt.toISOString()}.`)
      if (targetLead.message) facts.push(`Сообщение заявки: ${targetLead.message.slice(0, 1200)}`)
      if (targetLead.assignedTo) facts.push(`Ответственный: ${targetLead.assignedTo.firstName} ${targetLead.assignedTo.lastName}.`)
    }
    const sources: Source[] = [{ title: 'Панель филиала', url: '/admin', kind: 'PLATFORM' }]
    if (targetLead) sources.push({ title: `Заявка «${targetLead.name}»`, url: '/leads', kind: 'PLATFORM' })
    return { facts, sources, metrics: { pendingCoins, upcoming, openLeads, errors, lead: targetLead?.id ?? null, refunds } }
  }

  private async buildContext(userId: string, role: RoleName, input: AiInput): Promise<AiContext> {
    const message = input.message ?? ''
    if (role === 'STUDENT') return this.studentContext(userId, message, input)
    if (role === 'TEACHER') return this.teacherContext(userId, role, input)
    if (role === 'MANAGER') return this.managerContext(role, input)
    return this.adminContext(input)
  }

  // ---------- локальный помощник ----------

  private localAnswer(feature: string, input: AiInput, context: AiContext): Generated {
    const topic = input.message?.trim() || 'текущая тема'
    const facts = context.facts.slice(0, 12)
    const sourceLine = context.sources[0] ? `Источник: ${context.sources[0].title}.` : ''
    if (['student.recommendations', 'student.study_plan', 'student.adapt'].includes(feature)) {
      const plan = feature === 'student.study_plan'
        ? ['Выберите одну тему из последнего урока и повторите её 20 минут.', 'Выполните одно задание без подсказки, затем проверьте по критериям.', 'Запишите два вопроса наставнику к следующему занятию.', 'В конце недели пройдите короткий тест и сравните результат.']
        : ['Повторите темы с наименьшим прогрессом и ближайшую работу.', 'Начните с короткой практики, затем перейдите к тесту.', 'Отметьте затруднения и задайте их наставнику.', 'Следите за посещаемостью: серия и активность влияют на прогресс.']
      return {
        answer: `Персональные шаги по теме «${topic}»:\n${plan.map((line, index) => `${index + 1}. ${line}`).join('\n')}\n\nЧто учтено: ${facts.join(' ')} ${sourceLine}`.trim(),
        assumptions: ['План построен по доступным учебным данным и не учитывает внешние обстоятельства.'],
        confidence: 70,
      }
    }
    if (feature === 'student.error_analysis') {
      const schoolFacts = facts.filter((fact) => fact.startsWith('Последние работы:') || fact.startsWith('Последние тесты:') || fact.includes('прогресс'))
      return {
        answer: `Разбор ошибок по доступным результатам:\n${(schoolFacts.length ? schoolFacts : facts.slice(0, 6)).map((fact) => `• ${fact}`).join('\n')}\n\nЧто сделать: выпишите ошибки из последней работы, найдите для каждой тему урока и повторите её на коротком примере. Затем выполните похожее задание без подсказки.`,
        assumptions: ['В локальном режиме анализируются только сохранённые оценки и статусы; текст вашей работы не перепроверяется.'],
        confidence: 62,
      }
    }
    if (feature === 'teacher.group_analysis' || feature === 'teacher.report') {
      return {
        answer: `Предварительный анализ:\n${facts.map((fact) => `• ${fact}`).join('\n')}\n\nРекомендация: проверьте работы с наибольшим сроком ожидания, свяжитесь с учениками с низкой активностью и зафиксируйте план на неделю.`,
        assumptions: ['Выводы основаны на агрегированных показателях платформы за доступный период.'],
        confidence: 78,
      }
    }
    if (feature.startsWith('manager.') || feature.startsWith('admin.')) {
      const groups = facts.filter((fact) => fact.startsWith('Группа'))
      const focus: Record<string, string[]> = {
        'manager.attendance': facts.filter((fact) => fact.includes('Посещаемость') || fact.includes('Учеников')),
        'manager.performance': facts.filter((fact) => fact.includes('прогресс') || fact.includes('Учеников')),
        'manager.group_efficiency': groups,
        'manager.teacher_efficiency': facts.filter((fact) => fact.includes('наставников') || fact.includes('проверено') || fact.includes('Посещений')),
        'manager.risk': facts.filter((fact) => fact.includes('Просроченных') || fact.includes('заявок')),
        'manager.resources': facts.filter((fact) => fact.includes('Учеников') || fact.includes('наставников') || fact.includes('активных групп')),
        'admin.suspicious': facts.filter((fact) => fact.includes('IT Coins') || fact.includes('возвратов') || fact.includes('ошибок AI')),
        'admin.schedule': facts.filter((fact) => fact.includes('Занятие') || fact.includes('ближайших занятий')),
        'admin.leads': facts.filter((fact) => fact.includes('заявок') || fact.includes('Заявка')),
        'admin.reply': facts.filter((fact) => fact.includes('Заявка') || fact.includes('Сообщение заявки')),
        'admin.resources': facts.filter((fact) => fact.includes('Занятие') || fact.includes('IT Coins')),
        'admin.routine': facts.filter((fact) => fact.includes('Ожидают') || fact.includes('заявок')),
      }
      const guidance: Record<string, string> = {
        'manager.attendance': 'Проверьте группы с низкой посещаемостью и свяжитесь с наставниками до следующего занятия.',
        'manager.performance': 'Сравните динамику с прошлой неделей и обсудите отстающих учеников с наставниками.',
        'manager.group_efficiency': 'Сопоставьте прогресс групп с нагрузкой наставников и перераспределите внимание.',
        'manager.teacher_efficiency': 'Проверьте очередь проверок и нагрузку наставников; выводы обсуждайте с человеком.',
        'manager.risk': 'Составьте список учеников и групп с наибольшим риском и назначьте ответственных.',
        'manager.resources': 'Определите, где не хватает наставников или учебных мест, и подготовьте план на неделю.',
        'admin.suspicious': 'Проверьте перечисленные операции вручную. Финансовые и необратимые действия AI не выполняет.',
        'admin.schedule': 'Проверьте конфликты, свободные окна и загрузку наставников перед изменением расписания.',
        'admin.leads': 'Оцените скорость обработки заявок и назначьте ответственных менеджеров.',
        'admin.reply': 'Подготовьте черновик ответа; отправку клиенту подтверждает сотрудник.',
        'admin.resources': 'Сверьте загрузку с расписанием и зафиксируйте решения в рабочем плане.',
        'admin.routine': 'Выберите безопасные повторяющиеся действия и оформите их как автоматизацию с подтверждением.',
      }
      const selected = focus[feature]?.length ? focus[feature] : facts
      return {
        answer: `${feature.startsWith('admin.') ? 'Административная' : 'Управленческая'} сводка (${feature}):\n${selected.map((fact) => `• ${fact}`).join('\n')}\n\n${guidance[feature] ?? 'Проверьте показатели и примите решение вместе с ответственным сотрудником.'}`,
        assumptions: ['Показатели рассчитаны по данным платформы без внешних источников.', 'Финансовые, юридические и необратимые действия требуют подтверждения человека.'],
        confidence: 75,
      }
    }
    if (feature === 'teacher.homework_review' && context.metrics.submission) {
      return {
        answer: `Предварительный разбор работы:\n${facts.filter((fact) => fact.startsWith('Проверяемая работа') || fact.startsWith('Задание:') || fact.startsWith('Текст работы') || fact.startsWith('Ссылка на работу')).map((fact) => `• ${fact}`).join('\n')}\n\nПроверьте решение по критериям задания, отметьте сильные стороны и одну конкретную ошибку. Итоговый балл выставляет наставник.`,
        assumptions: ['Разбор не заменяет проверку наставником и не выставляет официальную оценку.'],
        confidence: 58,
      }
    }
    const words = topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3)
    const minimumMatches = words.length > 1 ? 2 : 1
    const relevantFacts = facts.filter((fact) => words.filter((word) => fact.toLowerCase().includes(word)).length >= minimumMatches)
    if (!relevantFacts.length) {
      return {
        answer: `В доступных материалах платформы я не нашёл подтверждённого материала по теме «${topic}». Не буду выдавать общие знания за содержание курса.\n\nКак разобраться самостоятельно:\n1. Сформулируйте, что уже известно по теме, и один конкретный вопрос.\n2. Найдите определение и короткий пример в учебнике или у наставника.\n3. Объясните тему своими словами и проверьте себя на одном упражнении.\n4. Запишите, где возникло затруднение, и задайте вопрос наставнику.\n\nДоступные источники платформы: ${context.sources.slice(0, 4).map((source) => source.title).join('; ') || 'не указаны'}.`,
        assumptions: ['По запросу не найдено совпадений в доступных материалах; ответ содержит только учебный метод, а не факты курса.'],
        confidence: 35,
      }
    }
    return {
      answer: `По теме «${topic}» в материалах платформы есть следующие ориентиры:\n${relevantFacts.slice(0, 6).map((fact) => `• ${fact}`).join('\n')}\n\nКак учиться дальше: сформулируйте, что уже понятно, найдите один пробел и проверьте его на коротком примере. Готовое решение задания не выдаётся — это помогает закрепить навык. ${sourceLine}`.trim(),
      assumptions: ['Совпадение найдено по словам запроса; проверьте, что источник действительно относится к вашей теме.'],
      confidence: 55,
    }
  }

  // ---------- вызов модели ----------

  private async modelAnswer(role: RoleName, feature: string, input: AiInput, context: AiContext, model: string, maxTokens: number): Promise<Generated> {
    const language = input.language === 'ky' ? 'кыргызском' : input.language === 'en' ? 'английском' : 'русском'
    const system = [
      'Ты — встроенный AI-помощник образовательной платформы ITadis.',
      `Роль пользователя: ${role}. Инструмент: ${feature}.`,
      `Отвечай на ${language} языке, кратко и структурно.`,
      'Помогай учиться, а не выдавай готовое решение домашнего задания или теста. Для ученика давай подсказки, план и объяснение, но оставляй выполнение ученику.',
      'Используй предоставленные факты платформы. Не выдумывай оценки, платежи, персональные данные и события.',
      'Отделяй проверенные факты платформы от предположений. Если данных не хватает, прямо скажи об этом.',
      'Не выполняй финансовые, юридические и необратимые действия. Предлагай их только как черновик для подтверждения человеком.',
      'Верни только JSON: {"answer": string, "assumptions": string[], "confidence": number 0..100}.',
    ].join('\n')
    const user = [
      `Запрос: ${input.message ?? '(без текста)'}`,
      `Проверенные факты платформы:\n${context.facts.map((fact) => `- ${fact}`).join('\n')}`,
      `Источники:\n${context.sources.map((source) => `- ${source.title}${source.url ? ` (${source.url})` : ''} [${source.kind}]`).join('\n')}`,
    ].join('\n\n')
    let response: Response
    try {
      response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.25,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(45_000),
      })
    } catch (error) {
      throw new AppError(502, 'AI_UNAVAILABLE', `AI временно недоступен: ${error instanceof Error ? error.message : 'сеть'}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new AppError(response.status === 429 ? 429 : 502, response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_ERROR', `AI вернул ошибку ${response.status}: ${text.slice(0, 300)}`)
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } }
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    let parsed: { answer?: string; assumptions?: string[]; confidence?: number } = { answer: content }
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as typeof parsed
    } catch {
      parsed = { answer: content }
    }
    return {
      answer: parsed.answer?.trim() || content,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 10).map(String) : [],
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 60))),
      tokens: data.usage?.total_tokens ?? 0,
    }
  }

  // ---------- выполнение инструмента ----------

  async run(userId: string, role: RoleName, input: AiInput) {
    const limits = await this.checkAccess(userId, role, input.feature)
    if (input.externalUrls?.length && !limits.allowExternalSources) throw forbidden('Внешние источники отключены администратором филиала')
    const started = Date.now()
    try {
      const context = await this.buildContext(userId, role, input)
      if (input.externalUrls?.length) {
        context.sources.push(...input.externalUrls.slice(0, 5).map((url) => ({ title: `Внешняя ссылка: ${url.slice(0, 100)}`, url, kind: 'EXTERNAL' as const, note: 'Ссылка предоставлена пользователем; содержимое не загружалось автоматически.' })))
      }
      if (env.OPENAI_API_KEY) {
        context.sources.push({ title: 'Общие знания модели', kind: 'MODEL', note: 'Модель может дополнять ответ общими знаниями; такие сведения требуют проверки и отделены от фактов платформы.' })
      }
      const requiresProvider = PROVIDER_REQUIRED.has(input.feature)
      if (requiresProvider && !env.OPENAI_API_KEY) {
        throw new AppError(503, 'AI_NOT_CONFIGURED', 'Для этой функции нужен ключ модели. Добавьте OPENAI_API_KEY в переменные окружения сервера; аналитические инструменты уже работают локально.')
      }
      const generated: Generated = env.OPENAI_API_KEY
        ? await this.modelAnswer(role, input.feature, input, context, limits.model, 1200)
        : this.localAnswer(input.feature, input, context)
      const duration = Date.now() - started
      const request = await this.prisma.client.aiRequest.create({
        data: {
          userId, role, feature: input.feature,
          prompt: (input.message ?? '').slice(0, 4000),
          response: generated.answer,
          model: env.OPENAI_API_KEY ? limits.model : 'local-rules',
          provider: env.OPENAI_API_KEY ? 'openai' : 'local',
          status: 'SUCCESS',
          sources: context.sources as unknown as Prisma.InputJsonValue,
          assumptions: generated.assumptions as unknown as Prisma.InputJsonValue,
          confidence: generated.confidence,
          durationMs: duration,
          tokens: generated.tokens ?? 0,
          conversationId: input.conversationId,
        },
      })
      await writeAudit({
        actorId: userId, action: 'ai.run', entity: 'AiRequest', entityId: request.id,
        metadata: { feature: input.feature, role, provider: request.provider, model: request.model, tokens: request.tokens, local: !env.OPENAI_API_KEY },
      })
      return {
        id: request.id,
        answer: generated.answer,
        sources: context.sources,
        assumptions: generated.assumptions,
        confidence: generated.confidence,
        provider: request.provider,
        model: request.model,
        generatedByAi: true,
        disclaimer: env.OPENAI_API_KEY ? DISCLAIMER : LOCAL_DISCLAIMER,
        durationMs: duration,
        usage: { today: (await this.prisma.client.aiRequest.count({ where: { userId, createdAt: { gte: dayStart() } } })), limit: limits.dailyRequests },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка AI'
      await this.reportFailure({ userId, role, feature: input.feature, message: input.message ?? '', error: message }).catch(() => undefined)
      throw error
    }
  }

  // ---------- история ----------

  async history(userId: string, role: RoleName, query: { page?: number; limit?: number; feature?: string }) {
    const page = Math.max(1, query.page ?? 1)
    const limit = Math.min(100, Math.max(1, query.limit ?? 20))
    const where: Prisma.AiRequestWhereInput = { ...(role === 'ADMIN' ? {} : { userId }), ...(query.feature ? { feature: query.feature } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.client.aiRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      }),
      this.prisma.client.aiRequest.count({ where }),
    ])
    return {
      items: items.map((item) => ({ ...item, disclaimer: item.provider === 'local' ? LOCAL_DISCLAIMER : DISCLAIMER, generatedByAi: true })),
      total, page, limit,
    }
  }

  async deleteHistory(id: string, userId: string, role: RoleName) {
    const item = await this.prisma.client.aiRequest.findUnique({ where: { id } })
    if (!item) throw notFound('Запись истории не найдена')
    if (role !== 'ADMIN' && item.userId !== userId) throw forbidden('Можно удалять только свою историю AI')
    await this.prisma.client.aiRequest.delete({ where: { id } })
    await writeAudit({ actorId: userId, action: 'ai.history.delete', entity: 'AiRequest', entityId: id })
    return { deleted: true }
  }

  async clearHistory(userId: string) {
    const result = await this.prisma.client.aiRequest.deleteMany({ where: { userId } })
    await writeAudit({ actorId: userId, action: 'ai.history.clear', entity: 'AiRequest', metadata: { count: result.count } })
    return { deleted: result.count }
  }

  async flagHistory(id: string, userId: string, role: RoleName, feedback: string) {
    const item = await this.prisma.client.aiRequest.findUnique({ where: { id } })
    if (!item) throw notFound('Запись истории не найдена')
    if (role !== 'ADMIN' && item.userId !== userId) throw forbidden('Можно отметить только свой ответ AI')
    const report = await this.prisma.client.aiErrorReport.create({
      data: { requestId: id, userId, feature: item.feature, message: feedback.slice(0, 2000) },
    })
    await this.prisma.client.aiRequest.update({ where: { id }, data: { feedback, isFlagged: true } })
    const staff = await this.prisma.client.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } })
    if (staff.length) {
      await this.prisma.client.notification.createMany({
        data: staff.map((person) => ({ userId: person.id, type: 'SYSTEM' as const, title: 'Жалоба на ответ AI', body: feedback.slice(0, 500), data: { kind: 'ai_error', reportId: report.id, requestId: id } })),
      }).catch(() => undefined)
    }
    await writeAudit({ actorId: userId, action: 'ai.feedback', entity: 'AiErrorReport', entityId: report.id })
    return { reported: true, reportId: report.id }
  }

  // ---------- ошибки ----------

  async errors(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER') throw forbidden('Ошибки AI доступны администратору и менеджеру')
    const rows = await this.prisma.client.aiErrorReport.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    })
    const map = new Map(users.map((user) => [user.id, user]))
    return rows.map((row) => ({ ...row, user: map.get(row.userId) ?? null }))
  }

  async resolveError(id: string, actor: Actor, resolution: string) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Закрывает обращение администратор или менеджер')
    const report = await this.prisma.client.aiErrorReport.findUnique({ where: { id } })
    if (!report) throw notFound('Обращение не найдено')
    const updated = await this.prisma.client.aiErrorReport.update({
      where: { id },
      data: { status: 'RESOLVED', resolution: resolution.slice(0, 2000), reviewedById: actor.userId, reviewedAt: new Date() },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.error.resolve', entity: 'AiErrorReport', entityId: id })
    return updated
  }

  // ---------- настройки ----------

  async settings(role: RoleName) {
    if (role !== 'ADMIN') throw forbidden('Настройки AI доступны администратору филиала')
    for (const roleName of ['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN'] as RoleName[]) await this.roleLimit(roleName)
    const [setting, roleLimits, userLimits] = await Promise.all([
      this.setting(),
      this.prisma.client.aiRoleLimit.findMany({ orderBy: { role: 'asc' } }),
      this.prisma.client.aiUserLimit.findMany({ include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } } }),
    ])
    return { setting, roleLimits, userLimits, catalog: TOOL_CATALOG, providerConfigured: Boolean(env.OPENAI_API_KEY) }
  }

  async updateSettings(actor: Actor, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Настройки AI доступны администратору филиала')
    const data: Prisma.AiSettingUpdateInput = {}
    if (input.enabled !== undefined) data.enabled = Boolean(input.enabled)
    if (input.provider !== undefined) data.provider = String(input.provider)
    if (input.model !== undefined) data.model = String(input.model)
    if (input.dailyDefault !== undefined) data.dailyDefault = Math.max(1, Number(input.dailyDefault))
    if (input.maxTokens !== undefined) data.maxTokens = Math.max(100, Number(input.maxTokens))
    if (input.allowExternalSources !== undefined) data.allowExternalSources = Boolean(input.allowExternalSources)
    if (input.featurePermissions !== undefined) data.featurePermissions = input.featurePermissions as Prisma.InputJsonValue
    data.updatedById = actor.userId
    const updated = await this.prisma.client.aiSetting.upsert({
      where: { id: 'branch' },
      update: data,
      create: {
        id: 'branch',
        enabled: Boolean(input.enabled ?? true),
        provider: String(input.provider ?? 'openai'),
        model: String(input.model ?? env.OPENAI_MODEL),
        dailyDefault: Number(input.dailyDefault ?? 30),
        maxTokens: Number(input.maxTokens ?? 900),
        allowExternalSources: Boolean(input.allowExternalSources ?? false),
        featurePermissions: input.featurePermissions as Prisma.InputJsonValue | undefined,
        updatedById: actor.userId,
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.settings.update', entity: 'AiSetting', entityId: 'branch', metadata: input })
    return updated
  }

  async updateRoleLimit(actor: Actor, target: RoleName, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Лимиты AI настраивает администратор филиала')
    const updated = await this.prisma.client.aiRoleLimit.upsert({
      where: { role: target },
      update: {
        ...(input.dailyRequests !== undefined ? { dailyRequests: Math.max(0, Number(input.dailyRequests)) } : {}),
        ...(input.monthlyTokens !== undefined ? { monthlyTokens: Math.max(0, Number(input.monthlyTokens)) } : {}),
        ...(input.allowedFeatures !== undefined ? { allowedFeatures: input.allowedFeatures as Prisma.InputJsonValue } : {}),
        ...(input.model !== undefined ? { model: input.model ? String(input.model) : null } : {}),
      },
      create: {
        role: target,
        dailyRequests: Number(input.dailyRequests ?? ROLE_DEFAULTS[target] ?? 20),
        monthlyTokens: Number(input.monthlyTokens ?? 100000),
        ...(input.allowedFeatures !== undefined ? { allowedFeatures: input.allowedFeatures as Prisma.InputJsonValue } : {}),
        ...(input.model !== undefined ? { model: input.model ? String(input.model) : null } : {}),
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.role-limit.update', entity: 'AiRoleLimit', entityId: updated.id, metadata: { target } })
    return updated
  }

  async updateUserLimit(actor: Actor, targetUserId: string, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Лимиты AI настраивает администратор филиала')
    const user = await this.prisma.client.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!user) throw notFound('Пользователь не найден')
    const updated = await this.prisma.client.aiUserLimit.upsert({
      where: { userId: targetUserId },
      update: {
        ...(input.dailyRequests !== undefined ? { dailyRequests: input.dailyRequests === '' ? null : Math.max(0, Number(input.dailyRequests)) } : {}),
        ...(input.monthlyTokens !== undefined ? { monthlyTokens: input.monthlyTokens === '' ? null : Math.max(0, Number(input.monthlyTokens)) } : {}),
        ...(input.allowedFeatures !== undefined ? { allowedFeatures: input.allowedFeatures as Prisma.InputJsonValue } : {}),
        ...(input.model !== undefined ? { model: input.model ? String(input.model) : null } : {}),
      },
      create: {
        userId: targetUserId,
        dailyRequests: input.dailyRequests ? Number(input.dailyRequests) : null,
        monthlyTokens: input.monthlyTokens ? Number(input.monthlyTokens) : null,
        allowedFeatures: input.allowedFeatures as Prisma.InputJsonValue | undefined,
        model: input.model ? String(input.model) : null,
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.user-limit.update', entity: 'AiUserLimit', entityId: updated.id })
    return updated
  }

  // ---------- автоматизации ----------

  automationCatalog() {
    return {
      triggers: [
        { value: 'MANUAL', label: 'Запуск вручную' },
        { value: 'LEAD_CREATED', label: 'Новая заявка' },
        { value: 'LOW_ATTENDANCE', label: 'Низкая посещаемость' },
        { value: 'PENDING_REVIEW', label: 'Работа ждёт проверки' },
        { value: 'SCHEDULE', label: 'По расписанию' },
      ],
      conditions: [
        { value: 'ALWAYS', label: 'Всегда' },
        { value: 'ROLE_IS', label: 'Роль равна' },
        { value: 'ATTENDANCE_BELOW', label: 'Посещаемость ниже' },
        { value: 'LEAD_STATUS_IS', label: 'Статус заявки' },
        { value: 'COURSE_IS', label: 'Курс' },
      ],
      actions: [
        { value: 'NOTIFY_ROLE', label: 'Уведомить роль' },
        { value: 'NOTIFY_USER', label: 'Уведомить пользователя' },
        { value: 'ASSIGN_LEAD', label: 'Распределить заявку' },
        { value: 'CREATE_REPORT', label: 'Подготовить отчёт' },
        { value: 'REMINDER', label: 'Напоминание' },
      ],
    }
  }

  /** События вызывают подходящие сценарии; ошибки не ломают основную операцию. */
  async triggerEvent(triggerType: string, context: Record<string, unknown> = {}) {
    const automations = await this.prisma.client.aiAutomation.findMany({
      where: { enabled: true, triggerType },
      select: { id: true, createdById: true, name: true },
    })
    const results: Array<{ id: string; status: string }> = []
    for (const automation of automations) {
      try {
        const result = await this.runAutomation(
          automation.id,
          { userId: automation.createdById, role: 'ADMIN' },
          false,
          { ...context, trigger: triggerType, role: String(context.role ?? 'ADMIN') },
        )
        results.push({ id: automation.id, status: result.skipped ? 'SKIPPED' : result.requiresApproval ? 'PENDING_APPROVAL' : 'SUCCESS' })
      } catch (error) {
        await this.reportFailure({
          userId: automation.createdById,
          role: 'ADMIN',
          feature: `automation.${triggerType}`,
          message: automation.name,
          error: error instanceof Error ? error.message : 'Ошибка события автоматизации',
        }).catch(() => undefined)
        results.push({ id: automation.id, status: 'ERROR' })
      }
    }
    return { triggered: results.length, results }
  }

  private evaluateConditions(conditions: Prisma.JsonValue, context: Record<string, unknown>) {
    const list = Array.isArray(conditions) ? conditions : []
    for (const raw of list) {
      const condition = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const type = String(condition.type ?? 'ALWAYS')
      const value = String(condition.value ?? '')
      let passed = false
      if (type === 'ALWAYS') passed = true
      else if (type === 'ROLE_IS') passed = String(context.role ?? '') === value
      else if (type === 'LEAD_STATUS_IS') passed = String(context.leadStatus ?? '') === value
      else if (type === 'COURSE_IS') passed = String(context.courseId ?? '') === value
      else if (type === 'USER_IS') passed = String(context.userId ?? '') === value
      else if (type === 'FEATURE_IS') passed = String(context.feature ?? '') === value
      else if (type === 'ATTENDANCE_BELOW') {
        const percent = Number(context.attendancePercent)
        passed = Number.isFinite(percent) && percent < Number(value)
      }
      if (!passed) return { ok: false, reason: `Условие ${type}${value ? ` = ${value}` : ''} не выполнено` }
    }
    return { ok: true, reason: null }
  }

  private async notify(userId: string, title: string, body: string, type: 'SYSTEM' | 'COINS_AWARDED' | 'ACHIEVEMENT_UNLOCKED' | 'SHOP_ORDER' = 'SYSTEM') {
    await this.prisma.client.notification.create({ data: { userId, type, title, body } }).catch(() => undefined)
  }

  private async notifyAutomationApproval(automationId: string, name: string) {
    const staff = await this.prisma.client.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } })
    if (!staff.length) return
    await this.prisma.client.notification.createMany({
      data: staff.map((person) => ({
        userId: person.id, type: 'SYSTEM' as const, title: `Автоматизация ждёт подтверждения: ${name}`,
        body: 'Запуск создан и ожидает решения ответственного сотрудника.',
        data: { kind: 'ai_automation', automationId },
      })),
    }).catch(() => undefined)
  }

  async automations(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER') throw forbidden('Автоматизации доступны администратору и менеджеру')
    const [automations, runs] = await Promise.all([
      this.prisma.client.aiAutomation.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.client.aiAutomationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20, include: { automation: { select: { name: true } } } }),
    ])
    return { ...this.automationCatalog(), automations, runs }
  }

  async createAutomation(actor: Actor, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Создаёт автоматизации администратор филиала')
    const catalog = this.automationCatalog()
    const triggerType = String(input.triggerType ?? 'MANUAL')
    if (!catalog.triggers.some((item) => item.value === triggerType)) throw badRequest('Неизвестное событие автоматизации')
    if (triggerType === 'SCHEDULE' && !String(input.schedule ?? '').trim()) throw badRequest('Для запуска по расписанию укажите время')
    const actions = Array.isArray(input.actions) ? input.actions : []
    for (const raw of actions) {
      const action = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      if (!catalog.actions.some((item) => item.value === String(action.type ?? ''))) throw badRequest('Неизвестное действие автоматизации')
    }
    const automation = await this.prisma.client.aiAutomation.create({
      data: {
        name: String(input.name).slice(0, 150),
        description: input.description ? String(input.description).slice(0, 1000) : null,
        enabled: input.enabled !== false,
        triggerType,
        triggerConfig: (input.triggerConfig ?? {}) as Prisma.InputJsonValue,
        conditions: (input.conditions ?? []) as Prisma.InputJsonValue,
        actions: (input.actions ?? []) as Prisma.InputJsonValue,
        schedule: input.schedule ? String(input.schedule) : null,
        requiresApproval: input.requiresApproval !== false,
        createdById: actor.userId,
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.automation.create', entity: 'AiAutomation', entityId: automation.id })
    return automation
  }

  async updateAutomation(actor: Actor, id: string, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Изменяет автоматизации администратор филиала')
    const existing = await this.prisma.client.aiAutomation.findUnique({ where: { id } })
    if (!existing) throw notFound('Автоматизация не найдена')
    const catalog = this.automationCatalog()
    if (input.triggerType !== undefined && !catalog.triggers.some((item) => item.value === String(input.triggerType))) throw badRequest('Неизвестное событие автоматизации')
    if (Array.isArray(input.actions)) {
      for (const raw of input.actions) {
        const action = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
        if (!catalog.actions.some((item) => item.value === String(action.type ?? ''))) throw badRequest('Неизвестное действие автоматизации')
      }
    }
    const updated = await this.prisma.client.aiAutomation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: String(input.name).slice(0, 150) } : {}),
        ...(input.description !== undefined ? { description: input.description ? String(input.description) : null } : {}),
        ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
        ...(input.triggerType !== undefined ? { triggerType: String(input.triggerType) } : {}),
        ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig as Prisma.InputJsonValue } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions as Prisma.InputJsonValue } : {}),
        ...(input.actions !== undefined ? { actions: input.actions as Prisma.InputJsonValue } : {}),
        ...(input.schedule !== undefined ? { schedule: input.schedule ? String(input.schedule) : null } : {}),
        ...(input.requiresApproval !== undefined ? { requiresApproval: Boolean(input.requiresApproval) } : {}),
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.automation.update', entity: 'AiAutomation', entityId: id })
    return updated
  }

  private async executeActions(
    automation: { id: string; name: string; actions: Prisma.JsonValue },
    actorId: string,
    context: Record<string, unknown> = {},
  ) {
    const actions = Array.isArray(automation.actions) ? automation.actions : []
    const results: Array<{ action: string; status: string; detail?: string }> = []
    for (const raw of actions) {
      const action = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const type = String(action.type ?? '')
      const config = action.config && typeof action.config === 'object' ? (action.config as Record<string, unknown>) : {}
      try {
        if (type === 'NOTIFY_ROLE') {
          const role = String(config.role ?? 'MANAGER') as RoleName
          const users = await this.prisma.client.user.findMany({ where: { role, isActive: true, deletedAt: null }, select: { id: true } })
          if (users.length) {
            await this.prisma.client.notification.createMany({
              data: users.map((user) => ({ userId: user.id, type: 'SYSTEM' as const, title: `Автоматизация: ${automation.name}`, body: String(config.text ?? 'Сработало правило автоматизации') })),
            })
          }
          results.push({ action: type, status: 'DONE', detail: `Уведомлено: ${users.length}` })
        } else if (type === 'NOTIFY_USER') {
          const userId = String(config.userId ?? context.userId ?? '')
          if (!userId) throw badRequest('Не указан получатель')
          await this.notify(userId, `Автоматизация: ${automation.name}`, String(config.text ?? 'Напоминание'))
          results.push({ action: type, status: 'DONE' })
        } else if (type === 'ASSIGN_LEAD') {
          const requestedLeadId = context.leadId ? String(context.leadId) : null
          const lead = requestedLeadId
            ? await this.prisma.client.lead.findFirst({ where: { id: requestedLeadId, status: 'NEW', assignedToId: null }, select: { id: true } })
            : await this.prisma.client.lead.findFirst({ where: { status: 'NEW', assignedToId: null }, orderBy: { createdAt: 'asc' }, select: { id: true } })
          const managers = await this.prisma.client.user.findMany({ where: { role: 'MANAGER', isActive: true, deletedAt: null }, select: { id: true } })
          if (!lead || !managers.length) throw badRequest('Нет менеджера или заявки для распределения')
          const load = await this.prisma.client.lead.groupBy({
            by: ['assignedToId'],
            where: { assignedToId: { in: managers.map((manager) => manager.id) }, status: { in: ['NEW', 'CONTACTED'] } },
            _count: { _all: true },
          })
          const counts = new Map(load.map((row) => [row.assignedToId, row._count._all]))
          const manager = [...managers].sort((left, right) => (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0))[0]!
          await this.prisma.client.lead.update({ where: { id: lead.id }, data: { assignedToId: manager.id } })
          results.push({ action: type, status: 'DONE', detail: `Заявка ${lead.id} назначена менеджеру ${manager.id}` })
        } else if (type === 'CREATE_REPORT') {
          const reportContext = await this.adminContext({ feature: 'manager.report' })
          const report = this.localAnswer('manager.report', { feature: 'manager.report' }, reportContext)
          const request = await this.prisma.client.aiRequest.create({
            data: {
              userId: actorId, feature: 'automation.report', prompt: automation.name,
              response: report.answer,
              sources: reportContext.sources as unknown as Prisma.InputJsonValue,
              assumptions: report.assumptions as unknown as Prisma.InputJsonValue,
              confidence: report.confidence,
              provider: 'local', model: 'automation', status: 'SUCCESS', isFlagged: false,
            },
          })
          await this.notify(actorId, `Автоматический отчёт: ${automation.name}`, 'Черновик отчёта готов в истории AI. Проверьте данные перед отправкой.')
          results.push({ action: type, status: 'DONE', detail: `Отчёт ${request.id}` })
        } else if (type === 'REMINDER') {
          const role = String(config.role ?? 'STUDENT') as RoleName
          const users = await this.prisma.client.user.findMany({ where: { role, isActive: true, deletedAt: null }, select: { id: true } })
          if (users.length) {
            await this.prisma.client.notification.createMany({ data: users.map((user) => ({ userId: user.id, type: 'SYSTEM' as const, title: 'Напоминание ITadis', body: String(config.text ?? 'Проверьте расписание и задания') })) })
          }
          results.push({ action: type, status: 'DONE', detail: `Напоминаний: ${users.length}` })
        } else {
          results.push({ action: type, status: 'SKIPPED', detail: 'Действие не поддерживается' })
        }
      } catch (error) {
        results.push({ action: type, status: 'ERROR', detail: error instanceof Error ? error.message : 'Ошибка' })
      }
      const entry = results[results.length - 1]
      if (entry) {
        await writeAudit({
          actorId,
          action: 'ai.automation.action',
          entity: 'AiAutomation',
          entityId: automation.id,
          metadata: { type: entry.action, status: entry.status, detail: entry.detail ?? null },
        }).catch(() => undefined)
      }
    }
    return results
  }

  async runAutomation(
    id: string,
    actor: Actor,
    approved = false,
    context: Record<string, unknown> = {},
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Запуск автоматизации доступен администратору и менеджеру')
    const automation = await this.prisma.client.aiAutomation.findUnique({ where: { id } })
    if (!automation) throw notFound('Автоматизация не найдена')
    if (!automation.enabled) throw conflict('Автоматизация отключена')

    const merged = { role: actor.role, userId: actor.userId, ...context }
    const inputJson = JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonValue
    const condition = this.evaluateConditions(automation.conditions, merged)
    if (!condition.ok) {
      const reason = condition.reason ?? 'Условия не выполнены'
      const run = await this.prisma.client.aiAutomationRun.create({
        data: {
          automationId: id, status: 'SKIPPED', input: inputJson,
          result: [{ action: 'CONDITIONS', status: 'SKIPPED', detail: reason }] as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      })
      await writeAudit({ actorId: actor.userId, action: 'ai.automation.skip', entity: 'AiAutomationRun', entityId: run.id, metadata: { automationId: id, reason } })
      return { run, requiresApproval: false, skipped: true, result: [{ action: 'CONDITIONS', status: 'SKIPPED', detail: reason }] }
    }

    if (automation.requiresApproval && !approved) {
      const run = await this.prisma.client.aiAutomationRun.create({
        data: { automationId: id, status: 'PENDING_APPROVAL', input: { requestedById: actor.userId, context: inputJson } },
      })
      await this.notifyAutomationApproval(id, automation.name)
      return { run, requiresApproval: true, skipped: false, result: [] }
    }

    const run = await this.prisma.client.aiAutomationRun.create({ data: { automationId: id, status: 'RUNNING', approvedById: approved ? actor.userId : null } })
    try {
      const result = await this.executeActions(automation, actor.userId, merged)
      const finished = await this.prisma.client.aiAutomationRun.update({
        where: { id: run.id },
        data: { status: result.some((item) => item.status === 'ERROR') ? 'PARTIAL' : 'SUCCESS', result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
      })
      await this.prisma.client.aiAutomation.update({ where: { id }, data: { lastRunAt: new Date() } })
      await writeAudit({ actorId: actor.userId, action: 'ai.automation.run', entity: 'AiAutomationRun', entityId: run.id, metadata: { automationId: id, result } })
      return { run: finished, requiresApproval: false, skipped: false, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка автоматизации'
      await this.prisma.client.aiAutomationRun.update({ where: { id: run.id }, data: { status: 'ERROR', error: message, finishedAt: new Date() } })
      await this.reportFailure({ userId: actor.userId, role: actor.role, feature: 'automation', message: automation.name, error: message })
      throw error
    }
  }

  async approveAutomationRun(runId: string, actor: Actor) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Подтверждает запуск администратор или менеджер')
    const run = await this.prisma.client.aiAutomationRun.findUnique({ where: { id: runId }, include: { automation: true } })
    if (!run) throw notFound('Запуск не найден')
    if (run.status !== 'PENDING_APPROVAL') throw conflict('Запуск не ожидает подтверждения')
    if (!run.automation.enabled) throw conflict('Автоматизация отключена')
    const saved = asRecord(run.input)
    const savedContext = asRecord(saved.context)
    const result = await this.executeActions(run.automation, actor.userId, { ...savedContext, role: actor.role, userId: actor.userId })
    const status = result.some((item) => item.status === 'ERROR') ? 'PARTIAL' : 'SUCCESS'
    const updated = await this.prisma.client.aiAutomationRun.update({
      where: { id: runId },
      data: { status, approvedById: actor.userId, result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
    })
    await writeAudit({ actorId: actor.userId, action: 'ai.automation.approve', entity: 'AiAutomationRun', entityId: runId })
    return { run: updated, result }
  }
}
