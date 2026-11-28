import { Module } from '@nestjs/common'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

const materialsOptions: ReadModelOptions = {
  slug: 'materials',
  model: 'lessonMaterial',
  entity: 'Учебный материал',
  roles: ['ADMIN', 'MANAGER', 'TEACHER'],
  searchFields: ['title', 'mimeType'],
  select: {
    id: true,
    type: true,
    title: true,
    url: true,
    mimeType: true,
    sizeBytes: true,
    createdAt: true,
    lesson: {
      select: {
        id: true,
        title: true,
        module: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
      },
    },
  },
  orderBy: { createdAt: 'desc' },
}

const MaterialsService = createReadService(materialsOptions)
const MaterialsController = createReadController(materialsOptions, MaterialsService)

@Module({ controllers: [MaterialsController], providers: [MaterialsService] })
export class MaterialsModule {}
