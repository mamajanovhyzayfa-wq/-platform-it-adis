import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { communityApi, type Attachment } from '../../api/community'
import { audienceLabels, formatDate } from './shared'

export function AnnouncementsPanel({ staff }: { staff: boolean }) {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('ALL')
  const [courseId, setCourseId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [search, setSearch] = useState('')
  const [audienceFilter, setAudienceFilter] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const attachmentInput = useRef<HTMLInputElement>(null)

  const directory = useQuery({ queryKey: ['community-directory'], queryFn: communityApi.directory })
  const announcements = useQuery({
    queryKey: ['community-announcements', search, audienceFilter],
    queryFn: () =>
      communityApi.announcements({
        ...(search.trim() ? { q: search.trim() } : {}),
        ...(audienceFilter ? { audience: audienceFilter } : {}),
      }),
  })

  const upload = useMutation({
    mutationFn: communityApi.upload,
    onSuccess: (file) => setAttachment({ name: file.name, url: file.url, mimeType: file.mimeType }),
    onError: (error) => setNotice(errorMessage(error, 'Не удалось загрузить файл')),
  })

  const create = useMutation({
    mutationFn: () =>
      communityApi.createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === 'COURSE' ? { courseId } : {}),
        isPinned: pinned,
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    onSuccess: () => {
      setNotice('Объявление опубликовано, получатели уведомлены')
      setFormOpen(false)
      setTitle('')
      setBody('')
      setAttachment(null)
      if (attachmentInput.current) attachmentInput.current.value = ''
      void queryClient.invalidateQueries({ queryKey: ['community-announcements'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}
      <div className="row-between">
        <p className="muted">Объявления для всей платформы, ролей и отдельных курсов.</p>
        {staff ? (
          <button className="button" type="button" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? 'Скрыть форму' : 'Новое объявление'}
          </button>
        ) : null}
      </div>

      {staff && formOpen ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <h2>Новое объявление</h2>
          <div className="form-grid">
            <label className="field">
              <span>Заголовок</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Аудитория</span>
              <select value={audience} onChange={(event) => setAudience(event.target.value)}>
                <option value="ALL">Все</option>
                <option value="STUDENTS">Ученики</option>
                <option value="PARENTS">Родители</option>
                <option value="TEACHERS">Наставники</option>
                <option value="MANAGERS">Менеджеры</option>
                <option value="COURSE">Курс</option>
              </select>
            </label>
            {audience === 'COURSE' ? (
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
          </div>
          <label className="field">
            <span>Текст</span>
            <textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className="row-actions">
            <label className="button button-ghost button-small">
              {upload.isPending ? 'Загружаем…' : 'Прикрепить файл'}
              <input
                ref={attachmentInput}
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
          <label className="switch">
            <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
            <span>Закрепить</span>
          </label>
          <div className="row-actions">
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Публикуем…' : 'Опубликовать'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      <div className="filters">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск объявлений"
          aria-label="Поиск объявлений"
        />
        <select value={audienceFilter} onChange={(event) => setAudienceFilter(event.target.value)} aria-label="Аудитория объявления">
          <option value="">Все аудитории</option>
          {Object.entries(audienceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {announcements.isLoading ? <p className="muted">Загрузка объявлений…</p> : null}
      {announcements.error ? <div className="alert alert-error">{errorMessage(announcements.error)}</div> : null}
      <div className="stack">
        {(announcements.data ?? []).map((item) => (
          <article key={item.id} className="card stack">
            <div className="row-between">
              <div>
                <h2>
                  {item.isPinned ? '📌 ' : ''}
                  {item.title}
                </h2>
                <p className="muted small">
                  {item.createdBy.firstName} {item.createdBy.lastName} · {formatDate(item.publishedAt)}
                  {item.course ? ` · ${item.course.title}` : ''}
                </p>
              </div>
              <span className="badge">{audienceLabels[item.audience] ?? item.audience}</span>
            </div>
            <p className="announcement-body">{item.body}</p>
            {(item.attachments ?? []).map((file) => (
              <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="file-link">
                📎 {file.name}
              </a>
            ))}
            {item.expiresAt ? <p className="muted small">До {formatDate(item.expiresAt)}</p> : null}
          </article>
        ))}
        {(announcements.data ?? []).length === 0 && !announcements.isLoading ? (
          <div className="state">{search || audienceFilter ? 'По фильтрам объявлений не найдено.' : 'Объявлений пока нет.'}</div>
        ) : null}
      </div>
    </div>
  )
}

