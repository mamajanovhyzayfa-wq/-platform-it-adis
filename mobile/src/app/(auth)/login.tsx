import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, Input } from '@/components/ui'
import { Screen } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const schema = z.object({
  identifier: z.string().trim().min(3, 'Укажите email или телефон'),
  password: z.string().min(1, 'Введите пароль'),
})

type FormValues = z.infer<typeof schema>

export default function LoginScreen() {
  const router = useRouter()
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const login = useAuthStore((state) => state.login)
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    setSubmitting(true)
    try {
      await login(values.identifier, values.password)
      router.replace('/')
    } catch {
      setServerError(useAuthStore.getState().error)
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('welcome.login')}</Text>
          <Text style={styles.subtitle}>{t('welcome.title')}</Text>
        </View>

        <Card>
          <Controller
            control={control}
            name="identifier"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.emailOrPhone')}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.password')}
                secureTextEntry={!showPassword}
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />

          <Text onPress={() => setShowPassword((value) => !value)} style={styles.link}>
            {showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          </Text>

          {serverError ? <Text style={styles.error}>{serverError}</Text> : null}

          <Button title={t('welcome.login')} onPress={onSubmit} loading={submitting || formState.isSubmitting} />

          <Text onPress={() => router.push('/(auth)/forgot-password')} style={[styles.link, { marginTop: spacing.md }]}>
            {t('auth.forgot')}
          </Text>
        </Card>

        <Text style={styles.footer}>
          {t('auth.noAccount')}{' '}
          <Text style={styles.footerLink} onPress={() => router.push('/(auth)/register')}>
            {t('welcome.register')}
          </Text>
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { marginBottom: spacing.xl, marginTop: spacing.xl },
    title: { fontSize: typography.title, fontWeight: '800', color: c.text },
    subtitle: { fontSize: typography.body, color: c.textMuted, marginTop: spacing.xs },
    link: { color: c.primary, fontSize: typography.caption, fontWeight: '600' },
    error: { color: c.danger, marginBottom: spacing.md, fontSize: typography.caption },
    footer: { textAlign: 'center', marginTop: spacing.xl, color: c.textMuted },
    footerLink: { color: c.primary, fontWeight: '700' },
  })
