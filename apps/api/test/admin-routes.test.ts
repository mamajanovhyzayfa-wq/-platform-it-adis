import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  type Role = 'ADMIN' | 'MANAGER' | 'TEACHER' | 'STUDENT' | 'PARENT'
  type User = {
    id: string
    email: string
    phone: string | null
    firstName: string
    lastName: string
    role: Role
    isActive: boolean
    deletedAt: Date | null
    lastLoginAt: Date | null
    createdAt: Date
  }
  type Profile = { id: string; userId: string; workplace?: string | null }

  const now = new Date('2026-11-22T00:00:00.000Z')
  const users: User[] = []
  const students: Profile[] = []
  const teachers: Profile[] = []
  const parents: Profile[] = []
  const auditLogs: Array<Record<string, unknown>> = []

  const reset = () => {
    users.length = 0
    students.length = 0
    teachers.length = 0
    parents.length = 0
    auditLogs.length = 0
    users.push(
      { id: '11111111-1111-4111-8111-111111111111', email: 'admin@itadis.kg', phone: null, firstName: 'Азамат', lastName: 'Админов', role: 'ADMIN', isActive: true, deletedAt: null, lastLoginAt: now, createdAt: now },
      { id: '22222222-2222-4222-8222-222222222222', email: 'manager@itadis.kg', phone: null, firstName: 'Гүлнара', lastName: 'Менеджерова', role: 'MANAGER', isActive: true, deletedAt: null, lastLoginAt: now, createdAt: now },
      { id: '33333333-3333-4333-8333-333333333333', email: 'teacher@itadis.kg', phone: null, firstName: 'Эрмек', lastName: 'Учителев', role: 'TEACHER', isActive: true, deletedAt: null, lastLoginAt: now, createdAt: now },
      { id: '44444444-4444-4444-8444-444444444444', email: 'student@itadis.kg', phone: null, firstName: 'Айбек', lastName: 'Асанов', role: 'STUDENT', isActive: true, deletedAt: null, lastLoginAt: now, createdAt: now },
      { id: '55555555-5555-4555-8555-555555555555', email: 'parent@itadis.kg', phone: null, firstName: 'Гүлмира', lastName: 'Асанова', role: 'PARENT', isActive: true, deletedAt: null, lastLoginAt: now, createdAt: now },
      { id: '66666666-6666-4666-8666-666666666666', email: 'target@itadis.kg', phone: null, firstName: 'Нурзада', lastName: 'Токтогулова', role: 'STUDENT', isActive: true, deletedAt: null, lastLoginAt: null, createdAt: now },
    )
    students.push({ id: 'student-profile-1', userId: '44444444-4444-4444-8444-444444444444' })
    teachers.push({ id: 'teacher-profile-1', userId: '33333333-3333-4333-8333-333333333333' })
    parents.push({ id: 'parent-profile-1', userId: '55555555-5555-4555-8555-555555555555', workplace: 'ОсОО «Альфа»' })
  }

  const ensureProfile = (store: Profile[], prefix: string, nested?: { where: { userId: string } }) => {
    if (!nested) return
    if (store.some((profile) => profile.userId === nested.where.userId)) return
    store.push({ id: `${prefix}-${store.length + 1}`, userId: nested.where.userId })
  }

  const userFindFirst = vi.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
    const user = users.find((item) => item.id === where.id)
    if (!user) return null
    if (where.deletedAt === null && user.deletedAt !== null) return null
    return { ...user }
  })

  const userUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
    const user = users.find((item) => item.id === where.id)
    if (!user) throw new Error(`Пользователь ${where.id} не найден`)

    if (data.firstName !== undefined) user.firstName = data.firstName
    if (data.lastName !== undefined) user.lastName = data.lastName
    if (data.role !== undefined) user.role = data.role
    if (data.isActive !== undefined) user.isActive = data.isActive

    // Повторяем смысл nested connectOrCreate: существующий профиль не дублируется.
    ensureProfile(students, 'student-profile', data.studentProfile?.connectOrCreate)
    ensureProfile(teachers, 'teacher-profile', data.teacherProfile?.connectOrCreate)
    ensureProfile(parents, 'parent-profile', data.parentProfile?.connectOrCreate)

    return { ...user }
  })

  const userCount = vi.fn(
    async ({ where }: { where?: { role?: Role; deletedAt?: null } } = {}) =>
      users.filter(
        (user) =>
          (!where?.role || user.role === where.role) &&
          (where?.deletedAt !== null || user.deletedAt === null),
      ).length,
  )

  const count = vi.fn(async () => 0)
  const findMany = vi.fn(async () => [])
  const auditCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    auditLogs.push(data)
    return { id: `audit-${auditLogs.length}`, ...data }
  })
  const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))

  return {
    users,
    students,
    teachers,
    parents,
    auditLogs,
    reset,
    userFindFirst,
    userUpdate,
    userCount,
    count,
    findMany,
    auditCreate,
    transaction,
  }
})

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: { findFirst: db.userFindFirst, update: db.userUpdate, count: db.userCount },
    course: { count: db.count },
    courseEnrollment: { count: db.count },
    schedule: { count: db.count },
    homework: { count: db.count },
    auditLog: { findMany: db.findMany, create: db.auditCreate },
    $transaction: db.transaction,
  },
  defaultPrisma: {},
}))

import { errorHandler } from '../src/lib/errors.js'
import { signAccessToken, signStepUpToken } from '../src/lib/security.js'
import { adminRouter } from '../src/modules/admin/admin.routes.js'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use(errorHandler)

const adminToken = signAccessToken({ sub: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', email: 'admin@itadis.kg' })
const stepUpToken = signStepUpToken('11111111-1111-4111-8111-111111111111')

beforeEach(() => {
  vi.clearAllMocks()
  db.reset()
})

const profileCases = [
  { role: 'PARENT', relation: 'parentProfile', store: 'parents', targetId: '66666666-6666-4666-8666-666666666666' },
  { role: 'STUDENT', relation: 'studentProfile', store: 'students', targetId: '33333333-3333-4333-8333-333333333333' },
  { role: 'TEACHER', relation: 'teacherProfile', store: 'teachers', targetId: '66666666-6666-4666-8666-666666666666' },
] as const

describe('PATCH /api/admin/users/:id', () => {
  it.each(profileCases)('перевод в $role создаёт профиль $relation', async ({ role, relation, store, targetId }) => {
    const response = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ role })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: targetId, role })
    expect(db.userUpdate).toHaveBeenCalledWith({
      where: { id: targetId },
      data: expect.objectContaining({
        role,
        [relation]: {
          connectOrCreate: {
            where: { userId: targetId },
            create: {},
          },
        },
      }),
    })
    expect(db[store].filter((profile) => profile.userId === targetId)).toHaveLength(1)
    expect(db.auditLogs[0]).toMatchObject({
      actorId: '11111111-1111-4111-8111-111111111111',
      action: 'admin.user.update',
      entity: 'User',
      entityId: targetId,
    })
  })

  const existingProfiles = [
    { userId: '44444444-4444-4444-8444-444444444444', store: 'students', profileId: 'student-profile-1' },
    { userId: '33333333-3333-4333-8333-333333333333', store: 'teachers', profileId: 'teacher-profile-1' },
    { userId: '55555555-5555-4555-8555-555555555555', store: 'parents', profileId: 'parent-profile-1' },
  ] as const

  it.each(existingProfiles)('не дублирует профиль при редактировании $userId', async ({ userId, store, profileId }) => {
    const response = await request(app)
      .patch(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ firstName: 'Обновлено' })

    expect(response.status).toBe(200)
    expect(response.body.firstName).toBe('Обновлено')
    expect(db[store].filter((profile) => profile.userId === userId)).toEqual([
      expect.objectContaining({ id: profileId, userId }),
    ])
  })
})

describe('GET /api/admin/dashboard', () => {
  it('возвращает users.total как сумму всех пяти ролей', async () => {
    const response = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(response.status).toBe(200)
    expect(response.body.users).toEqual({
      students: 2,
      teachers: 1,
      admins: 1,
      managers: 1,
      parents: 1,
      total: 6,
    })
  })
})
