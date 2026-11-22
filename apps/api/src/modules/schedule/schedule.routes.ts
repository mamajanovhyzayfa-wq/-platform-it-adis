import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import { requireAuth } from '../../middleware/auth.js'

export const scheduleRouter = Router()

/** Занятия текущего пользователя: ученик видит курсы, на которые записан, преподаватель — свои. */
scheduleRouter.get('/', requireAuth, async (req, res) => {
  const auth = req.auth!

  const where =
    auth.role === 'TEACHER'
      ? { course: { teacherId: auth.userId } }
      : auth.role === 'ADMIN'
        ? {}
        : { course: { enrollments: { some: { studentId: auth.userId } } } }

  const items = await prisma.schedule.findMany({
    where,
    include: {
      course: { select: { id: true, title: true, teacher: { select: { firstName: true, lastName: true } } } },
      room: { select: { id: true, status: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 100,
  })

  res.json({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timezone: item.timezone,
      status: item.status,
      course: { id: item.course.id, title: item.course.title },
      teacher: `${item.course.teacher.firstName} ${item.course.teacher.lastName}`,
      hasRoom: Boolean(item.room),
    })),
  })
})
