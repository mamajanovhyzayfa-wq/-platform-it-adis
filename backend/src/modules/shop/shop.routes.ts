import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'

export const shopRouter = Router()

const orderSchema = z.object({
  productId: z.string().uuid(),
  comment: z.string().trim().max(500).optional(),
})

const orderStatusSchema = z.object({
  status: z.enum(['APPROVED', 'ISSUED', 'REJECTED']),
})

const productSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(2000),
  imageUrl: z.string().url().max(2048).optional(),
  category: z.string().trim().min(2).max(40),
  priceCoins: z.number().int().min(1).max(100000),
  stock: z.number().int().min(0).max(100000),
  terms: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
})

const productUpdateSchema = productSchema.partial()

shopRouter.get('/products', requireAuth, async (_req, res) => {
  const items = await prisma.shopProduct.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { priceCoins: 'asc' }],
  })
  res.json({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
      category: item.category,
      priceCoins: item.priceCoins,
      stock: item.stock,
      terms: item.terms,
    })),
  })
})

/** Покупка: списание и остаток меняются в одной транзакции, баланс считает сервер. */
shopRouter.post('/orders', requireAuth, requireRole('STUDENT'), validate(orderSchema), async (req, res) => {
  const userId = req.auth!.userId
  const { productId, comment } = req.body

  const order = await prisma.$transaction(async (tx) => {
    const product = await tx.shopProduct.findUnique({ where: { id: productId } })
    if (!product || !product.isActive) throw notFound('Товар недоступен')
    if (product.stock <= 0) throw conflict('Товара нет в наличии')

    const balance = await tx.coinBalance.findUnique({ where: { userId } })
    if ((balance?.balance ?? 0) < product.priceCoins) {
      throw conflict(`Недостаточно изикоинов: нужно ${product.priceCoins}, на балансе ${balance?.balance ?? 0}`)
    }

    await tx.shopProduct.update({ where: { id: productId }, data: { stock: { decrement: 1 } } })
    await tx.coinTransaction.create({
      data: {
        userId,
        amount: -product.priceCoins,
        reason: `Заявка в магазине: ${product.title}`,
        sourceType: 'SHOP',
      },
    })
    await tx.coinBalance.update({ where: { userId }, data: { balance: { decrement: product.priceCoins } } })

    return tx.shopOrder.create({
      data: { productId, userId, comment },
      include: { product: { select: { id: true, title: true, priceCoins: true } } },
    })
  })

  await prisma.notification.create({
    data: {
      userId,
      type: 'SHOP_ORDER',
      title: 'Заявка отправлена',
      body: `«${order.product.title}» ждёт подтверждения администратора`,
    },
  })

  res.status(201).json({
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    product: order.product,
  })
})

/** История заявок: ученик видит свои, администратор — все. */
shopRouter.get('/orders', requireAuth, async (req, res) => {
  const auth = req.auth!
  const where = auth.role === 'ADMIN' ? {} : { userId: auth.userId }

  const items = await prisma.shopOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      product: { select: { id: true, title: true, priceCoins: true, category: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })

  res.json({
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      comment: item.comment,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      product: item.product,
      user: auth.role === 'ADMIN' ? item.user : undefined,
    })),
  })
})

/** Подтверждение или отклонение: при отклонении монеты и остаток возвращаются. */
shopRouter.patch('/orders/:id', requireAuth, requireRole('ADMIN'), validate(orderStatusSchema), async (req, res) => {
  const auth = req.auth!
  const order = await prisma.shopOrder.findUnique({
    where: { id: String(req.params.id) },
    include: { product: true },
  })
  if (!order) throw notFound('Заявка не найдена')
  if (order.status === req.body.status) {
    res.json({ id: order.id, status: order.status })
    return
  }

  if (req.body.status === 'REJECTED') {
    if (order.status === 'REJECTED') throw badRequest('Заявка уже отклонена')

    await prisma.$transaction([
      prisma.shopOrder.update({
        where: { id: order.id },
        data: { status: 'REJECTED', processedById: auth.userId },
      }),
      prisma.shopProduct.update({ where: { id: order.productId }, data: { stock: { increment: 1 } } }),
      prisma.coinTransaction.create({
        data: {
          userId: order.userId,
          amount: order.product.priceCoins,
          reason: `Возврат за заявку: ${order.product.title}`,
          awardedById: auth.userId,
          sourceType: 'SHOP',
        },
      }),
      prisma.coinBalance.upsert({
        where: { userId: order.userId },
        update: { balance: { increment: order.product.priceCoins } },
        create: { userId: order.userId, balance: order.product.priceCoins },
      }),
      prisma.notification.create({
        data: {
          userId: order.userId,
          type: 'SHOP_ORDER',
          title: 'Заявка отклонена',
          body: `«${order.product.title}»: изикоины возвращены на баланс`,
        },
      }),
    ])
  } else {
    await prisma.shopOrder.update({
      where: { id: order.id },
      data: { status: req.body.status, processedById: auth.userId },
    })
    await prisma.notification.create({
      data: {
        userId: order.userId,
        type: 'SHOP_ORDER',
        title: req.body.status === 'ISSUED' ? 'Награда выдана' : 'Заявка одобрена',
        body: `«${order.product.title}»`,
      },
    })
  }

  await writeAudit({
    actorId: auth.userId,
    action: 'shop.order.status',
    entity: 'ShopOrder',
    entityId: order.id,
    metadata: { from: order.status, to: req.body.status },
    ip: req.ip,
  })

  res.json({ id: order.id, status: req.body.status })
})

shopRouter.post('/products', requireAuth, requireRole('ADMIN'), validate(productSchema), async (req, res) => {
  const product = await prisma.shopProduct.create({ data: req.body })
  await writeAudit({
    actorId: req.auth!.userId,
    action: 'shop.product.create',
    entity: 'ShopProduct',
    entityId: product.id,
    metadata: { title: product.title, priceCoins: product.priceCoins },
    ip: req.ip,
  })
  res.status(201).json(product)
})

shopRouter.patch('/products/:id', requireAuth, requireRole('ADMIN'), validate(productUpdateSchema), async (req, res) => {
  const product = await prisma.shopProduct.findUnique({ where: { id: String(req.params.id) } })
  if (!product) throw notFound('Товар не найден')

  const updated = await prisma.shopProduct.update({ where: { id: product.id }, data: req.body })
  await writeAudit({
    actorId: req.auth!.userId,
    action: 'shop.product.update',
    entity: 'ShopProduct',
    entityId: product.id,
    metadata: req.body as Record<string, unknown>,
    ip: req.ip,
  })
  res.json(updated)
})
