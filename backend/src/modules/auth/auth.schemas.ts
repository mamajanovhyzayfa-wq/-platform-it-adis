import { z } from 'zod'

const passwordSchema = z
  .string()
  .min(8, 'Минимум 8 символов')
  .max(128, 'Слишком длинный пароль')
  .regex(/[a-zа-яё]/i, 'Нужна хотя бы одна буква')
  .regex(/[A-ZА-ЯЁ]/, 'Нужна хотя бы одна заглавная буква')
  .regex(/\d/, 'Нужна хотя бы одна цифра')

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, 'Укажите имя').max(60),
    lastName: z.string().trim().min(2, 'Укажите фамилию').max(60),
    email: z.string().trim().toLowerCase().email('Некорректный email'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{9,15}$/, 'Телефон в формате +996700000000')
      .optional(),
    password: passwordSchema,
    passwordRepeat: z.string(),
    birthDate: z.coerce.date().optional(),
    locale: z.enum(['ru', 'ky', 'en']).default('ru'),
    acceptTerms: z.literal(true, { message: 'Нужно принять условия использования' }),
    acceptPrivacy: z.literal(true, { message: 'Нужно принять политику конфиденциальности' }),
    guardianName: z.string().trim().max(120).optional(),
    guardianPhone: z.string().trim().max(30).optional(),
    deviceId: z.string().trim().min(4).max(120).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    path: ['passwordRepeat'],
    message: 'Пароли не совпадают',
  })
  .refine(
    (data) => {
      if (!data.birthDate) return true
      const age = (Date.now() - data.birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      return age >= 18 || Boolean(data.guardianName && data.guardianPhone)
    },
    { path: ['guardianName'], message: 'Для несовершеннолетних нужны данные законного представителя' },
  )

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Укажите email или телефон'),
  password: z.string().min(1, 'Введите пароль'),
  deviceId: z.string().trim().min(4).max(120).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Некорректный refresh-токен'),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email'),
})

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: passwordSchema,
    passwordRepeat: z.string(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    path: ['passwordRepeat'],
    message: 'Пароли не совпадают',
  })

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
