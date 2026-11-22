import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../../api/client'
import { communityApi, type ChatMessage } from '../../api/community'
import { conversationTypeLabels, formatDate, messageStatusLabel } from './shared'

export function ChatsPanel() {
  const session = getSession()
  const queryClient = useQueryClient()
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [attachment, setAttachment] = useState<{ name: string; url: string; mimeType?: string } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [newType, setNewType] = useState('DIRECT')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [targetUserId, setTargetUserId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null)
  const [olderLoading, setOlderLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const directory = useQuery({ queryKey: ['community-directory'], queryFn: communityApi.directory })
  const conversations = useQuery({
    queryKey: ['community-conversations', type, search],
    queryFn: () => communityApi.conversations({ ...(type ? { type } : {}), ...(search ? { q: search } : {}) }),
    refetchInterval: 20_000,
  })
  const thread = useQuery({
    queryKey: ['community-thread', selectedId, messageSearch],
    queryFn: () => communityApi.messages(selectedId, messageSearch ? { q: messageSearch } : {}),
    enabled: Boolean(selectedId),
    refetchInterval: 8_000,
  })

  useEffect(() => {
    setOlder([])
    setOlderHasMore(null)
  }, [selectedId, messageSearch])

  useEffect(() => {
    if (!selectedId) return
    void communityApi.markRead(selectedId).then(() => queryClient.invalidateQueries({ queryKey: ['community-conversations'] }))
  }, [selectedId, thread.data?.items.length, queryClient])

  const start = useMutation({
    mutationFn: () => {
      if (newType === 'DIRECT' || newType === 'PARENT_TEACHER') {
        if (!targetUserId) throw new Error('Выберите собеседника')
        return communityApi.startConversation({ type: newType, userId: targetUserId })
      }
      if (newType === 'GROUP') {
        if (!newTitle.trim()) throw new Error('Укажите название группы')
        if (participantIds.length === 0) throw new Error('Добавьте участников')
        return communityApi.startConversation({ type: newType, title: newTitle.trim(), description: newDescription.trim() || undefined, participantIds })
      }
      if (!courseId) throw new Error('Выберите курс')
      if (!newTitle.trim()) throw new Error('Укажите тему обсуждения')
      return communityApi.startConversation({ type: 'TOPIC', courseId, title: newTitle.trim(), description: newDescription.trim() || undefined })
    },
    onSuccess: (result) => {
      setFormOpen(false)
      setNewTitle('')
      setNewDescription('')
      setTargetUserId('')
      setParticipantIds([])
      setSelectedId(result.id)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['community-conversations'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const send = useMutation({
    mutationFn: () =>
      communityApi.sendMessage(selectedId, {
        body: message.trim(),
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    onSuccess: () => {
      setMessage('')
      setAttachment(null)
      if (fileInput.current) fileInput.current.value = ''
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['community-thread', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['community-conversations'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const upload = useMutation({
    mutationFn: communityApi.upload,
    onSuccess: (file) => setAttachment({ name: file.name, url: file.url, mimeType: file.mimeType }),
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось загрузить файл')),
  })

  const visibleMessages = [...older, ...(thread.data?.items ?? [])]
  const canLoadOlder = olderHasMore ?? thread.data?.hasMore ?? false
  const conversationItems = (conversations.data?.items ?? []).filter((item) => !unreadOnly || item.unread > 0)

  const loadOlder = async () => {
    if (!selectedId || olderLoading || !visibleMessages.length) return
    setOlderLoading(true)
    try {
      const page = await communityApi.messages(selectedId, {
        before: visibleMessages[0].createdAt,
        ...(messageSearch ? { q: messageSearch } : {}),
      })
      setOlder((current) => [...page.items, ...current])
      setOlderHasMore(page.hasMore)
      setError(null)
    } catch (loadError) {
      setError(errorMessage(loadError, 'Не удалось загрузить историю'))
    } finally {
      setOlderLoading(false)
    }
  }

  const activeConversation = thread.data?.conversation ?? conversations.data?.items.find((item) => item.id === selectedId) ?? null
  const allPeople = [
    ...(directory.data?.teachers ?? []).map((person) => ({ ...person, role: 'TEACHER' })),
    ...(directory.data?.students ?? []).map((person) => ({ ...person, role: 'STUDENT' })),
  ]
  const people = ['ADMIN', 'MANAGER', 'TEACHER'].includes(session?.role ?? '')
    ? allPeople
    : allPeople.filter((person) => person.role === 'TEACHER')

  return (
    <div className="community-chat-layout">
      <section className="card stack community-list">
        <div className="row-between">
          <h2>Диалоги</h2>
          <button className="button button-small" type="button" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? 'Скрыть' : 'Новый чат'}
          </button>
        </div>

        {formOpen ? (
          <form
            className="stack community-create"
            onSubmit={(event) => {
              event.preventDefault()
              start.mutate()
            }}
          >
            <label className="field">
              <span>Тип</span>
              <select value={newType} onChange={(event) => setNewType(event.target.value)}>
                <option value="DIRECT">Личный чат</option>
                {session?.role === 'PARENT' ? <option value="PARENT_TEACHER">Родитель — наставник</option> : null}
                {['ADMIN', 'MANAGER', 'TEACHER'].includes(session?.role ?? '') ? <option value="GROUP">Групповой чат</option> : null}
                <option value="TOPIC">Обсуждение по теме</option>
              </select>
            </label>

            {newType === 'DIRECT' || newType === 'PARENT_TEACHER' ? (
              <label className="field">
                <span>Собеседник</span>
                <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}>
                  <option value="">— выберите —</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.firstName} {person.lastName} · {person.role === 'TEACHER' ? 'наставник' : 'ученик'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {newType === 'GROUP' ? (
              <label className="field">
                <span>Участники</span>
                <select
                  multiple
                  size={5}
                  value={participantIds}
                  onChange={(event) => setParticipantIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.firstName} {person.lastName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {newType === 'TOPIC' ? (
              <label className="field">
                <span>Курс</span>
                <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                  <option value="">— выберите —</option>
                  {(directory.data?.courses ?? []).map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {newType !== 'DIRECT' && newType !== 'PARENT_TEACHER' ? (
              <>
                <label className="field">
                  <span>{newType === 'GROUP' ? 'Название группы' : 'Тема обсуждения'}</span>
                  <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Например, подготовка к экзамену" />
                </label>
                <label className="field">
                  <span>Описание</span>
                  <textarea rows={2} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
                </label>
              </>
            ) : null}

            <button className="button" type="submit" disabled={start.isPending}>
              {start.isPending ? 'Создаём…' : 'Создать чат'}
            </button>
          </form>
        ) : null}

        <div className="filters">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по чатам" aria-label="Поиск по чатам" />
          <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Фильтр по типу чата">
            <option value="">Все чаты</option>
            {Object.entries(conversationTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
            <span>Только непрочитанные</span>
          </label>
        </div>

        {conversations.isLoading ? <p className="muted">Загрузка диалогов…</p> : null}
        {conversations.error ? <div className="alert alert-error">{errorMessage(conversations.error)}</div> : null}
        <div className="community-conversations">
          {conversationItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === selectedId ? 'community-conversation community-conversation-active' : 'community-conversation'}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="community-conversation-head">
                <strong>
                  {item.isPinned ? '📌 ' : ''}
                  {item.title}
                </strong>
                {item.unread > 0 ? <span className="badge">{item.unread}</span> : null}
              </span>
              <span className="muted small">
                {conversationTypeLabels[item.type] ?? item.type} · {item.lastMessage?.body ?? 'Нет сообщений'}
              </span>
            </button>
          ))}
          {conversationItems.length === 0 && !conversations.isLoading ? (
            <p className="muted">
              {unreadOnly ? 'Непрочитанных чатов нет.' : 'Чатов пока нет. Начните личный диалог или обсуждение.'}
            </p>
          ) : null}
        </div>
      </section>

      <section className="card stack community-thread">
        {!selectedId ? (
          <div className="state">Выберите чат слева, чтобы открыть историю общения.</div>
        ) : (
          <>
            <div className="row-between">
              <div>
                <h2>{activeConversation?.title ?? 'Чат'}</h2>
                <p className="muted small">
                  {activeConversation ? conversationTypeLabels[activeConversation.type] ?? activeConversation.type : ''}
                  {activeConversation?.description ? ` · ${activeConversation.description}` : ''}
                </p>
              </div>
              <input
                className="community-search"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Поиск в истории"
                aria-label="Поиск по сообщениям"
              />
            </div>

            {error ? <div className="alert alert-error">{error}</div> : null}
            <div className="community-messages" aria-live="polite">
              {thread.isLoading ? <p className="muted">Загрузка сообщений…</p> : null}
              {canLoadOlder ? (
                <button className="button button-ghost button-small" type="button" onClick={() => void loadOlder()} disabled={olderLoading}>
                  {olderLoading ? 'Загружаем историю…' : 'Показать более ранние сообщения'}
                </button>
              ) : null}
              {visibleMessages.map((item: ChatMessage) => {
                const mine = item.sender.id === session?.id
                return (
                  <article key={item.id} className={mine ? 'community-message community-message-mine' : 'community-message'}>
                    <div className="community-message-meta">
                      <strong>
                        {item.sender.firstName} {item.sender.lastName}
                      </strong>
                      <time className="muted small">{formatDate(item.createdAt)}</time>
                    </div>
                    {item.body ? <p>{item.body}</p> : null}
                    {(item.attachments ?? []).map((file) => (
                      <a key={file.url} className="file-link" href={file.url} target="_blank" rel="noreferrer">
                        📎 {file.name}
                      </a>
                    ))}
                    <span className="muted small">{mine ? messageStatusLabel(item) : ''}</span>
                  </article>
                )
              })}
              {visibleMessages.length === 0 && !thread.isLoading ? <p className="muted">Сообщений пока нет.</p> : null}
            </div>

            <form
              className="community-compose"
              onSubmit={(event) => {
                event.preventDefault()
                if (!message.trim() && !attachment) return
                send.mutate()
              }}
            >
              <textarea
                rows={2}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Написать сообщение…"
                aria-label="Новое сообщение"
              />
              <div className="row-between">
                <div className="row-actions">
                  <label className="button button-ghost button-small">
                    {upload.isPending ? 'Загружаем…' : 'Прикрепить файл'}
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) upload.mutate(file)
                      }}
                    />
                  </label>
                  {attachment ? (
                    <button className="link-button" type="button" onClick={() => setAttachment(null)}>
                      {attachment.name} ×
                    </button>
                  ) : null}
                </div>
                <button className="button" type="submit" disabled={send.isPending || upload.isPending}>
                  {send.isPending ? 'Отправляем…' : 'Отправить'}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

