import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Input, useToast } from '@/components/ui'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
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
  const toast = useToast()
  const queryClient = useQueryClient()
  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianConfirmed, setGuardianConfirmed] = useState(false)

  const consents = useQuery({ queryKey: ['privacy-consents'], queryFn: api.privacyConsents })
  const latest = new Map((consents.data?.latest ?? []).map((item) => [item.type, item]))
  const marketing = latest.get('MARKETING')

  const record = useMutation({
    mutationFn: (input: {
      type: string
      granted: boolean
      guardianName?: string
      guardianPhone?: string
      confirmedByGuardian?: boolean
    }) => api.recordConsent(input),
    onSuccess: () => {
      toast.success('Согласие сохранено с датой и версией документа')
      void queryClient.invalidateQueries({ queryKey: ['privacy-consents'] })
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('privacy.title')}</Text>
      <Text style={styles.updated}>{t('privacy.updated')}</Text>
      <Card>
        <Text style={styles.cardTitle}>Важно</Text>
        <Text style={styles.body}>
          Это информационный документ платформы, а не юридическое заключение. Он учитывает общие требования
          Цифрового кодекса Кыргызской Республики от 31.07.2025 № 178; перед публикацией текст должен
          проверить юрист. Для ребёнка младше 14 лет требуется согласие законного представителя; до 18 лет
          платформа запрашивает подтверждение представителя для договора об обучении.
        </Text>
      </Card>

      {sections.map((section) => (
        <Card key={section.title}>
          <Text style={styles.cardTitle}>{t(section.title)}</Text>
          <Text style={styles.body}>{t(section.text)}</Text>
        </Card>
      ))}

      <Card>
        <Text style={styles.cardTitle}>Мои согласия</Text>
        {consents.isLoading ? <Text style={styles.body}>Загрузка…</Text> : null}
        {consents.error ? <Text style={styles.error}>{describeApiError(consents.error)}</Text> : null}
        {(consents.data?.documents ?? []).map((document) => {
          const record = latest.get(document.type)
          return (
            <View key={document.type} style={styles.consentRow}>
              <View style={styles.consentText}>
                <Text style={styles.consentTitle}>{document.title}</Text>
                <Text style={styles.body}>
                  Версия {document.version} · {document.required ? 'обязательное' : 'необязательное'}
                </Text>
              </View>
              <Badge
                label={record?.granted ? 'Да' : record ? 'Отозвано' : 'Нет'}
                tone={record?.granted ? 'success' : record ? 'warning' : 'neutral'}
              />
            </View>
          )
        })}

        <View style={styles.consentAction}>
          <Text style={styles.consentTitle}>Маркетинговые сообщения</Text>
          <Text style={styles.body}>
            Необязательное согласие. Отказ не влияет на доступ к обучению.
          </Text>
          <Button
            title={marketing?.granted ? 'Отозвать согласие' : 'Согласиться'}
            variant="secondary"
            loading={record.isPending}
            onPress={() => record.mutate({ type: 'MARKETING', granted: !marketing?.granted })}
          />
        </View>

        {consents.data?.guardianRequired ? (
          <View style={styles.consentAction}>
            <Text style={styles.consentTitle}>Согласие законного представителя</Text>
            <Text style={styles.body}>
              Для обучающегося младше 18 лет укажите родителя или опекуна. Для ребёнка младше 14 лет
              согласие обязательно.
              Документ и дата сохраняются в истории.
            </Text>
            {consents.data.guardian?.confirmedAt ? (
              <Badge label="Подтверждено" tone="success" />
            ) : (
              <>
                <Input label="ФИО представителя" value={guardianName} onChangeText={setGuardianName} />
                <Input
                  label="Телефон"
                  keyboardType="phone-pad"
                  value={guardianPhone}
                  onChangeText={setGuardianPhone}
                />
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => setGuardianConfirmed((value) => !value)}
                >
                  <View style={[styles.checkbox, guardianConfirmed && styles.checkboxChecked]} />
                  <Text style={styles.checkboxText}>
                    Подтверждаю, что являюсь законным представителем
                  </Text>
                </Pressable>
                <Button
                  title="Сохранить согласие"
                  loading={record.isPending}
                  disabled={!guardianConfirmed || !guardianName.trim() || !guardianPhone.trim()}
                  onPress={() =>
                    record.mutate({
                      type: 'GUARDIAN',
                      granted: true,
                      guardianName: guardianName.trim(),
                      guardianPhone: guardianPhone.trim(),
                      confirmedByGuardian: true,
                    })
                  }
                />
              </>
            )}
          </View>
        ) : null}

        {(consents.data?.history ?? []).length > 0 ? (
          <View style={styles.consentAction}>
            <Text style={styles.consentTitle}>История согласий</Text>
            {(consents.data?.history ?? []).slice(0, 12).map((item) => (
              <Text key={item.id} style={styles.history}>
                {new Date(item.createdAt).toLocaleString('ru-RU')} · {item.type} · v{item.documentVersion} ·{' '}
                {item.granted ? 'предоставлено' : 'отозвано'}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

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
    consentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    consentText: { flex: 1 },
    consentTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    consentAction: { gap: spacing.sm, marginTop: spacing.md },
    history: { fontSize: typography.tiny, color: c.textMuted, lineHeight: 17 },
    error: { fontSize: typography.caption, color: c.danger },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.border },
    checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
    checkboxText: { flex: 1, fontSize: typography.caption, color: c.text, lineHeight: 18 },
  })
