import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_CODE_ALPHABET,
  buildCertificateHtml,
  certificateFileMatchesMime,
  certificateNumber,
  createVerificationCode,
  escapeHtml,
  isCertificateFileUrl,
} from '../src/modules/certificates/certificates.util.js'
import { certificateIssueSchema } from '../src/modules/certificates/certificates.schemas.js'

describe('сертификат: номер и код', () => {
  it('формирует номер с годом и пятью цифрами', () => {
    expect(certificateNumber(2026, 1)).toBe('CERT-2026-00001')
    expect(certificateNumber(2026, 12345)).toBe('CERT-2026-12345')
  })

  it('генерирует код только из однозначных символов', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = createVerificationCode()
      expect(code).toHaveLength(12)
      for (const symbol of code) expect(CERTIFICATE_CODE_ALPHABET).toContain(symbol)
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('не повторяет коды подряд', () => {
    const codes = new Set(Array.from({ length: 500 }, () => createVerificationCode()))
    expect(codes.size).toBe(500)
  })
})

describe('сертификат: готовый файл', () => {
  const base = {
    studentId: '00000000-0000-4000-8000-000000000001',
    courseId: '00000000-0000-4000-8000-000000000002',
    fileUrl: 'https://itadis.kg/uploads/ready.pdf',
    fileName: 'ready.pdf',
    mimeType: 'application/pdf' as const,
    fileSize: 128 * 1024,
  }

  it('принимает PDF из каталога загрузок', () => {
    expect(certificateIssueSchema.safeParse(base).success).toBe(true)
  })

  it('не позволяет выдать сертификат без загруженного файла', () => {
    const { fileUrl: _fileUrl, ...withoutFile } = base
    expect(certificateIssueSchema.safeParse(withoutFile).success).toBe(false)
  })

  it('отклоняет ссылки вне каталога загрузок и неподдерживаемые форматы', () => {
    expect(isCertificateFileUrl('https://itadis.kg/uploads/ready.pdf')).toBe(true)
    expect(isCertificateFileUrl('https://itadis.kg/uploads/certificates/ready.pdf')).toBe(true)
    expect(isCertificateFileUrl('https://itadis.kg/files/ready.pdf')).toBe(false)
    expect(isCertificateFileUrl('https://itadis.kg/uploads/ready.exe')).toBe(false)
    expect(
      certificateIssueSchema.safeParse({ ...base, fileUrl: 'https://itadis.kg/uploads/ready.exe' }).success,
    ).toBe(false)
  })

  it('сверяет MIME-тип с расширением файла', () => {
    expect(certificateFileMatchesMime('https://itadis.kg/uploads/ready.pdf', 'application/pdf')).toBe(true)
    expect(certificateFileMatchesMime('https://itadis.kg/uploads/ready.jpg', 'image/jpeg')).toBe(true)
    expect(certificateFileMatchesMime('https://itadis.kg/uploads/ready.png', 'application/pdf')).toBe(false)
    expect(
      certificateIssueSchema.safeParse({ ...base, fileUrl: 'https://itadis.kg/uploads/ready.png' }).success,
    ).toBe(false)
  })
})

describe('сертификат: печатная версия', () => {
  const base = {
    number: 'CERT-2026-00007',
    verificationCode: 'ABCD23EFGH45',
    verifyUrl: 'https://itadis.kg/verify/ABCD23EFGH45',
    studentName: 'Адис Исаков',
    courseTitle: 'React: профессиональный уровень',
    issuedAt: new Date('2026-11-19T10:00:00.000Z'),
    grade: 95,
    status: 'ISSUED' as const,
    revokedAt: null,
    revokeReason: null,
    issuedByName: 'Айбек Администратов',
  }

  it('экранирует пользовательские данные', () => {
    expect(escapeHtml('<script>"x"&</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;')
    const html = buildCertificateHtml({ ...base, studentName: '<b>Адис</b>' })
    expect(html).not.toContain('<b>Адис</b>')
    expect(html).toContain('&lt;b&gt;Адис&lt;/b&gt;')
  })

  it('содержит номер, ученика, курс, балл и ссылку проверки', () => {
    const html = buildCertificateHtml(base)
    expect(html).toContain('CERT-2026-00007')
    expect(html).toContain('Адис Исаков')
    expect(html).toContain('React: профессиональный уровень')
    expect(html).toContain('95 / 100')
    expect(html).toContain('https://itadis.kg/verify/ABCD23EFGH45')
    expect(html).toContain('Действителен')
  })

  it('помечает отозванный сертификат и причину', () => {
    const html = buildCertificateHtml({
      ...base,
      status: 'REVOKED',
      revokedAt: new Date('2026-11-20T10:00:00.000Z'),
      revokeReason: 'Выдан по ошибке',
    })
    expect(html).toContain('Отозван')
    expect(html).toContain('Выдан по ошибке')
    expect(html).toContain('недействителен')
  })
})
