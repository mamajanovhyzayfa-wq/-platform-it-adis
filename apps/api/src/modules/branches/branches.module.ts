import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

/** Реестр филиалов живёт в управляющей БД (control plane), не в БД филиала. */
export const branchesOptions: ReadModelOptions = {
  slug: 'branches',
  model: 'branch',
  entity: 'Филиал',
  roles: ['ADMIN'],
  controlPlane: true,
  searchFields: ['name', 'slug', 'domain', 'adminEmail'],
  select: {
    id: true,
    name: true,
    slug: true,
    domain: true,
    status: true,
    isPrimary: true,
    adminEmail: true,
    adminName: true,
    backupEnabled: true,
    backupFrequencyHours: true,
    backupRetentionDays: true,
    lastBackupAt: true,
    lastBackupStatus: true,
    provisionedAt: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'asc' },
}

const BranchesService = createReadService(branchesOptions)
const BranchesController = createReadController(branchesOptions, BranchesService)

@Module({ controllers: [BranchesController], providers: [BranchesService] })
export class BranchesModule {}
