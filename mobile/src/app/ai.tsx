import { useRef, useState } from 'react'
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
import { api, type AiMessage } from '@/api/api'
import { describeApiError } from '@/api/client'
import { Button, Card, ErrorState, Loader } from '@/components/ui'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

/**
 * AI-помощник по коду.
 *
 * Экран не хранит ключ модели: запросы идут на наш сервер, который добавляет системный
 * промпт «наставника» — помощник объясняет и задаёт вопросы, но не выдаёт готовое решение.
 */
export default function AiScreen() {
  const { t } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [text, setText] = useState('')
  const scrollRef = useRef<ScrollViewInstance>(null)

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus, retry: 1 })

  const ask = useMutation({
    mutationFn: (payload: AiMessage[]) => api.aiChat({ messages: payload }),
    onSuccess: (result, payload) => {
      setMessages([...payload, { role: 'assistant', content: result.reply }])
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
    ask.mutate(next.slice(-12))
  }

  if (status.isLoading) return <Loader />

  if (status.data && !status.data.configured) {
    return (
      <View style={styles.page}>
        <ErrorState title={t('ai.title')} message={t('ai.notConfigured')} onRetry={() => void status.refetch()} />
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
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.list}>
        {messages.length === 0 ? (
          <Card>
            <Text style={styles.intro}>{t('ai.intro')}</Text>
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
            <Text style={[styles.body, message.role === 'user' && styles.userBody]}>{message.content}</Text>
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
    list: { padding: spacing.md, gap: spacing.sm },
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
    body: { fontSize: typography.body, color: c.text, lineHeight: 21 },
    userBody: { color: c.onPrimary },
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
