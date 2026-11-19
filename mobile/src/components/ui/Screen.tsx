import type { ReactNode } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

export interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  /** Горизонтальные отступы контента. */
  padded?: boolean
  contentStyle?: StyleProp<ViewStyle>
  edges?: ('top' | 'bottom' | 'left' | 'right')[]
}

export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  padded = true,
  contentStyle,
  edges = ['top', 'left', 'right'],
}: ScreenProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const content = <View style={[styles.content, padded && styles.padded, contentStyle]}>{children}</View>

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
              />
            ) : undefined
          }
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  )
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.titleWrap}>
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1 },
    scroll: { paddingBottom: spacing.xxxl, flexGrow: 1 },
    content: { gap: spacing.md },
    padded: { padding: spacing.lg },
    titleWrap: { marginBottom: spacing.lg },
    title: { fontSize: typography.title, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    subtitle: { fontSize: typography.body, color: c.textMuted, marginTop: spacing.xs, lineHeight: 21 },
  })
