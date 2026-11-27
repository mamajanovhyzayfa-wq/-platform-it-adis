import { randomInt } from 'node:crypto'

/** Символы кода проверки без похожих 0/O и 1/I — код диктуют по телефону. */
export const CERTIFICATE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CERTIFICATE_CODE_LENGTH = 12

/** Готовый сертификат: только PDF и растровые изображения без прозрачных форматов. */
export const CERTIFICATE_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type CertificateFileMimeType = (typeof CERTIFICATE_FILE_MIME_TYPES)[number]

export const CERTIFICATE_FILE_MAX_BYTES = 10 * 1024 * 1024

const CERTIFICATE_FILE_EXTENSIONS: Record<CertificateFileMimeType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

export function certificateFileExtension(mimeType: string): string | undefined {
  return CERTIFICATE_FILE_EXTENSIONS[mimeType as CertificateFileMimeType]
}

/**
 * Ссылка на готовый документ: API-эндпоинт загрузки (новый формат) или
 * прямой путь /uploads (файлы, загруженные раньше). Расширение обязательно.
 */
export function isCertificateFileUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const allowed =
      url.pathname.startsWith('/api/uploads/certificates/') || url.pathname.startsWith('/uploads/')
    return allowed && /\.(pdf|jpe?g|png|webp)$/i.test(url.pathname)
  } catch {
    return false
  }
}

/** Проверяет, что расширение файла соответствует заявленному MIME-типу. */
export function certificateFileMatchesMime(fileUrl: string, mimeType: string): boolean {
  const extension = certificateFileExtension(mimeType)
  if (!extension) return false
  try {
    return new URL(fileUrl).pathname.toLowerCase().endsWith(extension)
  } catch {
    return false
  }
}

/** Номер сертификата: CERT-2026-00042. */
export function certificateNumber(year: number, value: number): string {
  return `CERT-${year}-${String(value).padStart(5, '0')}`
}

/** Публичный код проверки: 12 символов, ~59 бит энтропии. */
export function createVerificationCode(length = CERTIFICATE_CODE_LENGTH): string {
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += CERTIFICATE_CODE_ALPHABET[randomInt(CERTIFICATE_CODE_ALPHABET.length)]
  }
  return code
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface CertificateDocument {
  number: string
  verificationCode: string
  verifyUrl: string
  studentName: string
  courseTitle: string
  issuedAt: Date
  grade: number | null
  status: 'ISSUED' | 'REVOKED'
  revokedAt: Date | null
  revokeReason: string | null
  issuedByName: string
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(value)
}

/**
 * Печатная версия сертификата: самостоятельный HTML без внешних ресурсов,
 * поэтому одинаково открывается в окне панели и сохраняется в PDF.
 */
export function buildCertificateHtml(data: CertificateDocument): string {
  const revoked = data.status === 'REVOKED'
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Сертификат ${escapeHtml(data.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #f3f4f6; font-family: 'Segoe UI', system-ui, sans-serif; color: #111827; }
  .sheet { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 48px 56px; box-shadow: 0 20px 45px rgba(15, 23, 42, .08); }
  .brand { display: flex; justify-content: space-between; align-items: center; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #6b7280; }
  .mark { width: 44px; height: 44px; border-radius: 12px; background: #2563eb; color: #fff; display: grid; place-items: center; font-weight: 700; letter-spacing: .04em; }
  h1 { margin: 36px 0 8px; font-size: 34px; line-height: 1.2; }
  .lead { margin: 0; color: #6b7280; }
  .student { margin: 28px 0 4px; font-size: 30px; font-weight: 700; }
  .course { font-size: 20px; color: #1f2937; }
  .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 32px; margin: 34px 0 0; padding: 22px 0 0; border-top: 1px solid #e5e7eb; font-size: 14px; }
  .meta div { display: flex; justify-content: space-between; gap: 16px; }
  .meta span { color: #6b7280; }
  .code { margin-top: 28px; padding: 16px 18px; border-radius: 12px; background: #f9fafb; border: 1px dashed #d1d5db; font-size: 14px; }
  .code strong { font-family: ui-monospace, monospace; letter-spacing: .12em; }
  .revoked { margin-top: 24px; padding: 14px 18px; border-radius: 12px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; font-size: 14px; }
  .footer { margin-top: 34px; display: flex; justify-content: space-between; gap: 24px; font-size: 12px; color: #6b7280; }
  .sign { text-align: right; }
  .sign-line { display: inline-block; min-width: 220px; border-top: 1px solid #9ca3af; padding-top: 6px; }
  .print { max-width: 900px; margin: 0 auto 16px; text-align: right; }
  .print button { padding: 10px 18px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; font-size: 14px; cursor: pointer; }
  @media print {
    body { padding: 0; background: #fff; }
    .sheet { border: 0; box-shadow: none; border-radius: 0; padding: 24mm; }
    .print { display: none; }
  }
</style>
</head>
<body>
  <div class="print"><button type="button" onclick="window.print()">Сохранить в PDF</button></div>
  <main class="sheet">
    <div class="brand"><span>ITadis · образовательный центр</span><span class="mark">IA</span></div>
    <h1>Сертификат об окончании курса</h1>
    <p class="lead">Настоящим подтверждается, что</p>
    <div class="student">${escapeHtml(data.studentName)}</div>
    <div class="course">успешно завершил(а) курс «${escapeHtml(data.courseTitle)}»</div>
    <div class="meta">
      <div><span>Номер</span><strong>${escapeHtml(data.number)}</strong></div>
      <div><span>Дата выдачи</span><strong>${escapeHtml(formatDate(data.issuedAt))}</strong></div>
      ${data.grade !== null ? `<div><span>Итоговый балл</span><strong>${data.grade} / 100</strong></div>` : ''}
      <div><span>Статус</span><strong>${revoked ? 'Отозван' : 'Действителен'}</strong></div>
    </div>
    ${revoked ? `<div class="revoked"><strong>Сертификат отозван и недействителен${data.revokedAt ? ` ${escapeHtml(formatDate(data.revokedAt))}` : ''}.</strong>${data.revokeReason ? ` Причина: ${escapeHtml(data.revokeReason)}` : ''}</div>` : ''}
    <div class="code">
      Код проверки: <strong>${escapeHtml(data.verificationCode)}</strong><br />
      Проверить подлинность: ${escapeHtml(data.verifyUrl)}
    </div>
    <div class="footer">
      <div>Документ сформирован системой ITadis. Подлинность проверяется по коду на сайте центра.</div>
      <div class="sign"><span class="sign-line">${escapeHtml(data.issuedByName)}</span></div>
    </div>
  </main>
</body>
</html>`
}
