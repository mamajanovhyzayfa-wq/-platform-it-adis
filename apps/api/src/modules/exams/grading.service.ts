import { Inject, Injectable } from '@nestjs/common'
import { badRequest, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { z } from 'zod'
import type { gradingScaleSchema } from '../../modules/assessment/assessment.schemas.js'

type ScaleInput = z.infer<typeof gradingScaleSchema>

/**
 * Академическая шкала оценивания филиала.
 * Шкала создаётся администратором: обязательных диапазонов платформа не навязывает,
 * и IT Coins к академическим оценкам не относятся.
 */
@Injectable()
export class GradingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list() {
    const scales = await this.prisma.client.gradingScale.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { bands: { orderBy: { position: 'asc' } }, _count: { select: { tests: true, exams: true, homework: true } } },
    })
    return {
      items: scales.map((scale) => ({
        id: scale.id,
        name: scale.name,
        description: scale.description,
        isDefault: scale.isDefault,
        bands: scale.bands,
        usage: { tests: scale._count.tests, exams: scale._count.exams, homework: scale._count.homework },
        updatedAt: scale.updatedAt,
      })),
    }
  }

  private validateBands(input: ScaleInput) {
    const bands = [...input.bands].sort((a, b) => a.minPercent - b.minPercent)
    for (const band of bands) {
      if (band.maxPercent < band.minPercent) throw badRequest(`Диапазон «${band.label}»: максимум меньше минимума`)
    }
    for (let index = 1; index < bands.length; index += 1) {
      const previous = bands[index - 1]
      const current = bands[index]
      if (previous && current && current.minPercent <= previous.maxPercent) {
        throw badRequest(`Диапазоны «${previous.label}» и «${current.label}» пересекаются`)
      }
    }
    return bands
  }

  async create(input: ScaleInput, userId: string) {
    const bands = this.validateBands(input)
    const scale = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) await tx.gradingScale.updateMany({ data: { isDefault: false } })
      return tx.gradingScale.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          isDefault: input.isDefault,
          createdById: userId,
          bands: {
            create: bands.map((band, position) => ({
              minPercent: band.minPercent,
              maxPercent: band.maxPercent,
              label: band.label,
              description: band.description ?? null,
              position,
            })),
          },
        },
        include: { bands: { orderBy: { position: 'asc' } } },
      })
    })
    await writeAudit({ actorId: userId, action: 'grading.scale.create', entity: 'GradingScale', entityId: scale.id })
    return scale
  }

  async update(scaleId: string, input: ScaleInput, userId: string) {
    const existing = await this.prisma.client.gradingScale.findUnique({ where: { id: scaleId }, select: { id: true } })
    if (!existing) throw notFound('Шкала не найдена')
    const bands = this.validateBands(input)

    const scale = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) await tx.gradingScale.updateMany({ where: { id: { not: scaleId } }, data: { isDefault: false } })
      await tx.gradingBand.deleteMany({ where: { scaleId } })
      return tx.gradingScale.update({
        where: { id: scaleId },
        data: {
          name: input.name,
          description: input.description ?? null,
          isDefault: input.isDefault,
          bands: {
            create: bands.map((band, position) => ({
              minPercent: band.minPercent,
              maxPercent: band.maxPercent,
              label: band.label,
              description: band.description ?? null,
              position,
            })),
          },
        },
        include: { bands: { orderBy: { position: 'asc' } } },
      })
    })
    await writeAudit({ actorId: userId, action: 'grading.scale.update', entity: 'GradingScale', entityId: scaleId })
    return scale
  }

  async remove(scaleId: string, userId: string) {
    const existing = await this.prisma.client.gradingScale.findUnique({ where: { id: scaleId }, select: { id: true } })
    if (!existing) throw notFound('Шкала не найдена')
    await this.prisma.client.gradingScale.delete({ where: { id: scaleId } })
    await writeAudit({ actorId: userId, action: 'grading.scale.delete', entity: 'GradingScale', entityId: scaleId })
  }

  async setDefault(scaleId: string, userId: string) {
    const existing = await this.prisma.client.gradingScale.findUnique({ where: { id: scaleId }, select: { id: true } })
    if (!existing) throw notFound('Шкала не найдена')
    await this.prisma.client.$transaction([
      this.prisma.client.gradingScale.updateMany({ data: { isDefault: false } }),
      this.prisma.client.gradingScale.update({ where: { id: scaleId }, data: { isDefault: true } }),
    ])
    await writeAudit({ actorId: userId, action: 'grading.scale.default', entity: 'GradingScale', entityId: scaleId })
  }
}
