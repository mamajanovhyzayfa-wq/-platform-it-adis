import type { Prisma, RoleName } from '@prisma/client'

export interface UserRoleCounts {
  students: number
  teachers: number
  admins: number
  managers: number
  parents: number
}

export interface UserRoleSummary extends UserRoleCounts {
  total: number
}

/** Единая точка подсчёта: total всегда равен сумме всех пяти ролей. */
export function summarizeUserRoles(counts: UserRoleCounts): UserRoleSummary {
  const { students, teachers, admins, managers, parents } = counts
  return {
    students,
    teachers,
    admins,
    managers,
    parents,
    total: students + teachers + admins + managers + parents,
  }
}

export interface UpdateUserInput {
  firstName?: string
  lastName?: string
  role?: RoleName
  isActive?: boolean
}

/**
 * Данные обновления пользователя администратором. Для ролей с обязательным
 * профилем (STUDENT, TEACHER, PARENT) вложенный connectOrCreate создаёт
 * отсутствующий профиль или переиспользует существующий, не перезаписывая
 * его поля. Prisma выполняет вложенную запись атомарно вместе с ролью.
 */
export function userUpdateData(
  userId: string,
  input: UpdateUserInput,
  currentRole: RoleName,
): Prisma.UserUpdateInput {
  const nextRole = input.role ?? currentRole
  const profileLink = {
    connectOrCreate: {
      where: { userId },
      create: {},
    },
  }

  return {
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.lastName ? { lastName: input.lastName } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(nextRole === 'STUDENT' ? { studentProfile: profileLink } : {}),
    ...(nextRole === 'TEACHER' ? { teacherProfile: profileLink } : {}),
    ...(nextRole === 'PARENT' ? { parentProfile: profileLink } : {}),
  }
}
