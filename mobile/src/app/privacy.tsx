import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button, Card } from '@/components/ui'
import { useI18n, type MessageKey } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

/** Пункты политики: заголовок и текст держим в JSON-локалях. */
const sections: Array<{ title: MessageKey; text: MessageKey }> = [
  { title: 'privacy.section1Title', text: 'privacy.section1Text' },
  { title: 'privacy.section2Title', text: 'privacy.section2Text' },
  { title: 'privacy.section3Title', text: 'privacy.section3Text' },
  { title: 'privacy.section4Title', text: 'privacy.section4Text' },
  { title: 'privacy.section5Title', text: 'privacy.section5Text' },
]

/** Политика конфиденциальности: открывается из профиля и с экрана регистрации. */
export default function PrivacyScreen() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('privacy.title')}</Text>
      <Text style={styles.updated}>{t('privacy.updated')}</Text>

      {sections.map((section) => (
        <Card key={section.title}>
          <Text style={styles.cardTitle}>{t(section.title)}</Text>
          <Text style={styles.body}>{t(section.text)}</Text>
        </Card>
      ))}

      <Card>
        <Text style={styles.cardTitle}>{t('privacy.accountTitle')}</Text>
        <Text style={styles.body}>{t('privacy.warning1')}</Text>
        <Button
          title={t('profile.deleteAccount')}
          variant="danger"
          style={styles.button}
          onPress={() => router.push('/delete-account')}
        />
      </Card>

      <View style={styles.contact}>
        <Text style={styles.contactText}>{t('privacy.contact')}</Text>
      </View>
    </ScrollView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    title: { fontSize: typography.h1, fontWeight: '800', color: c.text },
    updated: { fontSize: typography.caption, color: c.textMuted, marginBottom: spacing.xs },
    cardTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginBottom: spacing.xs },
    body: { fontSize: typography.body, color: c.textMuted, lineHeight: 22 },
    button: { marginTop: spacing.md },
    contact: { alignItems: 'center', paddingVertical: spacing.md },
    contactText: { fontSize: typography.caption, color: c.textMuted, textAlign: 'center' },
  })
