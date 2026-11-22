import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, typography, useThemedStyles, type Palette } from '@/theme'

export interface TabItem<T extends string> {
  key: T
  label: string
  badge?: number
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (key: T) => void
  /** Горизонтальная прокрутка для длинного списка. */
  scrollable?: boolean
  style?: StyleProp<ViewStyle>
}

export function Tabs<T extends string>({ items, value, onChange, scrollable = false, style }: TabsProps<T>) {
  const styles = useThemedStyles(makeStyles)

  const content = (
    <View style={[styles.bar, !scrollable && styles.stretch]}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => onChange(item.key)}
            style={[styles.tab, !scrollable && styles.tabFlex, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {item.label}
            </Text>
            {item.badge != null && item.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )

  if (!scrollable) return <View style={style}>{content}</View>

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.scroll, style]}>
      {content}
    </ScrollView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scroll: { paddingRight: spacing.lg },
    bar: { flexDirection: 'row', gap: spacing.xs, backgroundColor: c.cardMuted, padding: spacing.xs, borderRadius: radius.md },
    stretch: { alignSelf: 'stretch' },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    tabFlex: { flex: 1 },
    tabActive: { backgroundColor: c.card },
    label: { fontSize: typography.caption, fontWeight: '600', color: c.textMuted },
    labelActive: { color: c.primary, fontWeight: '700' },
    badge: { minWidth: 18, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: c.primary, alignItems: 'center' },
    badgeText: { fontSize: 10, color: c.onPrimary, fontWeight: '700' },
  })
