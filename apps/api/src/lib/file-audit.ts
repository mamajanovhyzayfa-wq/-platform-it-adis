import { prisma } from './prisma.js'

interface FileAuditInput {
  userId?: string | null
  fileId?: string | null
  action: 'UPLOAD' | 'DOWNLOAD' | 'UPDATE' | 'DELETE'
  fileName: string
  url?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  sha256?: string | null
  scanStatus?: string
  ip?: string | null
  userAgent?: string | null
}

/** Журнал файловых операций не должен ломать загрузку/скачивание. */
export async function writeFileAudit(input: FileAuditInput): Promise<void> {
  try {
    await prisma.fileAuditLog.create({
      data: {
        userId: input.userId ?? null,
        fileId: input.fileId ?? null,
        action: input.action,
        fileName: input.fileName.slice(0, 255),
        url: input.url ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        sha256: input.sha256 ?? null,
        scanStatus: input.scanStatus ?? 'CLEAN',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  } catch (error) {
    console.warn('[file-audit] не удалось записать событие', error instanceof Error ? error.message : error)
  }
}
