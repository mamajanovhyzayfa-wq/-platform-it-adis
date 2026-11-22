import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '@/components/ui'
import { useI18n, localeLabels, type Locale } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const locales: Locale[] = ['ru', 'ky', 'en']

export default function WelcomeScreen() {
  const router = useRouter()
  const { t, locale } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const setLocale = useAuthStore((state) => state.setLocale)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.languageRow}>
        {locales.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: item === locale }}
            onPress={() => void setLocale(item)}
            hitSlop={8}
          >
            <Text style={[styles.language, item === locale && styles.languageActive]}>{localeLabels[item]}</Text>
          </Pressable>
        ))}
      </View>

      <Animated.View entering={FadeIn.duration(500)} style={styles.logoWrap}>
        <Image source={require('../../../assets/images/icon.png')} style={styles.logo} contentFit="contain" />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.copy}>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(300).duration(500)} style={styles.actions}>
        <Button title={t('welcome.login')} size="lg" onPress={() => router.push('/(auth)/login')} />
        <Button
          title={t('welcome.register')}
          variant="secondary"
          size="lg"
          onPress={() => router.push('/(auth)/register')}
        />
      </Animated.View>
    </SafeAreaView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
    languageRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
    language: { fontSize: typography.caption, color: c.textMuted },
    languageActive: { color: c.primary, fontWeight: '700' },
    logoWrap: { alignItems: 'center', marginTop: spacing.xxl },
    logo: { width: 240, height: 240, borderRadius: radius.xl },
    copy: { gap: spacing.sm, alignItems: 'center' },
    title: { fontSize: typography.display, fontWeight: '800', color: c.text, letterSpacing: -1 },
    subtitle: {
      fontSize: typography.body,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: spacing.md,
    },
    actions: { gap: spacing.md, marginBottom: spacing.xl },
  })
