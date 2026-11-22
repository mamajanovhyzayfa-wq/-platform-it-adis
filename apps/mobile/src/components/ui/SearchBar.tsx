import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { control, radius, spacing, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface SearchBarProps {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  onSubmit?: () => void
  autoFocus?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Поиск',
  onSubmit,
  autoFocus = false,
  style,
  accessibilityLabel,
}: SearchBarProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [focused, setFocused] = useState(false)

  return (
    <View style={[styles.wrap, { borderColor: focused ? theme.colors.primary : theme.colors.border }, style]}>
      <Text style={styles.icon} accessibilityElementsHidden>
        🔍
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        style={[styles.input, { color: theme.colors.text }]}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          hitSlop={8}
          onPress={() => onChangeText('')}
          style={styles.clear}
        >
          <Text style={styles.clearText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: control.md,
      borderWidth: 1,
      borderRadius: radius.md,
      backgroundColor: c.card,
      paddingHorizontal: spacing.md,
    },
    icon: { fontSize: 15 },
    input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
    clear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cardMuted },
    clearText: { fontSize: 11, color: c.textMuted, fontWeight: '700' },
  })
