import { z } from 'zod'
import { ageYears, passwordSchema } from '../../modules/auth/auth.schemas.js'

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{9,15}$/, 'Телефон в формате +996700000000')
  .optional()

const roleForApplication = z.enum(['STUDENT', 'TEACHER', 'PARENT']).default('STUDENT')

const birthDate = z.coerce
  .date()
  .refine((date) => date.getTime() < Date.now(), 'Дата рождения должна быть в прошлом')
  .refine((date) => ageYears(date) <= 100, 'Проверьте дату рождения')

const guardianName = z.string().trim().min(2).max(120).optional()
const guardianPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{9,15}$/, 'Телефон представителя в формате +996700000000')
  .optional()

export const registrationApplySchema = z
  .object({
    firstName: z.string().trim().min(2, 'Укажите имя').max(60),
    lastName: z.string().trim().min(2, 'Укажите фамилию').max(60),
    email: z.string().trim().toLowerCase().email('Некорректный email'),
    phone,
    password: passwordSchema,
    passwordRepeat: z.string(),
    role: roleForApplication,
    message: z.string().trim().max(500).optional(),
    inviteCode: z.string().trim().max(120).optional(),
    birthDate,
    guardianName,
    guardianPhone,
    guardianConsent: z.boolean().default(false),
    locale: z.enum(['ru', 'ky', 'en']).default('ru'),
    acceptTerms: z.literal(true, { message: 'Примите пользовательское соглашение' }),
    acceptPrivacy: z.literal(true, { message: 'Примите политику конфиденциальности' }),
    acceptDataProcessing: z.literal(true, { message: 'Согласитесь на обработку персональных данных' }),
    acceptMarketing: z.boolean().default(false),
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

export const registrationDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export const invitationCreateSchema = z
  .object({
    channel: z.enum(['LINK', 'CODE', 'EMAIL', 'PHONE']),
    role: z.enum(['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN', 'PARENT']).default('STUDENT'),
    email: z.string().trim().toLowerCase().email('Некорректный email').optional(),
    phone,
    note: z.string().trim().max(300).optional(),
    ttlHours: z.coerce.number().int().min(1).max(720).default(72),
  })
  .refine((data) => data.channel !== 'EMAIL' || Boolean(data.email), {
    path: ['email'],
    message: 'Для приглашения на email укажите адрес',
  })
  .refine((data) => data.channel !== 'PHONE' || Boolean(data.phone), {
    path: ['phone'],
    message: 'Для приглашения на телефон укажите номер',
  })

export const invitationAcceptSchema = z
  .object({
    code: z.string().trim().min(4, 'Введите код приглашения').max(120),
    firstName: z.string().trim().min(2, 'Укажите имя').max(60),
    lastName: z.string().trim().min(2, 'Укажите фамилию').max(60),
    email: z.string().trim().toLowerCase().email('Некорректный email'),
    phone,
    birthDate,
    guardianName,
    guardianPhone,
    guardianConsent: z.boolean().default(false),
    password: passwordSchema,
    passwordRepeat: z.string(),
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

export const passwordRecoveryRequestSchema = z.object({
  identifier: z.string().trim().min(3, 'Укажите email или телефон'),
})

export const passwordRecoveryConfirmSchema = z
  .object({
    identifier: z.string().trim().min(3),
    code: z.string().trim().regex(/^\d{6}$/, 'Код из 6 цифр'),
    password: passwordSchema,
    passwordRepeat: z.string(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    path: ['passwordRepeat'],
    message: 'Пароли не совпадают',
  })

export const adminResetAccessSchema = z.object({
  newPassword: passwordSchema.optional(),
})

export const twoFactorEnableSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
  code: z.string().trim().regex(/^\d{6}$/, 'Код из 6 цифр'),
})

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
})

export const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().trim().min(6).max(20),
  deviceId: z.string().trim().min(4).max(120).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
})

export const stepUpSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
})

export const oauthSchema = z.object({
  idToken: z.string().min(20, 'Некорректный токен провайдера'),
  deviceId: z.string().trim().min(4).max(120).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
})

export type RegistrationApplyInput = z.infer<typeof registrationApplySchema>
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>
export type InvitationAcceptInput = z.infer<typeof invitationAcceptSchema>
