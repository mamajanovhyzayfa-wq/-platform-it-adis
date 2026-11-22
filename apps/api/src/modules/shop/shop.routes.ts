import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { EconomyService } from '../economy/economy.service.js'
import { orderSchema, orderUpdateSchema, productSchema, productUpdateSchema } from '../economy/economy.schemas.js'

/**
 * Legacy-маршруты магазина. Оставлены для совместимости со старыми клиентами,
 * но работают через EconomyService: цифровые награды выдаются автоматически,
 * физические требуют согласования, а запас по умолчанию не ограничен.
 */
export const shopRouter = Router()
const economy = new EconomyService(new PrismaService())

function queryString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

shopRouter.get('/products', requireAuth, async (req, res) => {
  const items = await economy.shopProducts(
    req.auth!.userId,
    {
      search: queryString(req.query.search),
      category: queryString(req.query.category),
      favorite: req.query.favorite === 'true',
    },
    req.auth!.role,
  )
  res.json({ items })
})

shopRouter.post('/orders', requireAuth, requireRole('STUDENT', 'TEACHER'), validate(orderSchema), async (req, res) => {
  const order = await economy.createOrder(req.auth!.userId, req.auth!.role, req.body)
  res.status(201).json(order)
})

shopRouter.get('/orders', requireAuth, async (req, res) => {
  const result = await economy.orders(req.auth!.userId, req.auth!.role, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 100,
  })
  res.json(result)
})

shopRouter.patch('/orders/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validate(orderUpdateSchema), async (req, res) => {
  const order = await economy.updateOrder(
    { userId: req.auth!.userId, role: req.auth!.role },
    String(req.params.id),
    req.body,
  )
  res.json(order)
})

shopRouter.post('/products', requireAuth, requireRole('ADMIN'), validate(productSchema), async (req, res) => {
  const product = await economy.createProduct(
    { userId: req.auth!.userId, role: req.auth!.role },
    req.body as Record<string, unknown>,
  )
  res.status(201).json(product)
})

shopRouter.patch('/products/:id', requireAuth, requireRole('ADMIN'), validate(productUpdateSchema), async (req, res) => {
  const product = await economy.updateProduct(
    { userId: req.auth!.userId, role: req.auth!.role },
    String(req.params.id),
    req.body as Record<string, unknown>,
  )
  res.json(product)
})
