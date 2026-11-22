import { Redirect } from 'expo-router'
import { Loader } from '@/components/ui'
import { useAuthStore } from '@/store/auth'

/** Единая точка входа: пользователь попадает в интерфейс своей роли. */
export default function Index() {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  if (status === 'idle' || status === 'loading') return <Loader />

  if (status !== 'authenticated' || !user) return <Redirect href="/(auth)/welcome" />

  if (user.role === 'TEACHER') return <Redirect href="/(teacher)" />
  if (user.role === 'MANAGER') return <Redirect href="/(manager)" />
  if (user.role === 'PARENT') return <Redirect href="/(parent)" />
  if (user.role === 'ADMIN') return <Redirect href="/(admin)" />
  return <Redirect href="/(student)" />
}
