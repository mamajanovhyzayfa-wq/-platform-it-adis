import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { fontWeight, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface AvatarProps {
  firstName?: string
  lastName?: string
  uri?: string | null
  size?: number
  accessibilityLabel?: string
}

function initials(firstName?: string, lastName?: string) {
  const first = firstName?.trim()?.[0] ?? ''
  const last = lastName?.trim()?.[0] ?? ''
  return `${first}${last}`.toUpperCase() || 'ИТ'
}

export function Avatar({ firstName, lastName, uri, size = 44, accessibilityLabel }: AvatarProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const fullName = [firstName, lastName].filter(Boolean).join(' ')
  const label = accessibilityLabel ?? (fullName.length > 0 ? fullName : 'Пользователь')

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.cardMuted }}
        contentFit="cover"
        accessibilityLabel={label}
        transition={150}
      />
    )
  }

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.text, { fontSize: Math.max(size / 2.8, 11) }]}>{initials(firstName, lastName)}</Text>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fallback: { backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    text: { color: c.onPrimary, fontWeight: fontWeight.bold },
  })
