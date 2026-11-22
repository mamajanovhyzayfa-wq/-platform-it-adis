import type { SessionRole } from '../api/client'
import { currentLocale, translate } from '../i18n'

/** Геттеры читают активный язык в момент отрисовки, поэтому старые вызовы
 * `roleLabels[role]` автоматически получают перевод без правки каждого экрана. */
export const roleLabels: Record<SessionRole, string> = {
  get ADMIN() {
    return translate(currentLocale(), 'role.ADMIN')
  },
  get MANAGER() {
    return translate(currentLocale(), 'role.MANAGER')
  },
  get TEACHER() {
    return translate(currentLocale(), 'role.TEACHER')
  },
  get STUDENT() {
    return translate(currentLocale(), 'role.STUDENT')
  },
  get PARENT() {
    return translate(currentLocale(), 'role.PARENT')
  },
}

/** Кабинет роли: после входа пользователь попадает сразу в свой раздел. */
export const cabinetByRole: Record<SessionRole, string> = {
  ADMIN: '/admin',
  MANAGER: '/manager',
  TEACHER: '/mentor',
  STUDENT: '/student',
  PARENT: '/parent',
}

export function homeForRole(role: SessionRole | undefined | null): string {
  return role ? cabinetByRole[role] : '/login'
}
