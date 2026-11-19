import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChatAttachment, type ChatMessage } from '@/api/api'
import { describeApiError } from '@/api/client'
import { Button, IconButton, Loader, useToast } from '@/components/ui'
import { connectSocket } from '@/services/socket'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

/**
 * Переписка: личный диалог или чат курса.
 *
 * Поддерживает текст, фото и файлы (загрузка через /api/uploads), отметки о прочтении
 * и живые обновления по Socket.IO. Вложения необязательны: если текста нет, сообщением
 * становится имя файла, чтобы собеседник видел контекст в списке переписок.
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = String(id)
  const queryClient = useQueryClient()
  const me = useAuthStore((state) => state.user)
  const { t, locale } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const toast = useToast()

  const [text, setText] = useState('')
  const [typingName, setTypingName] = useState<string | null>(null)
  const [extraMessages, setExtraMessages] = useState<ChatMessage[]>([])
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [readAt, setReadAt] = useState<string | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    const timer = setTimeout(() => setActiveSearch(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.conversation(conversationId),
  })

  const messages = useQuery({
    queryKey: ['messages', conversationId, activeSearch],
    queryFn: () => api.messages(conversationId, activeSearch ? { q: activeSearch } : undefined),
  })

  const send = useMutation({
    mutationFn: (payload: { body: string; attachments?: ChatAttachment[] }) =>
      api.sendMessage(conversationId, payload.body, payload.attachments),
    onSuccess: (message) => {
      setText('')
      setAttachment(null)
      setExtraMessages((current) => [...current, message])
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (error) => toast.error(`${t('chat.sendFailed')}: ${describeApiError(error)}`),
  })

  const markRead = useCallback(() => {
    api
      .markConversationRead(conversationId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => undefined)
  }, [conversationId, queryClient])

  useEffect(() => {
    markRead()
  }, [markRead])

  useEffect(() => {
    const socket = connectSocket()
    if (!socket) return

    socket.emit('conversation:join', conversationId)

    const onMessage = (payload: { conversationId: string; message: ChatMessage }) => {
      if (payload.conversationId !== conversationId) return
      setExtraMessages((current) =>
        current.some((item) => item.id === payload.message.id) ? current : [...current, payload.message],
      )
      markRead()
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
    const onTyping = (payload: { conversationId: string; name: string | null }) => {
      if (payload.conversationId !== conversationId) return
      setTypingName(payload.name ?? '…')
      setTimeout(() => setTypingName(null), 2500)
    }
    const onRead = (payload: { conversationId: string; userId: string; readAt: string }) => {
      if (payload.conversationId !== conversationId || payload.userId === me?.id) return
      setReadAt(payload.readAt)
      setExtraMessages((current) => current.map((item) => (item.isMine ? { ...item, readByOthers: true } : item)))
    }

    socket.on('message:new', onMessage)
    socket.on('typing', onTyping)
    socket.on('conversation:read', onRead)

    return () => {
      socket.emit('conversation:leave', conversationId)
      socket.off('message:new', onMessage)
      socket.off('typing', onTyping)
      socket.off('conversation:read', onRead)
    }
  }, [conversationId, markRead, queryClient, me?.id])

  const typingSentAt = useRef(0)

  const onChangeText = (value: string) => {
    setText(value)
    const socket = connectSocket()
    const now = Date.now()
    if (socket?.connected && now - typingSentAt.current > 1500) {
      typingSentAt.current = now
      socket.emit('typing', { conversationId, name: me ? `${me.firstName} ${me.lastName}` : null })
    }
  }

  const upload = async (file: { uri: string; name: string; mimeType: string }) => {
    setUploading(true)
    try {
      const uploaded = await api.uploadAttachment(file)
      setAttachment(uploaded)
    } catch (error) {
      toast.error(`${t('chat.uploadFailed')}: ${describeApiError(error)}`)
    } finally {
      setUploading(false)
    }
  }

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(t('chat.photo'), t('chat.photoPermission'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    await upload({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    })
  }

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    await upload({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
    })
  }

  const openAttachmentMenu = () => {
    Alert.alert(t('chat.placeholder'), undefined, [
      { text: t('chat.photo'), onPress: () => void pickPhoto() },
      { text: t('chat.file'), onPress: () => void pickFile() },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }

  const submit = () => {
    const body = text.trim() || attachment?.name || ''
    if (body.length === 0) return
    send.mutate({ body, attachments: attachment ? [attachment] : undefined })
  }

  const confirmReport = (message: ChatMessage) => {
    Alert.alert(t('chat.reportTitle'), t('chat.reportQuestion'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.report'),
        style: 'destructive',
        onPress: () =>
          api
            .reportMessage(message.id)
            .then(() => toast.success(`${t('chat.reported')} ${t('chat.reportedHint')}`))
            .catch(() => toast.error(t('chat.reportFailed'))),
      },
    ])
  }

  if (messages.isLoading && !messages.data) return <Loader />

  const serverMessages = messages.data?.items ?? []
  const all = [...serverMessages.filter((item) => !extraMessages.some((extra) => extra.id === item.id)), ...extraMessages]
  const readMoment = readAt ? new Date(readAt) : null

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {conversation.data?.title ?? t('chat.title')}
        </Text>
        {conversation.data ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {conversation.data.participants.map((item) => item.name).join(', ')}
          </Text>
        ) : null}
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('chat.search')}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      <FlatList
        ref={listRef}
        data={all}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {activeSearch ? t('chat.searchEmpty') : t('chat.noMessagesHint')}
          </Text>
        }
        renderItem={({ item }) => {
          const attachments = item.attachments ?? []
          const read =
            item.isMine &&
            (item.readByOthers || Boolean(readMoment && readMoment >= new Date(item.createdAt)))

          return (
            <Pressable
              onLongPress={() => confirmReport(item)}
              style={[styles.bubble, item.isMine ? styles.mine : styles.theirs]}
            >
              {!item.isMine ? (
                <Text style={styles.sender}>
                  {item.sender.firstName} {item.sender.lastName}
                </Text>
              ) : null}

              {attachments.map((file) =>
                file.isImage || /\.(jpg|jpeg|png|webp|gif|heic)$/i.test(file.name) ? (
                  <Pressable key={file.url} onPress={() => void Linking.openURL(file.url)}>
                    <Image source={{ uri: file.url }} style={styles.image} resizeMode="cover" />
                  </Pressable>
                ) : (
                  <Pressable key={file.url} onPress={() => void Linking.openURL(file.url)} style={styles.fileRow}>
                    <Text style={[styles.fileName, item.isMine && styles.bodyMine]} numberOfLines={1}>
                      📎 {file.name}
                    </Text>
                    <Text style={[styles.fileHint, item.isMine && styles.timeMine]}>
                      {file.size ? `${Math.max(1, Math.round(file.size / 1024))} КБ` : t('chat.open')}
                    </Text>
                  </Pressable>
                ),
              )}

              {item.body && item.body !== attachments[0]?.name ? (
                <Text style={[styles.body, item.isMine && styles.bodyMine]}>{item.body}</Text>
              ) : null}

              <View style={styles.metaRow}>
                <Text style={[styles.time, item.isMine && styles.timeMine]}>
                  {new Date(item.createdAt).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                {item.isMine ? (
                  <Text style={[styles.receipt, item.isMine && styles.timeMine]}>
                    {read ? `✓✓ ${t('chat.read')}` : '✓'}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
      />

      {typingName ? (
        <Text style={styles.typing}>
          {typingName} {t('chat.typing')}
        </Text>
      ) : null}

      {attachment || uploading ? (
        <View style={styles.attachmentPreview}>
          {uploading ? (
            <Text style={styles.muted}>{t('chat.uploading')}</Text>
          ) : (
            <>
              <Text style={styles.muted} numberOfLines={1}>
                📎 {attachment?.name}
              </Text>
              <Pressable onPress={() => setAttachment(null)} accessibilityRole="button">
                <Text style={styles.remove}>✕</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      <View style={styles.composer}>
        <IconButton
          icon="+"
          accessibilityLabel={t('chat.photo')}
          variant="soft"
          onPress={openAttachmentMenu}
          disabled={uploading}
        />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={4000}
        />
        <Button
          title="→"
          fullWidth={false}
          loading={send.isPending}
          disabled={send.isPending || uploading || (text.trim().length === 0 && !attachment)}
          onPress={submit}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text },
    headerSubtitle: { fontSize: typography.tiny, color: c.textMuted },
    searchInput: {
      marginTop: spacing.xs,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      fontSize: typography.caption,
      color: c.text,
      backgroundColor: c.background,
    },
    list: { padding: spacing.md, gap: spacing.sm },
    empty: { textAlign: 'center', color: c.textMuted, marginTop: spacing.xl },
    bubble: { maxWidth: '84%', padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.xs },
    mine: { alignSelf: 'flex-end', backgroundColor: c.primary },
    theirs: { alignSelf: 'flex-start', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    sender: { fontSize: typography.tiny, fontWeight: '600', color: c.primary, marginBottom: 2 },
    body: { fontSize: typography.body, color: c.text },
    bodyMine: { color: c.onPrimary },
    image: { width: 210, height: 150, borderRadius: radius.sm, marginBottom: spacing.xs },
    fileRow: { gap: 2, marginBottom: spacing.xs },
    fileName: { fontSize: typography.caption, color: c.text, fontWeight: '600' },
    fileHint: { fontSize: typography.tiny, color: c.textMuted },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: 2 },
    time: { fontSize: typography.tiny, color: c.textMuted },
    timeMine: { color: c.onPrimary },
    receipt: { fontSize: typography.tiny, color: c.textMuted },
    typing: { paddingHorizontal: spacing.lg, fontSize: typography.tiny, color: c.textMuted },
    attachmentPreview: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      backgroundColor: c.cardMuted,
    },
    muted: { fontSize: typography.caption, color: c.textMuted, flexShrink: 1 },
    remove: { color: c.danger, fontSize: typography.body, fontWeight: '700' },
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
