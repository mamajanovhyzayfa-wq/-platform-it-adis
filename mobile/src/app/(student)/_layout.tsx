import { Tabs } from 'expo-router'
import { Text, type ColorValue } from 'react-native'
import { RoleGate } from '@/components/guards'
import { useTheme } from '@/theme'
import { useI18n } from '@/i18n'

const tabIcon = (glyph: string) =>
  function TabGlyph({ color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Text style={{ color, fontSize: size - 2 }}>{glyph}</Text>
  }

export default function StudentLayout() {
  const { t } = useI18n()
  const theme = useTheme()

  return (
    <RoleGate allow={['STUDENT']}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: {
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.backgroundAlt,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('nav.home'), tabBarIcon: tabIcon('⌂') }} />
        <Tabs.Screen name="courses" options={{ title: t('nav.courses'), tabBarIcon: tabIcon('▤') }} />
        <Tabs.Screen name="schedule" options={{ title: t('nav.schedule'), tabBarIcon: tabIcon('▦') }} />
        <Tabs.Screen name="homework" options={{ title: t('nav.homework'), tabBarIcon: tabIcon('✎') }} />
        <Tabs.Screen name="profile" options={{ title: t('nav.profile'), tabBarIcon: tabIcon('☺') }} />
      </Tabs>
    </RoleGate>
  )
}
