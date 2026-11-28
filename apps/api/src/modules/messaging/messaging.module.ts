import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const messagingOptions: ReadModelOptions = {
  slug: 'messaging',
  model: 'conversation',
  entity: 'Диалог',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'],
  baseWhere: { isArchived: false },
  scope: (user) =>
    user.role === 'ADMIN' || user.role === 'MANAGER'
      ? {}
      : { participants: { some: { userId: user.userId } } },
  searchFields: ['title', 'description'],
  querySchema: z.object({ courseId: z.string().uuid().optional() }),
  filters: (query) => (query.courseId ? { courseId: query.courseId } : {}),
  select: {
    id: true,
    type: true,
    title: true,
    description: true,
    courseId: true,
    createdById: true,
    isPinned: true,
    updatedAt: true,
    participants: {
      select: {
        userId: true,
        lastReadAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    },
    messages: {
      take: 1,
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true, senderId: true, createdAt: true },
    },
  },
  orderBy: { updatedAt: 'desc' },
}

const MessagingService = createReadService(messagingOptions)
const MessagingController = createReadController(messagingOptions, MessagingService)

@Module({ controllers: [MessagingController], providers: [MessagingService] })
export class MessagingModule {}
