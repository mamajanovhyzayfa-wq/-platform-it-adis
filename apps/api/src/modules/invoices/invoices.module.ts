import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const invoicesOptions: ReadModelOptions = {
  slug: 'invoices',
  model: 'invoice',
  entity: 'Счёт',
  roles: ['ADMIN', 'MANAGER', 'STUDENT'],
  scope: (user) => (user.role === 'STUDENT' ? { studentId: user.userId } : {}),
  searchFields: ['number', 'description', 'periodMonth'],
  querySchema: z.object({
    studentId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
  }),
  filters: (query) => ({
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.courseId ? { courseId: query.courseId } : {}),
  }),
  select: {
    id: true,
    number: true,
    studentId: true,
    courseId: true,
    description: true,
    amount: true,
    dueAt: true,
    status: true,
    periodMonth: true,
    createdAt: true,
    student: { select: { id: true, firstName: true, lastName: true, email: true } },
    course: { select: { id: true, title: true } },
    _count: { select: { payments: true, discounts: true } },
  },
  orderBy: { createdAt: 'desc' },
}

const InvoicesService = createReadService(invoicesOptions)
const InvoicesController = createReadController(invoicesOptions, InvoicesService)

@Module({ controllers: [InvoicesController], providers: [InvoicesService] })
export class InvoicesModule {}
