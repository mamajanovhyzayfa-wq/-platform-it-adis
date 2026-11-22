import { Stack } from 'expo-router'
import { RoleGate } from '@/components/guards'
import { useTheme } from '@/theme'

export default function ManagerLayout() {
  const theme = useTheme()

  return (
    <RoleGate allow={['MANAGER']}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerTintColor: theme.colors.text,
          headerStyle: { backgroundColor: theme.colors.backgroundAlt },
          headerTitleStyle: { color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Кабинет менеджера' }} />
        <Stack.Screen name="students" options={{ title: 'Ученики' }} />
      </Stack>
    </RoleGate>
  )
}
