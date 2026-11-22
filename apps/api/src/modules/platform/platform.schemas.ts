import { z } from 'zod'

export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email'),
  password: z.string().min(1, 'Укажите пароль').max(200),
})

export const branchCreateSchema = z.object({
  name: z.string().trim().min(2, 'Укажите название').max(120),
  domain: z.string().trim().min(3, 'Укажите домен').max(253),
  slug: z.string().trim().max(40).optional(),
  adminEmail: z.string().trim().toLowerCase().email('Некорректный email администратора'),
  adminName: z.string().trim().min(2, 'Укажите имя администратора').max(120),
  locale: z.enum(['ru', 'ky', 'en']).optional(),
  timezone: z.string().trim().max(64).optional(),
  // Публичная страница филиала. Все поля необязательны: без них используются
  // понятные значения по умолчанию, но контакты и направления лучше задать сразу.
  logoUrl: z.string().trim().max(500).optional(),
  description: z.string().trim().max(1200).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.string().trim().max(200).optional(),
  contactAddress: z.string().trim().max(300).optional(),
  directions: z.string().trim().max(1200).optional(),
})

export const branchActivateSchema = z.object({
  confirm: z.literal(true, { message: 'Подтвердите активацию филиала' }),
})
