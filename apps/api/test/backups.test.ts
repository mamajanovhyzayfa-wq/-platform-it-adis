import { describe, expect, it } from 'vitest'
import type { BackupRun } from '@prisma/client'
import { buildRestorePlan, restoreConfirmationPhrase } from '../src/modules/backups/backup.service.js'

function makeRun(overrides: Partial<BackupRun> = {}): BackupRun {
  return {
    id: 'backup-1',
    branchId: 'branch-1',
    kind: 'DATABASE',
    status: 'SUCCEEDED',
    storageKey: 'backups/osh/database/2026-11-22.dump',
    sizeBytes: BigInt(1024),
    sha256: 'abc123',
    startedAt: new Date('2026-11-22T00:00:00.000Z'),
    finishedAt: null,
    verifiedAt: new Date('2026-11-22T00:05:00.000Z'),
    error: null,
    metadata: null,
    ...overrides,
  } as BackupRun
}

describe('восстановление филиала: план и подтверждение', () => {
  it('строит все семь шагов процедуры и предупреждение', () => {
    const plan = buildRestorePlan({
      branch: { id: 'branch-1', slug: 'osh', name: 'Ош' },
      databaseBackup: makeRun(),
      filesBackup: null,
    })

    expect(plan.steps).toHaveLength(7)
    expect(plan.steps.join(' ')).toContain('Обнаружение проблемы')
    expect(plan.steps.join(' ')).toContain('Проверка целостности')
    expect(plan.warning).toContain('не запускается автоматически')
    expect(plan.approvalPhrase).toBe('RESTORE osh')
  })

  it('фиксирует проверенные хеши и размеры обеих копий', () => {
    const plan = buildRestorePlan({
      branch: { id: 'branch-1', slug: 'osh', name: 'Ош' },
      databaseBackup: makeRun(),
      filesBackup: makeRun({
        id: 'backup-files',
        kind: 'FILES',
        sizeBytes: BigInt(2048),
        sha256: 'def456',
      }),
    })

    expect(plan.checks.database).toMatchObject({ sha256: 'abc123', sizeBytes: 1024 })
    expect(plan.checks.files).toMatchObject({ sha256: 'def456', sizeBytes: 2048 })
    expect(plan.steps.join(' ')).toContain('tar -tzf')
  })

  it('требует точную фразу с slug филиала', () => {
    expect(restoreConfirmationPhrase('osh')).toBe('RESTORE osh')
    expect(restoreConfirmationPhrase('bishkek')).not.toBe(restoreConfirmationPhrase('osh'))
  })
})
