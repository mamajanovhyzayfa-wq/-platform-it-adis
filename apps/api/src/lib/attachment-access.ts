import type { RoleName } from '@prisma/client'
import { getTenant } from './tenant.js'

/** Запись о вложении в БД текущего филиала; null — файла нет в реестре. */
export async function findAttachmentOwner(name: string): Promise<string | null> {
  const prisma = getTenant()?.prisma
  if (!prisma) return null
  const attachment = await prisma.attachment.findUnique({ where: { name }, select: { ownerId: true } })
  return attachment?.ownerId ?? null
}

/**
 * Правило доступа: владелец файла или супер-админ.
 *
 * Файлы без записи (загруженные до появления реестра) не имеют установленного
 * владельца, поэтому для всех, кроме администратора, доступ закрыт.
 */
export function canReadAttachment(input: {
  ownerId: string | null
  userId: string | null
  role: RoleName | null
}): boolean {
  if (input.role === 'ADMIN') return true
  if (!input.ownerId || !input.userId) return false
  return input.ownerId === input.userId
}
