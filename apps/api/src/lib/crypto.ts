import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Шифрование особо чувствительных полей приложения (AES-256-GCM).
 * Ключ берётся из DATA_ENCRYPTION_KEY. Если он не задан, используется
 * детерминированный ключ из JWT_ACCESS_SECRET — это позволяет локально
 * запускать проект, но в production ключ должен быть отдельным.
 */
const PREFIX = 'enc:v1:'

function key(): Buffer {
  const source = env.DATA_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET
  return createHash('sha256').update(source).digest()
}

export function encryptSensitive(value: string): string {
  if (!value || value.startsWith(PREFIX)) return value
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

/** Расшифровывает новое значение; старые незашифрованные значения читаются как есть. */
export function decryptSensitive(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith(PREFIX)) return value
  try {
    const [ivPart, tagPart, dataPart] = value.slice(PREFIX.length).split('.')
    if (!ivPart || !tagPart || !dataPart) return null
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
