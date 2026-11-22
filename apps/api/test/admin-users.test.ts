import { describe, expect, it } from 'vitest'
import { summarizeUserRoles, userUpdateData } from '../src/modules/admin/admin.users.js'

describe('админ-панель: сводка пользователей', () => {
  it('считает users.total по всем пяти ролям', () => {
    expect(
      summarizeUserRoles({ students: 412, teachers: 23, admins: 3, managers: 7, parents: 96 }),
    ).toEqual({
      students: 412,
      teachers: 23,
      admins: 3,
      managers: 7,
      parents: 96,
      total: 541,
    })
  })
})

describe('админ-панель: смена роли', () => {
  it.each([
    ['STUDENT', 'studentProfile'],
    ['TEACHER', 'teacherProfile'],
    ['PARENT', 'parentProfile'],
  ] as const)('при переводе в %s создаёт или переиспользует %s', (role, relation) => {
    expect(userUpdateData('user-1', { role }, 'ADMIN')).toEqual({
      role,
      [relation]: {
        connectOrCreate: {
          where: { userId: 'user-1' },
          create: {},
        },
      },
    })
  })

  it('восстанавливает профиль при обычном редактировании пользователя с профильной ролью', () => {
    expect(userUpdateData('user-1', { firstName: 'Айгуль' }, 'STUDENT')).toMatchObject({
      firstName: 'Айгуль',
      studentProfile: { connectOrCreate: { where: { userId: 'user-1' } } },
    })
  })

  it('не создаёт профили для ADMIN и MANAGER', () => {
    expect(userUpdateData('user-1', { role: 'MANAGER' }, 'ADMIN')).toEqual({ role: 'MANAGER' })
  })
})
