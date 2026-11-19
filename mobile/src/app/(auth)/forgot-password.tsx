import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, Input, Screen } from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

const schema = z.object({ email: z.string().trim().email('Некорректный email') })
type FormValues = z.infer<typeof schema>

export default function ForgotPasswordScreen() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      await api.forgotPassword(values.email)
      setSent(true)
    } catch (requestError) {
      setError(describeApiError(requestError))
    } finally {
      setLoading(false)
    }
  })

  return (
    <Screen>
      <Text style={styles.title}>{t('auth.resetTitle')}</Text>
      <Card>
        <Text style={styles.hint}>{sent ? t('auth.resetSent') : t('auth.resetHint')}</Text>

        {!sent ? (
          <>
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
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title={t('auth.send')} onPress={onSubmit} loading={loading} />
          </>
        ) : null}
      </Card>
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { fontSize: typography.title, fontWeight: '800', color: c.text, marginVertical: spacing.lg },
    hint: { color: c.textMuted, marginBottom: spacing.lg, lineHeight: 21 },
    error: { color: c.danger, marginBottom: spacing.md, fontSize: typography.caption },
  })
