import type { RoleName } from '@prisma/client'
import type { z } from 'zod'
import type { AuthUser } from '../../nest/common/decorators.js'

/**
 * Описание read-модели доменного модуля.
 *
 * Модуль не дублирует уже существующие write-сценарии: он даёт стабильный
 * контракт чтения для административной панели, мобильного приложения и
 * внешних интеграций. Запись остаётся в каноническом модуле домена.
 */
export interface ReadModelOptions {
  /** URL-сегмент: /api/students. */
  slug: string
  /** Имя модели Prisma в camelCase. */
  model: string
  /** Человекочитаемое имя сущности для документации и ошибок. */
  entity: string
  /** Роли, которым разрешено чтение. */
  roles: RoleName[]
  /** Поля полнотекстового поиска (contains, insensitive). */
  searchFields?: string[]
  /** Поля, доступные в ответе. select и include взаимоисключающие. */
  select?: Record<string, unknown>
  include?: Record<string, unknown>
  /** Постоянный фильтр домена (например, type = COMPETITION). */
  baseWhere?: Record<string, unknown>
  /** Дополнительные query-параметры и их zod-схемы. */
  querySchema?: z.ZodObject<z.ZodRawShape>
  /** Преобразует проверенные query-параметры в Prisma where. */
  filters?: (query: Record<string, unknown>) => Record<string, unknown>
  /** Ограничивает выборку данными текущего пользователя. */
  scope?: (user: AuthUser) => Record<string, unknown>
  /** Сортировка по умолчанию. */
  orderBy?: Record<string, 'asc' | 'desc'>
  /** Использовать управляющую БД (реестр филиалов) вместо БД филиала. */
  controlPlane?: boolean
}
