import { Stack } from 'expo-router'
import { GuestGate } from '@/components/guards'
import { useTheme } from '@/theme'

export default function AuthLayout() {
  const theme = useTheme()

  return (
    <GuestGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
        }}
      />
    </GuestGate>
  )
}
