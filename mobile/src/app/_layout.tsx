import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { configureNotificationHandler, ensurePushRegistered, listenNotificationPresses } from '@/services/push'
import { AppThemeProvider, useTheme } from '@/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </AppThemeProvider>
  )
}

/**
 * Навигация внутри провайдера темы: цвета шапки и фона подставляются из активной
 * палитры, поэтому при переключении светлой/тёмной темы не остаётся белых вспышек.
 */
function RootNavigator() {
  const theme = useTheme()
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const status = useAuthStore((state) => state.status)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // Обработчик показа и подписка на нажатия живут всё время работы приложения.
  useEffect(() => {
    configureNotificationHandler()
    return listenNotificationPresses()
  }, [])

  // Токен устройства привязываем после входа: до авторизации сервер его не примет.
  useEffect(() => {
    if (status !== 'authenticated') return
    void ensurePushRegistered()
  }, [status])

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          headerTintColor: theme.colors.text,
          headerStyle: { backgroundColor: theme.colors.backgroundAlt },
          headerTitleStyle: { color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(student)" />
        <Stack.Screen name="(teacher)" />
        <Stack.Screen name="(manager)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Уведомления' }} />
        <Stack.Screen name="course/[id]" options={{ headerShown: true, title: 'Курс' }} />
        <Stack.Screen name="lesson/[id]" options={{ headerShown: true, title: 'Урок' }} />
        <Stack.Screen name="teacher-course/[id]" options={{ headerShown: true, title: 'Курс' }} />
        <Stack.Screen name="teacher-lesson/[id]" options={{ headerShown: true, title: 'Урок' }} />
        <Stack.Screen name="teacher-homework/[id]" options={{ headerShown: true, title: 'Задание' }} />
        <Stack.Screen name="teacher-submission/[id]" options={{ headerShown: true, title: 'Работа' }} />
        <Stack.Screen name="test/[id]" options={{ headerShown: true, title: 'Тест' }} />
        <Stack.Screen name="homework/[id]" options={{ headerShown: true, title: 'Задание' }} />
        <Stack.Screen name="coins" options={{ headerShown: true, title: 'IT Coins' }} />
        <Stack.Screen name="video/[scheduleId]" options={{ headerShown: false }} />
        <Stack.Screen name="shop" options={{ headerShown: true, title: 'Магазин наград' }} />
        <Stack.Screen name="achievements" options={{ headerShown: true, title: 'Достижения' }} />
        <Stack.Screen name="knowledge/index" options={{ headerShown: true, title: 'База знаний' }} />
        <Stack.Screen name="knowledge/[id]" options={{ headerShown: true, title: 'Материал' }} />
        <Stack.Screen name="messages/index" options={{ headerShown: true, title: 'Сообщения' }} />
        <Stack.Screen name="messages/[id]" options={{ headerShown: true, title: 'Переписка' }} />
        <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Конфиденциальность' }} />
        <Stack.Screen name="delete-account" options={{ headerShown: true, title: 'Удаление аккаунта' }} />
        <Stack.Screen name="ai" options={{ headerShown: true, title: 'AI-помощник' }} />
      </Stack>
    </>
  )
}
