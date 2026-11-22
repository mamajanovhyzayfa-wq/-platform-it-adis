import { z } from 'zod'
import {
  CERTIFICATE_FILE_MAX_BYTES,
  CERTIFICATE_FILE_MIME_TYPES,
  certificateFileMatchesMime,
  isCertificateFileUrl,
} from './certificates.util.js'

export const certificateIssueSchema = z
  .object({
    studentId: z.string().uuid(),
    courseId: z.string().uuid(),
    grade: z.number().int().min(0).max(100).optional(),
    expiresAt: z.string().datetime().optional(),
    issuedAt: z.string().datetime().optional(),
    fileUrl: z
      .string()
      .url()
      .max(2048)
      .refine(isCertificateFileUrl, 'Загрузите PDF или изображение сертификата через форму выдачи'),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(CERTIFICATE_FILE_MIME_TYPES),
    fileSize: z.number().int().min(1).max(CERTIFICATE_FILE_MAX_BYTES),
  })
  .strict()
  .refine((value) => certificateFileMatchesMime(value.fileUrl, value.mimeType), {
    path: ['mimeType'],
    message: 'Тип файла не совпадает с расширением загруженного сертификата',
  })

export const certificateQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['ISSUED', 'REVOKED']).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .strict()

export const certificateCandidatesSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()

export const certificateRevokeSchema = z
  .object({ reason: z.string().trim().min(5).max(500) })
  .strict()

export type CertificateIssueInput = z.infer<typeof certificateIssueSchema>
export type CertificateQuery = z.infer<typeof certificateQuerySchema>
export type CertificateRevokeInput = z.infer<typeof certificateRevokeSchema>
export type CertificateCandidatesQuery = z.infer<typeof certificateCandidatesSchema>
