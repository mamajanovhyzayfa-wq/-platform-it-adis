import { z } from 'zod'

export function ageYears(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1
  return age
}

const birthDateSchema = z.coerce
  .date()
  .refine((date) => date.getTime() < Date.now(), 'Дата рождения должна быть в прошлом')
  .refine((date) => ageYears(date) <= 100, 'Проверьте дату рождения')

export const passwordSchema = z
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
    birthDate: birthDateSchema,
    locale: z.enum(['ru', 'ky', 'en']).default('ru'),
    acceptTerms: z.literal(true, { message: 'Нужно принять условия использования' }),
    acceptPrivacy: z.literal(true, { message: 'Нужно принять политику конфиденциальности' }),
    acceptDataProcessing: z.literal(true, { message: 'Нужно согласие на обработку персональных данных' }),
    guardianName: z.string().trim().min(2).max(120).optional(),
    guardianPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{9,15}$/, 'Телефон представителя в формате +996700000000')
      .optional(),
    guardianConsent: z.boolean().default(false),
    deviceId: z.string().trim().min(4).max(120).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    path: ['passwordRepeat'],
    message: 'Пароли не совпадают',
  })
  .refine(
    (data) =>
      ageYears(data.birthDate) >= 18 ||
      Boolean(data.guardianName && data.guardianPhone && data.guardianConsent),
    {
      path: ['guardianConsent'],
      message: 'Для несовершеннолетних нужны данные и подтверждение законного представителя',
    },
  )

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Укажите email или телефон'),
  password: z.string().min(1, 'Введите пароль'),
  deviceId: z.string().trim().min(4).max(120).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  captchaId: z.string().trim().max(80).optional(),
  captchaAnswer: z.string().trim().max(20).optional(),
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
