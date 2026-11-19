import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmationDialog,
  ErrorState,
  Input,
  Screen,
  Skeleton,
  Tabs,
  TextArea,
  Title,
  useToast,
} from '@/components/ui'
import { ProgressBar } from '@/components/progress'
import { api, type Profile } from '@/api/api'
import { describeApiError } from '@/api/client'
import { ensurePushRegistered, type PushPermission } from '@/services/push'
import { useAuthStore } from '@/store/auth'
import { useThemeStore, type ThemeMode } from '@/store/theme'
import { localeLabels, useI18n, type Locale } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const locales: Locale[] = ['ru', 'ky', 'en']

const roleLabels: Record<string, string> = {
  TEACHER: 'Преподаватель',
  ADMIN: 'Администратор',
  PARENT: 'Родитель',
  STUDENT: 'Ученик',
}

/**
 * Профиль ученика: личные данные с редактированием, достижения и настройки.
 * Данные профиля и достижений загружаются с сервера, форма отправляет PATCH /users/me.
 */
export function ProfileView() {
  const { t, locale } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const setLocale = useAuthStore((state) => state.setLocale)
  const refreshProfile = useAuthStore((state) => state.refreshProfile)
  const themeMode = useThemeStore((state) => state.mode)
  const setThemeMode = useThemeStore((state) => state.setMode)

  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [pushState, setPushState] = useState<PushPermission | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: api.me })
  const achievements = useQuery({ queryKey: ['achievements'], queryFn: api.achievements })

  if (!user) {
    return (
      <Screen>
        <Skeleton height={88} borderRadius={radius.lg} />
        <Skeleton height={140} borderRadius={radius.lg} />
      </Screen>
    )
  }

  if (profileQuery.isLoading && !profileQuery.data) {
    return (
      <Screen>
        <Title>{t('profile.title')}</Title>
        <Skeleton height={88} borderRadius={radius.lg} />
        <Skeleton height={120} borderRadius={radius.lg} />
        <Skeleton height={180} borderRadius={radius.lg} />
      </Screen>
    )
  }

  if (profileQuery.isError && !profileQuery.data) {
    return (
      <Screen>
        <Title>{t('profile.title')}</Title>
        <ErrorState
          title="Профиль недоступен"
          message={describeApiError(profileQuery.error)}
          onRetry={() => void profileQuery.refetch()}
        />
      </Screen>
    )
  }

  const profile = profileQuery.data ?? user
  const achievementsData = achievements.data
  const preview = (achievementsData?.items ?? []).filter((item) => item.earnedAt).slice(0, 3)
  const nextAchievements = (achievementsData?.items ?? []).filter((item) => !item.earnedAt).slice(0, 2)

  return (
    <Screen refreshing={profileQuery.isRefetching} onRefresh={() => void profileQuery.refetch()}>
      <Title>{t('profile.title')}</Title>

      <Card style={styles.header}>
        <Avatar firstName={profile.firstName} lastName={profile.lastName} size={64} />
        <View style={styles.headerText}>
          <Text style={styles.name}>
            {profile.firstName} {profile.lastName}
          </Text>
          <Text style={styles.muted}>{profile.email}</Text>
          <Badge label={roleLabels[profile.role] ?? profile.role} tone="primary" />
        </View>
        <Button title="Изменить" variant="ghost" size="sm" fullWidth={false} onPress={() => setEditOpen(true)} />
      </Card>

      <Card>
        <View style={styles.statsRow}>
          <Stat label="IT Coins" value={String(profile.coinBalance ?? 0)} />
          <Stat label={t('courses.title')} value={String(profile.courses?.length ?? 0)} />
          <Stat
            label="Достижения"
            value={achievementsData ? `${achievementsData.earned}/${achievementsData.total}` : '—'}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Личные данные</Text>
          <Button title={t('profile.edit')} variant="ghost" size="sm" fullWidth={false} onPress={() => setEditOpen(true)} />
        </View>
        <InfoRow label="Имя и фамилия" value={`${profile.firstName} ${profile.lastName}`} />
        <InfoRow label="Email" value={profile.email} />
        <InfoRow label="Телефон" value={profile.phone ?? 'Не указан'} />
        <InfoRow label="О себе" value={profile.profile?.bio ?? 'Не заполнено'} />
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t('profile.achievements')}</Text>
          <Text style={styles.link} onPress={() => router.push('/achievements')}>
            Все →
          </Text>
        </View>

        {achievements.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={44} />
            <Skeleton height={44} />
          </View>
        ) : achievements.isError ? (
          <Text style={styles.muted}>{describeApiError(achievements.error)}</Text>
        ) : preview.length === 0 && nextAchievements.length === 0 ? (
          <Text style={styles.muted}>Достижения появятся после первых уроков и заданий.</Text>
        ) : (
          <>
            {preview.map((item) => (
              <View key={item.id} style={styles.achievement}>
                <Text style={styles.achievementIcon}>{item.iconUrl ? '🏅' : '🏆'}</Text>
                <View style={styles.achievementText}>
                  <Text style={styles.achievementTitle}>{item.title}</Text>
                  <Text style={styles.muted}>{item.description}</Text>
                </View>
                <Badge label="Получено" tone="success" />
              </View>
            ))}
            {nextAchievements.map((item) => (
              <View key={item.id} style={styles.achievement}>
                <Text style={styles.achievementIcon}>🔒</Text>
                <View style={styles.achievementText}>
                  <Text style={styles.achievementTitle}>{item.title}</Text>
                  <ProgressBar value={(item.current / Math.max(item.target, 1)) * 100} caption={false} height={6} />
                  <Text style={styles.muted}>
                    {item.current} из {item.target}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{t('profile.motivation')}</Text>
        <Button title={t('profile.coins')} variant="secondary" onPress={() => router.push('/coins')} />
        <Button
          title={t('profile.messages')}
          variant="secondary"
          onPress={() => router.push('/messages')}
          style={styles.stacked}
        />
        <Button
          title={t('profile.knowledge')}
          variant="secondary"
          onPress={() => router.push('/knowledge')}
          style={styles.stacked}
        />
        <Button title={t('profile.shop')} variant="secondary" onPress={() => router.push('/shop')} style={styles.stacked} />
        <Button
          title={t('profile.ai')}
          variant="secondary"
          onPress={() => router.push('/ai')}
          style={styles.stacked}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{t('profile.personalData')}</Text>
        <Text style={styles.label}>{t('settings.push')}</Text>
        <Text style={styles.hint}>{t('settings.pushHint')}</Text>
        <Button
          title={pushState === 'granted' ? t('settings.pushEnabled') : t('settings.pushEnable')}
          variant={pushState === 'granted' ? 'ghost' : 'secondary'}
          loading={pushBusy}
          disabled={pushBusy || pushState === 'granted'}
          style={styles.stacked}
          onPress={() => {
            setPushBusy(true)
            void ensurePushRegistered()
              .then((result) => {
                setPushState(result)
                if (result === 'granted') toast.success(t('settings.pushEnabled'))
                else if (result === 'unsupported') toast.show({ message: t('settings.pushUnsupported'), tone: 'info' })
                else toast.error(t('settings.pushDenied'))
              })
              .catch(() => toast.error(t('settings.pushError')))
              .finally(() => setPushBusy(false))
          }}
        />
        <Button
          title={t('profile.privacy')}
          variant="secondary"
          onPress={() => router.push('/privacy')}
          style={styles.stacked}
        />
        <Button
          title={t('profile.deleteAccount')}
          variant="danger"
          onPress={() => router.push('/delete-account')}
          style={styles.stacked}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{t('profile.settings')}</Text>

        <Text style={styles.label}>{t('theme.title')}</Text>
        <Tabs<ThemeMode>
          items={[
            { key: 'system', label: t('theme.system') },
            { key: 'light', label: t('theme.light') },
            { key: 'dark', label: t('theme.dark') },
          ]}
          value={themeMode}
          onChange={(mode) => void setThemeMode(mode)}
        />
        <Text style={styles.hint}>
          {themeMode === 'system'
            ? `Сейчас используется ${theme.scheme === 'dark' ? 'тёмная' : 'светлая'} тема системы`
            : 'Тема закреплена и не зависит от настроек устройства'}
        </Text>

        <Text style={[styles.label, styles.labelTop]}>{t('profile.language')}</Text>
        <View style={styles.languages}>
          {locales.map((item) => (
            <Text
              key={item}
              onPress={() => void setLocale(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: item === locale }}
              style={[styles.language, item === locale && styles.languageActive]}
            >
              {localeLabels[item]}
            </Text>
          ))}
        </View>
      </Card>

      <Button title={t('profile.logout')} variant="danger" onPress={() => setLogoutOpen(true)} />

      <PersonalDataSheet
        visible={editOpen}
        profile={profile}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['profile'] })
          void refreshProfile()
          setEditOpen(false)
          toast.success('Личные данные обновлены')
        }}
      />

      <ConfirmationDialog
        visible={logoutOpen}
        title={t('profile.logout')}
        description="Сессия на этом устройстве будет завершена. Чтобы вернуться, потребуется войти снова."
        confirmLabel={t('profile.logout')}
        destructive
        loading={loggingOut}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          setLoggingOut(true)
          void logout().finally(() => {
            setLoggingOut(false)
            setLogoutOpen(false)
          })
        }}
      />
    </Screen>
  )
}

const personalSchema = z.object({
  firstName: z.string().trim().min(2, 'Минимум 2 символа').max(60),
  lastName: z.string().trim().min(2, 'Минимум 2 символа').max(60),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\+?[0-9]{9,15}$/.test(value), 'Формат: +996700000000'),
  bio: z.string().trim().max(500, 'Максимум 500 символов'),
})

type PersonalForm = z.infer<typeof personalSchema>

/** Нижняя панель редактирования профиля: валидация Zod и отправка на сервер. */
function PersonalDataSheet({
  visible,
  profile,
  onClose,
  onSaved,
}: {
  visible: boolean
  profile: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()
  const { control, handleSubmit, reset, formState } = useForm<PersonalForm>({
    resolver: zodResolver(personalSchema),
    defaultValues: { firstName: '', lastName: '', phone: '', bio: '' },
  })

  useEffect(() => {
    if (!visible) return
    reset({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone ?? '',
      bio: profile.profile?.bio ?? '',
    })
  }, [visible, profile, reset])

  const save = useMutation({
    mutationFn: (values: PersonalForm) =>
      api.updateMe({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone === '' ? null : values.phone,
        bio: values.bio === '' ? null : values.bio,
      }),
    onSuccess: onSaved,
    onError: (error) => toast.error(describeApiError(error)),
  })

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Личные данные"
      description="Имя и телефон видят преподаватели. Email изменить нельзя."
      footer={
        <Button
          title="Сохранить"
          loading={save.isPending}
          disabled={formState.isSubmitting}
          onPress={handleSubmit((values) => save.mutate(values))}
        />
      }
    >
      <Controller
        control={control}
        name="firstName"
        render={({ field, fieldState }) => (
          <Input label="Имя" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="lastName"
        render={({ field, fieldState }) => (
          <Input label="Фамилия" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <Input
            label="Телефон"
            keyboardType="phone-pad"
            placeholder="+996700000000"
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="bio"
        render={({ field, fieldState }) => (
          <TextArea
            label="О себе"
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            maxLength={500}
          />
        )}
      />
      <Text style={styles.hint}>Email: {profile.email}</Text>
    </BottomSheet>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headerText: { flex: 1, gap: spacing.xs },
    name: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    muted: { fontSize: typography.caption, color: c.textMuted, marginVertical: spacing.xxs, lineHeight: 18 },
    statsRow: { flexDirection: 'row', gap: spacing.lg },
    stat: { flex: 1 },
    statValue: { fontSize: 22, fontWeight: '800', color: c.primary },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    sectionTitle: { fontSize: typography.h2, fontWeight: '800', color: c.text, marginBottom: spacing.sm },
    link: { fontSize: typography.caption, fontWeight: '700', color: c.primary },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    infoLabel: { fontSize: typography.caption, color: c.textMuted },
    infoValue: { flex: 1, textAlign: 'right', fontSize: typography.caption, color: c.text, fontWeight: '600' },
    achievement: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    achievementIcon: { fontSize: 22 },
    achievementText: { flex: 1 },
    achievementTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    stacked: { marginTop: spacing.sm },
    label: { fontSize: typography.caption, fontWeight: '700', color: c.textMuted, marginBottom: spacing.sm },
    labelTop: { marginTop: spacing.lg },
    hint: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.sm, lineHeight: 16 },
    languages: { flexDirection: 'row', gap: spacing.lg },
    language: { color: c.textMuted, fontSize: typography.body },
    languageActive: { color: c.primary, fontWeight: '700' },
  })
