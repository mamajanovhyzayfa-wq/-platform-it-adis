import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { forbidden, notFound } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'

export const knowledgeRouter = Router()

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  type: z.enum(['VIDEO', 'DOCUMENT', 'PRESENTATION', 'IMAGE', 'LINK']).optional(),
  sort: z.enum(['new', 'popular']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const materialSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(2000),
  coverUrl: z.string().url().max(2048).optional(),
  type: z.enum(['VIDEO', 'DOCUMENT', 'PRESENTATION', 'IMAGE', 'LINK']).default('VIDEO'),
  videoUrl: z.string().url().max(2048).optional(),
  content: z.string().max(50000).optional(),
  fileUrl: z.string().url().max(2048).optional(),
  durationMinutes: z.number().int().min(0).max(600).default(0),
  isPublished: z.boolean().default(true),
})

const materialUpdateSchema = materialSchema.partial()

type ListQuery = z.infer<typeof listSchema>

knowledgeRouter.get('/categories', requireAuth, async (_req, res) => {
  const categories = await prisma.knowledgeCategory.findMany({
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    include: { _count: { select: { materials: { where: { isPublished: true } } } } },
  })

  res.json({
    items: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      title: category.title,
      icon: category.icon,
      materials: category._count.materials,
    })),
  })
})

knowledgeRouter.get('/materials', requireAuth, validate(listSchema, 'query'), async (req, res) => {
  const query = req.query as unknown as ListQuery
  const userId = req.auth!.userId

  const where = {
    isPublished: true,
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [total, materials, favorites] = await Promise.all([
    prisma.knowledgeMaterial.count({ where }),
    prisma.knowledgeMaterial.findMany({
      where,
      orderBy:
        query.sort === 'popular'
          ? [{ views: { _count: 'desc' } }, { createdAt: 'desc' }]
          : { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        category: { select: { slug: true, title: true } },
        author: { select: { firstName: true, lastName: true } },
        _count: { select: { views: true } },
      },
    }),
    prisma.knowledgeFavorite.findMany({ where: { userId }, select: { materialId: true } }),
  ])

  const favoriteIds = new Set(favorites.map((item) => item.materialId))

  res.json({
    items: materials.map((material) => ({
      id: material.id,
      title: material.title,
      description: material.description,
      coverUrl: material.coverUrl,
      type: material.type,
      durationMinutes: material.durationMinutes,
      createdAt: material.createdAt,
      category: material.category,
      author: `${material.author.firstName} ${material.author.lastName}`,
      views: material._count.views,
      isFavorite: favoriteIds.has(material.id),
    })),
    total,
    page: query.page,
    limit: query.limit,
  })
})

knowledgeRouter.get('/materials/:id', requireAuth, async (req, res) => {
  const userId = req.auth!.userId
  const material = await prisma.knowledgeMaterial.findFirst({
    where: { id: String(req.params.id), ...(req.auth!.role === 'STUDENT' ? { isPublished: true } : {}) },
    include: {
      category: { select: { id: true, slug: true, title: true } },
      author: { select: { firstName: true, lastName: true } },
      _count: { select: { views: true } },
    },
  })
  if (!material) throw notFound('Материал не найден')

  await prisma.knowledgeView.upsert({
    where: { materialId_userId: { materialId: material.id, userId } },
    create: { materialId: material.id, userId },
    update: { viewedAt: new Date() },
  })

  const favorite = await prisma.knowledgeFavorite.findUnique({
    where: { materialId_userId: { materialId: material.id, userId } },
  })

  res.json({
    id: material.id,
    title: material.title,
    description: material.description,
    coverUrl: material.coverUrl,
    type: material.type,
    videoUrl: material.videoUrl,
    content: material.content,
    fileUrl: material.fileUrl,
    durationMinutes: material.durationMinutes,
    createdAt: material.createdAt,
    category: material.category,
    author: `${material.author.firstName} ${material.author.lastName}`,
    views: material._count.views + 1,
    isFavorite: Boolean(favorite),
  })
})

knowledgeRouter.post('/materials/:id/favorite', requireAuth, async (req, res) => {
  const material = await prisma.knowledgeMaterial.findFirst({
    where: { id: String(req.params.id), isPublished: true },
    select: { id: true },
  })
  if (!material) throw notFound('Материал не найден')

  await prisma.knowledgeFavorite.upsert({
    where: { materialId_userId: { materialId: material.id, userId: req.auth!.userId } },
    create: { materialId: material.id, userId: req.auth!.userId },
    update: {},
  })

  res.status(201).json({ isFavorite: true })
})

knowledgeRouter.delete('/materials/:id/favorite', requireAuth, async (req, res) => {
  await prisma.knowledgeFavorite.deleteMany({
    where: { materialId: String(req.params.id), userId: req.auth!.userId },
  })
  res.json({ isFavorite: false })
})

knowledgeRouter.get('/favorites', requireAuth, async (req, res) => {
  const favorites = await prisma.knowledgeFavorite.findMany({
    where: { userId: req.auth!.userId, material: { isPublished: true } },
    orderBy: { createdAt: 'desc' },
    include: {
      material: {
        include: {
          category: { select: { slug: true, title: true } },
          _count: { select: { views: true } },
        },
      },
    },
  })

  res.json({
    items: favorites.map((item) => ({
      id: item.material.id,
      title: item.material.title,
      description: item.material.description,
      type: item.material.type,
      durationMinutes: item.material.durationMinutes,
      category: item.material.category,
      views: item.material._count.views,
      isFavorite: true,
    })),
  })
})

knowledgeRouter.get('/history', requireAuth, async (req, res) => {
  const views = await prisma.knowledgeView.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { viewedAt: 'desc' },
    take: 50,
    include: { material: { include: { category: { select: { slug: true, title: true } } } } },
  })

  res.json({
    items: views.map((item) => ({
      id: item.material.id,
      title: item.material.title,
      type: item.material.type,
      category: item.material.category,
      viewedAt: item.viewedAt,
    })),
  })
})

/** Рекомендации: материалы из категорий, которые ученик уже смотрел, но ещё не открывал. */
knowledgeRouter.get('/recommendations', requireAuth, async (req, res) => {
  const userId = req.auth!.userId

  const viewed = await prisma.knowledgeView.findMany({
    where: { userId },
    select: { material: { select: { categoryId: true } } },
    take: 50,
  })
  const viewedMaterials = await prisma.knowledgeView.findMany({
    where: { userId },
    select: { materialId: true },
  })
  const categoryIds = [...new Set(viewed.map((item) => item.material.categoryId))]
  const viewedIds = viewedMaterials.map((item) => item.materialId)

  const items = await prisma.knowledgeMaterial.findMany({
    where: {
      isPublished: true,
      ...(categoryIds.length > 0 ? { categoryId: { in: categoryIds } } : {}),
      ...(viewedIds.length > 0 ? { id: { notIn: viewedIds } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { category: { select: { slug: true, title: true } } },
  })

  res.json({
    items: items.map((material) => ({
      id: material.id,
      title: material.title,
      description: material.description,
      type: material.type,
      durationMinutes: material.durationMinutes,
      category: material.category,
      isFavorite: false,
    })),
  })
})

knowledgeRouter.post('/materials', requireAuth, requireRole('TEACHER', 'ADMIN'), validate(materialSchema), async (req, res) => {
  const material = await prisma.knowledgeMaterial.create({
    data: { ...req.body, authorId: req.auth!.userId },
  })

  await writeAudit({
    actorId: req.auth!.userId,
    action: 'knowledge.material.create',
    entity: 'KnowledgeMaterial',
    entityId: material.id,
    metadata: { title: material.title },
    ip: req.ip,
  })

  res.status(201).json(material)
})

knowledgeRouter.patch('/materials/:id', requireAuth, requireRole('TEACHER', 'ADMIN'), validate(materialUpdateSchema), async (req, res) => {
  const material = await prisma.knowledgeMaterial.findUnique({ where: { id: String(req.params.id) } })
  if (!material) throw notFound('Материал не найден')
  if (req.auth!.role !== 'ADMIN' && material.authorId !== req.auth!.userId) {
    throw forbidden('Можно редактировать только свои материалы')
  }

  const updated = await prisma.knowledgeMaterial.update({ where: { id: material.id }, data: req.body })

  await writeAudit({
    actorId: req.auth!.userId,
    action: 'knowledge.material.update',
    entity: 'KnowledgeMaterial',
    entityId: material.id,
    metadata: req.body as Record<string, unknown>,
    ip: req.ip,
  })

  res.json(updated)
})
