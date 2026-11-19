import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { Loader } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useTheme } from '@/theme'
import type { AuthUser } from '@/api/api'

function FullScreenLoader() {
  const theme = useTheme()
  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
      <Loader label="Загрузка…" />
    </View>
  )
}

/**
 * Защищённая часть приложения: пускает только авторизованных с нужной ролью.
 *
 * Пока сессия восстанавливается из SecureStore, показывается загрузка — иначе
 * пользователь на мгновение увидел бы экран входа. Роль не совпала — отправляем
 * на общую точку входа, которая сама выберет интерфейс роли.
 */
export function RoleGate({ allow, children }: { allow: AuthUser['role'][]; children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  if (status === 'idle' || status === 'loading') return <FullScreenLoader />
  if (status !== 'authenticated' || !user) return <Redirect href="/(auth)/welcome" />
  if (!allow.includes(user.role)) return <Redirect href="/" />

  return <>{children}</>
}

/** Только для неавторизованных: вход, регистрация, восстановление пароля. */
export function GuestGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  if (status === 'idle' || status === 'loading') return <FullScreenLoader />
  if (status === 'authenticated' && user) return <Redirect href="/" />

  return <>{children}</>
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
