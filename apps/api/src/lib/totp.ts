import { createHmac, randomBytes } from 'node:crypto'

/**
 * TOTP (RFC 6238) без внешних зависимостей: секрет в base32, код 6 цифр, шаг 30 секунд.
 * Совместимо с Google Authenticator, Authy и 1Password.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Некорректный base32-секрет')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

function generateTotpCode(secret: string, timestamp = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timestamp / 1000 / stepSeconds)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const at = (index: number) => digest[index] ?? 0
  const offset = at(digest.length - 1) & 0x0f
  const code =
    (((at(offset) & 0x7f) << 24) | (at(offset + 1) << 16) | (at(offset + 2) << 8) | at(offset + 3)) %
    10 ** digits
  return String(code).padStart(digits, '0')
}

/** Проверяет код в окне ±window шагов: компенсирует расхождение часов. */
export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const now = Date.now()
  for (let offset = -window; offset <= window; offset += 1) {
    if (generateTotpCode(secret, now + offset * 30_000) === normalized) return true
  }
  return false
}

/** Ссылка для приложения-аутентификатора. */
export function totpUri(secret: string, account: string, issuer = 'IT Adis'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
