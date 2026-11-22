import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, type AiCenterTool, type AiMessage } from '@/api/api'
import { describeApiError } from '@/api/client'
import { Button, Card, ErrorState, Loader } from '@/components/ui'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'ky', label: 'Кыргызча' },
  { value: 'en', label: 'English' },
]

/**
 * AI-центр ученика: несколько инструментов, источники и отметка AI.
 * Ключ модели хранится только на сервере; лимиты и история действуют общие с веб-версией.
 */
export default function AiScreen() {
  const { t } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [text, setText] = useState('')
  const [tool, setTool] = useState('student.chat')
  const [language, setLanguage] = useState('ru')
  const scrollRef = useRef<ScrollViewInstance>(null)

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus, retry: 1 })
  const tools = status.data?.tools ?? []
  const selected: AiCenterTool | undefined = tools.find((item) => item.id === tool) ?? tools[0]

  useEffect(() => {
    if (!tools.some((item) => item.id === tool) && tools[0]) setTool(tools[0].id)
  }, [tool, tools])

  const ask = useMutation({
    mutationFn: (payload: { messages: AiMessage[]; tool: string; language: string }) =>
      api.aiChat({
        messages: payload.messages,
        feature: payload.tool,
        language: payload.language,
      }),
    onSuccess: (result, payload) => {
      setMessages([
        ...payload.messages,
        {
          role: 'assistant',
          content: result.reply,
          sources: result.sources,
          assumptions: result.assumptions,
          disclaimer: result.disclaimer,
          generatedByAi: true,
        },
      ])
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60)
    },
  })

  const submit = (value?: string) => {
    const question = (value ?? text).trim()
    if (question.length === 0 || ask.isPending) return
    const next: AiMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setText('')
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60)
    ask.mutate({ messages: next.slice(-12), tool: selected?.id ?? 'student.chat', language })
  }

  if (status.isLoading) return <Loader />

  if (status.data && status.data.enabled === false) {
    return (
      <View style={styles.page}>
        <ErrorState title={t('ai.title')} message={t('ai.disabled')} onRetry={() => void status.refetch()} />
      </View>
    )
  }

  const suggestions = [t('ai.suggestion1'), t('ai.suggestion2'), t('ai.suggestion3')]

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('ai.title')}</Text>
        <Text style={styles.subtitle}>{t('ai.subtitle')}</Text>
        {status.data ? (
          <Text style={styles.quota}>
            {t('ai.limit')}: {status.data.used}/{status.data.limit} · {status.data.model}
          </Text>
        ) : null}
        {status.data?.mode === 'local' ? <Text style={styles.local}>{t('ai.localMode')}</Text> : null}
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.list}>
        <Text style={styles.sectionLabel}>{t('ai.tools')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {tools.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                setTool(item.id)
                setMessages([])
                ask.reset()
              }}
              style={[styles.chip, item.id === selected?.id && styles.chipActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, item.id === selected?.id && styles.chipTextActive]}>{item.title}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.languageRow}>
          <Text style={styles.sectionLabel}>{t('ai.language')}</Text>
          {LANGUAGES.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setLanguage(item.value)}
              style={[styles.languageChip, language === item.value && styles.chipActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, language === item.value && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {messages.length === 0 ? (
          <Card>
            <Text style={styles.intro}>{selected?.description ?? t('ai.intro')}</Text>
            <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <Pressable key={suggestion} onPress={() => submit(suggestion)} style={styles.suggestion}>
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {messages.map((message, index) => (
          <View
            key={`${message.role}-${index}`}
            style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.botBubble]}
          >
            <Text style={styles.author}>{message.role === 'user' ? t('ai.you') : t('ai.assistant')}</Text>
            {message.role === 'assistant' ? <Text style={styles.aiBadge}>{t('ai.aiGenerated')}</Text> : null}
            <Text style={[styles.body, message.role === 'user' && styles.userBody]}>{message.content}</Text>
            {message.sources?.length ? (
              <View style={styles.meta}>
                <Text style={styles.metaTitle}>{t('ai.sources')}</Text>
                {message.sources.slice(0, 4).map((source) => (
                  <Text key={`${source.title}-${source.url ?? ''}`} style={styles.metaText}>
                    · {source.title}
                    {source.url ? ` — ${source.url}` : ''}
                  </Text>
                ))}
              </View>
            ) : null}
            {message.assumptions?.length ? (
              <View style={styles.meta}>
                <Text style={styles.metaTitle}>{t('ai.assumptions')}</Text>
                {message.assumptions.map((assumption) => (
                  <Text key={assumption} style={styles.metaText}>· {assumption}</Text>
                ))}
              </View>
            ) : null}
            {message.role === 'assistant' && message.disclaimer ? (
              <Text style={styles.disclaimer}>{message.disclaimer}</Text>
            ) : null}
          </View>
        ))}

        {ask.isPending ? <Text style={styles.thinking}>{t('ai.thinking')}</Text> : null}
        {ask.isError ? <Text style={styles.error}>{describeApiError(ask.error)}</Text> : null}
      </ScrollView>

      {messages.length > 0 ? (
        <Pressable
          onPress={() => {
            setMessages([])
            ask.reset()
            void api.aiClearHistory().catch(() => undefined)
          }}
          style={styles.clear}
          accessibilityRole="button"
        >
          <Text style={styles.clearText}>{t('ai.clear')}</Text>
        </Pressable>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('ai.placeholder')}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={4000}
        />
        <Button
          title={t('ai.send')}
          fullWidth={false}
          loading={ask.isPending}
          disabled={ask.isPending || text.trim().length === 0}
          onPress={() => submit()}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 2,
    },
    title: { fontSize: typography.h2, fontWeight: '800', color: c.text },
    subtitle: { fontSize: typography.caption, color: c.textMuted },
    quota: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xxs },
    local: { fontSize: typography.tiny, color: c.warning, marginTop: spacing.xxs },
    list: { padding: spacing.md, gap: spacing.sm },
    sectionLabel: { fontSize: typography.tiny, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' },
    chipRow: { gap: spacing.xs, paddingVertical: spacing.xxs },
    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: typography.tiny, fontWeight: '600', color: c.text },
    chipTextActive: { color: c.onPrimary },
    languageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    languageChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    intro: { fontSize: typography.body, color: c.text, lineHeight: 22 },
    suggestions: { gap: spacing.sm, marginTop: spacing.md },
    suggestion: {
      padding: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: c.primarySoft,
    },
    suggestionText: { fontSize: typography.caption, color: c.primary, fontWeight: '600' },
    bubble: { maxWidth: '92%', padding: spacing.sm, borderRadius: radius.md },
    userBubble: { alignSelf: 'flex-end', backgroundColor: c.primary },
    botBubble: { alignSelf: 'flex-start', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    author: { fontSize: typography.tiny, fontWeight: '700', color: c.primary, marginBottom: 2 },
    aiBadge: { fontSize: 9, fontWeight: '800', color: c.primary, letterSpacing: 0.5, marginBottom: 4 },
    body: { fontSize: typography.body, color: c.text, lineHeight: 21 },
    userBody: { color: c.onPrimary },
    meta: { marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: c.border, gap: 1 },
    metaTitle: { fontSize: typography.tiny, fontWeight: '700', color: c.textMuted },
    metaText: { fontSize: typography.tiny, color: c.textMuted, lineHeight: 16 },
    disclaimer: { fontSize: 10, color: c.textMuted, marginTop: spacing.xs, fontStyle: 'italic' },
    thinking: { fontSize: typography.caption, color: c.textMuted, paddingHorizontal: spacing.sm },
    error: { fontSize: typography.caption, color: c.danger, paddingHorizontal: spacing.sm },
    clear: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
    clearText: { fontSize: typography.caption, color: c.primary, fontWeight: '600' },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: c.card,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: typography.body,
      color: c.text,
      backgroundColor: c.background,
    },
  })
