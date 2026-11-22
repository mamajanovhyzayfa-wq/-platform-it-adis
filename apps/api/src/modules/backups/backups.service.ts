import { Injectable } from '@nestjs/common'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { getTenant } from '../../lib/tenant.js'
import { writeAudit } from '../../lib/audit.js'
import { storageDriver } from '../../lib/file-storage.js'
import {
  approveRestore,
  backupRootInfo,
  createRestoreRequest,
  executeRestore,
  runBackup,
  serializeRun,
  verifyBackupRun,
} from './backup.service.js'
import type { BackupSettingsInput } from './backups.schemas.js'

@Injectable()
export class BackupsService {
  private branchId(): string {
    const tenant = getTenant()
    if (!tenant) throw unauthorized('Филиал не определён')
    return tenant.branchId
  }

  async overview() {
    const branches = await controlPrisma.branch.findMany({
      where: { id: this.branchId() },
      orderBy: { name: 'asc' },
      include: {
        backupRuns: { orderBy: { startedAt: 'desc' }, take: 5 },
        restoreRequests: { orderBy: { detectedAt: 'desc' }, take: 5 },
      },
    })
    return {
      storageDriver: storageDriver(),
      backup: backupRootInfo(),
      branches: branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        status: branch.status,
        isPrimary: branch.isPrimary,
        backupEnabled: branch.backupEnabled,
        backupFrequencyHours: branch.backupFrequencyHours,
        backupRetentionDays: branch.backupRetentionDays,
        backupIncludeFiles: branch.backupIncludeFiles,
        lastBackupAt: branch.lastBackupAt,
        lastBackupStatus: branch.lastBackupStatus,
        fileMaxSizeMb: branch.fileMaxSizeMb,
        fileQuotaMb: branch.fileQuotaMb,
        recentRuns: branch.backupRuns.map(serializeRun),
        recentRestores: branch.restoreRequests,
      })),
    }
  }

  async runs() {
    const runs = await controlPrisma.backupRun.findMany({
      where: { branchId: this.branchId() },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: { branch: { select: { name: true, slug: true } } },
    })
    return {
      items: runs.map((run) => ({
        ...serializeRun(run),
        branch: { name: run.branch.name, slug: run.branch.slug },
      })),
    }
  }

  async run(kind: 'DATABASE' | 'FILES', requestedBranchId?: string) {
    const branchId = this.branchId()
    if (requestedBranchId && requestedBranchId !== branchId) {
      throw forbidden('Можно управлять только своим филиалом')
    }
    const run = await runBackup(branchId, kind)
    return run ? serializeRun(run) : { status: 'ALREADY_RUNNING' as const }
  }

  async verify(id: string) {
    const existing = await controlPrisma.backupRun.findUnique({ where: { id } })
    if (!existing || existing.branchId !== this.branchId()) throw notFound('Резервная копия не найдена')
    return serializeRun(await verifyBackupRun(existing.id))
  }

  async updateSettings(branchId: string, input: BackupSettingsInput, actorId: string) {
    const branch = await controlPrisma.branch.findUnique({ where: { id: branchId } })
    if (!branch || branch.id !== this.branchId()) throw forbidden('Можно настроить только свой филиал')

    const fileMaxSizeMb = input.fileMaxSizeMb ?? branch.fileMaxSizeMb
    const fileQuotaMb = input.fileQuotaMb ?? branch.fileQuotaMb
    if (fileQuotaMb < fileMaxSizeMb) {
      throw badRequest('Квота филиала не может быть меньше лимита одного файла')
    }

    const updated = await controlPrisma.branch.update({ where: { id: branch.id }, data: input })
    await writeAudit({
      actorId,
      action: 'backup.settings.update',
      entity: 'Branch',
      entityId: updated.id,
      metadata: input,
    })
    return {
      id: updated.id,
      backupEnabled: updated.backupEnabled,
      backupFrequencyHours: updated.backupFrequencyHours,
      backupRetentionDays: updated.backupRetentionDays,
      backupIncludeFiles: updated.backupIncludeFiles,
      fileMaxSizeMb: updated.fileMaxSizeMb,
      fileQuotaMb: updated.fileQuotaMb,
    }
  }

  async restores() {
    const items = await controlPrisma.restoreRequest.findMany({
      where: { branchId: this.branchId() },
      orderBy: { detectedAt: 'desc' },
      take: 100,
      include: {
        branch: { select: { name: true, slug: true } },
        backup: { select: { kind: true, startedAt: true } },
      },
    })
    return { items }
  }

  async createRestore(input: {
    branchId?: string
    backupId: string
    filesBackupId?: string
    reason?: string
    requestedBy: string
  }) {
    const branchId = this.branchId()
    if (input.branchId && input.branchId !== branchId) throw forbidden('Можно восстановить только свой филиал')
    return createRestoreRequest({
      branchId,
      backupId: input.backupId,
      filesBackupId: input.filesBackupId,
      reason: input.reason,
      requestedBy: input.requestedBy,
    })
  }

  async approve(id: string, phrase: string, approvedBy: string) {
    const existing = await controlPrisma.restoreRequest.findUnique({ where: { id } })
    if (!existing || existing.branchId !== this.branchId()) throw notFound('Заявка не найдена')
    return approveRestore({ restoreId: id, approvedBy, phrase })
  }

  async execute(id: string) {
    const existing = await controlPrisma.restoreRequest.findUnique({ where: { id } })
    if (!existing || existing.branchId !== this.branchId()) throw notFound('Заявка не найдена')
    return executeRestore(existing.id)
  }

  async cancel(id: string) {
    const request = await controlPrisma.restoreRequest.findUnique({ where: { id } })
    if (!request || request.branchId !== this.branchId()) throw notFound('Заявка не найдена')
    if (['RUNNING', 'VERIFIED', 'FAILED'].includes(request.status)) {
      throw conflict('Завершённую заявку нельзя отменить')
    }
    const cancelled = await controlPrisma.restoreRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ['DETECTED', 'CHECKED', 'PLANNED', 'AWAITING_APPROVAL', 'APPROVED'] },
      },
      data: { status: 'CANCELLED' },
    })
    if (cancelled.count !== 1) throw conflict('Заявка уже выполняется или завершена')
    return controlPrisma.restoreRequest.findUniqueOrThrow({ where: { id: request.id } })
  }
}
