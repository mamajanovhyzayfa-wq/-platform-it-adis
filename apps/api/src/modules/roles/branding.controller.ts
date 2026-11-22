import { Controller, Get, NotFoundException } from '@nestjs/common'
import { env } from '../../config/env.js'
import { getTenant } from '../../lib/tenant.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { Public } from '../../nest/common/decorators.js'

/** Публичные поля страницы входа филиала. Остальное из Branch.config не отдаётся. */
export interface BranchBranding {
  name: string
  isPrimary: boolean
  /** Адрес главного сайта, если филиал живёт на отдельном домене. */
  mainSiteUrl: string | null
  logoUrl: string | null
  description: string | null
  contacts: { phone?: string; email?: string; address?: string } | null
  directions: { title: string; description?: string }[]
}

/**
 * Брендинг филиала для страницы входа. Филиал определяется по Host (tenant middleware),
 * параметр из запроса в выборе филиала не участвует.
 */
@Controller('api/branding')
export class BrandingController {
  @Public()
  @Get()
  async get(): Promise<BranchBranding> {
    const tenant = getTenant()
    if (!tenant) throw new NotFoundException('Филиал не определён')

    const branch = await controlPrisma.branch.findUnique({
      where: { id: tenant.branchId },
      select: { name: true, isPrimary: true, adminEmail: true, config: true },
    })
    if (!branch) throw new NotFoundException('Филиал не найден')

    const config = (branch.config ?? {}) as Record<string, unknown>
    const rawContacts = config.contacts
    const contacts: NonNullable<BranchBranding['contacts']> =
      rawContacts && typeof rawContacts === 'object' ? { ...(rawContacts as Record<string, string>) } : {}
    // Контактный email филиала — его администратор; он не является секретом.
    if (!contacts.email) contacts.email = branch.adminEmail
    const directions: BranchBranding['directions'] = Array.isArray(config.directions)
      ? config.directions
          .map((item) => {
            if (typeof item === 'string') return { title: item }
            if (item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string') {
              const value = item as { title: string; description?: unknown }
              return {
                title: value.title,
                ...(typeof value.description === 'string' ? { description: value.description } : {}),
              }
            }
            return null
          })
          .filter((item): item is BranchBranding['directions'][number] => Boolean(item))
      : []

    return {
      name: branch.name,
      isPrimary: branch.isPrimary,
      mainSiteUrl: env.PRIMARY_DOMAIN ? `https://${env.PRIMARY_DOMAIN}` : null,
      logoUrl: typeof config.logoUrl === 'string' ? config.logoUrl : null,
      description: typeof config.description === 'string' ? config.description : null,
      contacts,
      directions,
    }
  }
}
