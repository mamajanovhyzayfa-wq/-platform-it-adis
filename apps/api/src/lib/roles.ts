import type { RoleName } from '@prisma/client'

/** Пять стандартных ролей платформы. Произвольные роли не создаются. */
export const STANDARD_ROLES: RoleName[] = ['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN', 'PARENT']

export function isStandardRole(value: unknown): value is RoleName {
  return typeof value === 'string' && STANDARD_ROLES.includes(value as RoleName)
}

/** Заголовок выбранного интерфейса роли. Значение проверяется по подтверждённым грантам. */
export const ACTIVE_ROLE_HEADER = 'x-active-role'

export function readActiveRoleHeader(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}
