import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, useTheme, useThemedStyles, type Palette } from '@/theme'

interface SkeletonProps {
  width?: DimensionValue
  height?: number
  /** Радиус скругления; для круга передайте circle. */
  borderRadius?: number
  circle?: boolean
  /** Количество строк-заглушек (для текстовых блоков). */
  lines?: number
  style?: StyleProp<ViewStyle>
}

export function Skeleton({ width = '100%', height = 16, borderRadius = radius.sm, circle = false, lines, style }: SkeletonProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const opacity = useRef(new Animated.Value(0.55)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [opacity])

  if (lines && lines > 1) {
    return (
      <View style={styles.stack}>
        {Array.from({ length: lines }).map((_, index) => (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                opacity,
                backgroundColor: theme.colors.skeleton,
                width: index === lines - 1 ? '65%' : width,
                height,
              },
            ]}
          />
        ))}
      </View>
    )
  }

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Загрузка данных"
      style={[
        styles.bar,
        {
          opacity,
          backgroundColor: theme.colors.skeleton,
          width: circle ? height : width,
          height,
          borderRadius: circle ? height / 2 : borderRadius,
        },
        style,
      ]}
    />
  )
}

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    bar: {},
    stack: { gap: spacing.sm },
  })
