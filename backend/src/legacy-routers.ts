import type { Router } from 'express'
import { homeworkRouter } from './modules/homework/homework.routes.js'
import { testsRouter } from './modules/tests/tests.routes.js'
import { notificationsRouter } from './modules/notifications/notifications.routes.js'
import { coinsRouter } from './modules/coins/coins.routes.js'
import { videoRouter } from './modules/video/video.routes.js'
import { adminRouter } from './modules/admin/admin.routes.js'
import { shopRouter } from './modules/shop/shop.routes.js'
import { achievementsRouter } from './modules/achievements/achievements.routes.js'
import { knowledgeRouter } from './modules/knowledge/knowledge.routes.js'
import { messagesRouter } from './modules/messages/messages.routes.js'
import { uploadsRouter } from './modules/uploads/uploads.routes.js'
import { aiRouter } from './modules/ai/ai.routes.js'

export interface LegacyMount {
  prefix: string
  router: Router
}

/**
 * Express-роутеры, ещё не перенесённые в Nest-контроллеры.
 *
 * Они подключаются к тому же HTTP-серверу и переиспользуют общие middleware,
 * Prisma-клиент и JWT-утилиты, поэтому API не распадается на два приложения.
 * Перенос модуля = замена строки здесь на Nest-контроллер.
 *
 * Уже перенесены: auth (/api/auth), users (/api/users), courses и модули (/api/courses,
 * /api/modules), lessons (/api/lessons), кабинет преподавателя (/api/teacher)
 * и расписание (/api/schedule) — см. src/nest/modules.
 */
export const legacyMounts: LegacyMount[] = [
  { prefix: '/api/homework', router: homeworkRouter },
  { prefix: '/api/tests', router: testsRouter },
  { prefix: '/api/notifications', router: notificationsRouter },
  { prefix: '/api/coins', router: coinsRouter },
  { prefix: '/api/video', router: videoRouter },
  { prefix: '/api/admin', router: adminRouter },
  { prefix: '/api/shop', router: shopRouter },
  { prefix: '/api/achievements', router: achievementsRouter },
  { prefix: '/api/knowledge', router: knowledgeRouter },
  { prefix: '/api/messages', router: messagesRouter },
  { prefix: '/api/uploads', router: uploadsRouter },
  { prefix: '/api/ai', router: aiRouter },
]
