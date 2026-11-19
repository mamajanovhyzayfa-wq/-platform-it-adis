import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, Input, Screen } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useThemedStyles, type Palette } from '@/theme'

const schema = z
  .object({
    firstName: z.string().trim().min(2, 'Укажите имя'),
    lastName: z.string().trim().min(2, 'Укажите фамилию'),
    email: z.string().trim().email('Некорректный email'),
    phone: z.string().trim().regex(/^\+?[0-9]{9,15}$/, 'Телефон в формате +996700000000').or(z.literal('')),
    password: z
      .string()
      .min(8, 'Минимум 8 символов')
      .regex(/[A-ZА-ЯЁ]/, 'Нужна заглавная буква')
      .regex(/\d/, 'Нужна цифра'),
    passwordRepeat: z.string(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат ГГГГ-ММ-ДД').or(z.literal('')),
    guardianName: z.string().trim().optional(),
    guardianPhone: z.string().trim().optional(),
    acceptTerms: z.boolean(),
    acceptPrivacy: z.boolean(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    path: ['passwordRepeat'],
    message: 'Пароли не совпадают',
  })
  .refine((data) => data.acceptTerms, { path: ['acceptTerms'], message: 'Нужно принять условия' })
  .refine((data) => data.acceptPrivacy, { path: ['acceptPrivacy'], message: 'Нужно принять политику' })
  .refine(
    (data) => {
      if (!data.birthDate) return true
      const age = (Date.now() - new Date(data.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      return age >= 18 || Boolean(data.guardianName && data.guardianPhone)
    },
    { path: ['guardianName'], message: 'Для несовершеннолетних нужны данные представителя' },
  )

type FormValues = z.infer<typeof schema>

export default function RegisterScreen() {
  const router = useRouter()
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const register = useAuthStore((state) => state.register)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { control, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      passwordRepeat: '',
      birthDate: '',
      guardianName: '',
      guardianPhone: '',
      acceptTerms: false,
      acceptPrivacy: false,
    },
  })

  const birthDate = watch('birthDate')
  const isMinor = Boolean(
    birthDate && (Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000) < 18,
  )

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    setSubmitting(true)
    try {
      await register({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        phone: values.phone || undefined,
        password: values.password,
        passwordRepeat: values.passwordRepeat,
        birthDate: values.birthDate || undefined,
        acceptTerms: values.acceptTerms,
        acceptPrivacy: values.acceptPrivacy,
        guardianName: isMinor ? values.guardianName : undefined,
        guardianPhone: isMinor ? values.guardianPhone : undefined,
      })
      router.replace('/')
    } catch {
      setServerError(useAuthStore.getState().error)
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <Screen>
      <Text style={styles.title}>{t('welcome.register')}</Text>

      <Card>
        <Controller
          control={control}
          name="firstName"
          render={({ field, fieldState }) => (
            <Input label={t('auth.firstName')} value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="lastName"
          render={({ field, fieldState }) => (
            <Input label={t('auth.lastName')} value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Input
              label={t('auth.email')}
              autoCapitalize="none"
              keyboardType="email-address"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <Input
              label={t('auth.phone')}
              keyboardType="phone-pad"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="birthDate"
          render={({ field, fieldState }) => (
            <Input
              label={t('auth.birthDate')}
              placeholder="2000-01-31"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        {isMinor ? (
          <View style={styles.guardian}>
            <Text style={styles.sectionTitle}>{t('auth.guardian')}</Text>
            <Controller
              control={control}
              name="guardianName"
              render={({ field, fieldState }) => (
                <Input
                  label={t('auth.guardianName')}
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="guardianPhone"
              render={({ field, fieldState }) => (
                <Input
                  label={t('auth.guardianPhone')}
                  keyboardType="phone-pad"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        ) : null}

        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <Input
              label={t('auth.password')}
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="passwordRepeat"
          render={({ field, fieldState }) => (
            <Input
              label={t('auth.passwordRepeat')}
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <View>
              <Pressable style={styles.checkboxRow} onPress={() => field.onChange(!field.value)}>
                <View style={[styles.checkbox, field.value && styles.checkboxChecked]} />
                <Text style={styles.checkboxLabel}>{t('auth.terms')}</Text>
              </Pressable>
              {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </View>
          )}
        />
        <Controller
          control={control}
          name="acceptPrivacy"
          render={({ field, fieldState }) => (
            <View>
              <Pressable style={styles.checkboxRow} onPress={() => field.onChange(!field.value)}>
                <View style={[styles.checkbox, field.value && styles.checkboxChecked]} />
                <Text style={styles.checkboxLabel}>{t('auth.privacy')}</Text>
              </Pressable>
              {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </View>
          )}
        />

        {serverError ? <Text style={styles.error}>{serverError}</Text> : null}

        <Button
          title={t('welcome.register')}
          onPress={onSubmit}
          loading={submitting || formState.isSubmitting}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Text style={styles.footer}>
        {t('auth.haveAccount')}{' '}
        <Text style={styles.footerLink} onPress={() => router.push('/(auth)/login')}>
          {t('welcome.login')}
        </Text>
      </Text>
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { fontSize: typography.title, fontWeight: '800', color: c.text, marginVertical: spacing.lg },
    sectionTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginBottom: spacing.sm },
    guardian: {
      backgroundColor: c.primarySoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
    },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: c.borderStrong,
      backgroundColor: c.card,
    },
    checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
    checkboxLabel: { color: c.text, flex: 1, fontSize: typography.caption },
    error: { color: c.danger, fontSize: typography.caption },
    footer: { textAlign: 'center', marginTop: spacing.lg, color: c.textMuted },
    footerLink: { color: c.primary, fontWeight: '700' },
  })
