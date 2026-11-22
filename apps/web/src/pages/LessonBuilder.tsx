import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi, type BlockType, type LmsBlock } from '../api/lms'
import { errorMessage } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'
import { LessonBlocks, blockLabels } from '../components/LessonBlocks'
import { LessonDiscussion } from '../components/LessonDiscussion'

const palette: BlockType[] = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'pdf',
  'presentation',
  'file',
  'link',
  'assignment',
  'test',
  'interactive',
]

function draftSignature(blocks: LmsBlock[], title: string, duration: number): string {
  return JSON.stringify({ blocks, title, duration })
}

function newBlock(type: BlockType): LmsBlock {
  const base: LmsBlock = { id: crypto.randomUUID(), type }
  if (type === 'text') return { ...base, title: '', text: '' }
  if (type === 'interactive') return { ...base, title: '', prompt: '', options: ['', ''], correctOption: 0 }
  if (type === 'assignment') return { ...base, title: '', description: '', dueAt: '' }
  if (type === 'test') return { ...base, title: '', description: '', testId: undefined }
  return { ...base, title: '', url: '', caption: '', allowDownload: true }
}

/** Визуальный конструктор урока: блоки, автосохранение, ручные версии, материалы. */
export function LessonBuilderPage() {
  const { id = '', lessonId = '' } = useParams()
  const queryClient = useQueryClient()
  const builder = useQuery({
    queryKey: ['lms-builder', lessonId],
    queryFn: () => lmsApi.builder(lessonId),
    enabled: Boolean(lessonId),
  })
  const versions = useQuery({
    queryKey: ['lms-lesson-versions', lessonId],
    queryFn: () => lmsApi.lessonVersions(lessonId),
    enabled: Boolean(lessonId),
  })

  const [blocks, setBlocks] = useState<LmsBlock[]>([])
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(0)
  const initialised = useRef(false)
  const lastSaved = useRef('')
  const [loadedLessonId, setLoadedLessonId] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [materialForm, setMaterialForm] = useState({
    type: 'PDF',
    title: '',
    url: '',
    allowDownload: true,
  })
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!builder.data || builder.data.id !== lessonId) return
    if (loadedLessonId === builder.data.id) return
    initialised.current = true
    setBlocks(builder.data.blocks)
    setTitle(builder.data.title)
    setDuration(builder.data.durationMinutes)
    lastSaved.current = draftSignature(builder.data.blocks, builder.data.title, builder.data.durationMinutes)
    setLoadedLessonId(builder.data.id)
  }, [builder.data, lessonId, loadedLessonId])

  // Автосохранение: изменения уходят на сервер через 1,2 секунды после последней правки.
  useEffect(() => {
    if (!initialised.current || builder.data?.id !== lessonId || loadedLessonId !== lessonId) return
    const signature = draftSignature(blocks, title, duration)
    if (signature === lastSaved.current) return
    if (!title.trim()) {
      setSaveState('error')
      return
    }
    setSaveState('saving')
    const timer = setTimeout(async () => {
      try {
        const result = await lmsApi.saveBlocks(lessonId, {
          blocks,
          autosave: true,
          title,
          durationMinutes: duration,
        })
        lastSaved.current = signature
        setSaveState('saved')
        setSavedAt(new Date(result.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      } catch {
        setSaveState('error')
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [blocks, title, duration, lessonId, builder.data?.id, loadedLessonId])

  const manualSave = useMutation({
    mutationFn: () => {
      const signature = draftSignature(blocks, title, duration)
      return lmsApi
        .saveBlocks(lessonId, {
          blocks,
          autosave: false,
          title,
          durationMinutes: duration,
          note: 'Ручное сохранение',
        })
        .then((result) => ({ result, signature }))
    },
    onSuccess: ({ result, signature }) => {
      lastSaved.current = signature
      setSaveState('saved')
      setSavedAt(new Date(result.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      setNote('Версия урока сохранена.')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['lms-lesson-versions', lessonId] })
      queryClient.invalidateQueries({ queryKey: ['lms-builder', lessonId] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить версию')),
  })

  const restore = useMutation({
    mutationFn: async (version: number) => {
      await lmsApi.restoreLesson(lessonId, version)
      return lmsApi.builder(lessonId)
    },
    onSuccess: (data) => {
      initialised.current = true
      setBlocks(data.blocks)
      setTitle(data.title)
      setDuration(data.durationMinutes)
      lastSaved.current = draftSignature(data.blocks, data.title, data.durationMinutes)
      setSaveState('saved')
      setNote('Версия восстановлена.')
      queryClient.invalidateQueries({ queryKey: ['lms-lesson-versions', lessonId] })
      queryClient.invalidateQueries({ queryKey: ['lms-preview', id] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось восстановить версию')),
  })

  const addMaterial = useMutation({
    mutationFn: () =>
      lmsApi.addMaterial(lessonId, {
        type: materialForm.type,
        title: materialForm.title,
        url: materialForm.url,
        allowDownload: materialForm.allowDownload,
      }),
    onSuccess: () => {
      setMaterialForm({ type: 'PDF', title: '', url: '', allowDownload: true })
      queryClient.invalidateQueries({ queryKey: ['lms-builder', lessonId] })
      queryClient.invalidateQueries({ queryKey: ['lms-preview', id] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось добавить материал')),
  })

  const removeMaterial = useMutation({
    mutationFn: (materialId: string) => lmsApi.removeMaterial(materialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lms-builder', lessonId] })
      queryClient.invalidateQueries({ queryKey: ['lms-preview', id] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось удалить материал')),
  })

  const updateBlock = (blockId: string, patch: Partial<LmsBlock>) => {
    setBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, ...patch } : block)))
  }

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (item) next.splice(target, 0, item)
      return next
    })
  }

  const upload = async (file: File, onUrl: (url: string) => void) => {
    setUploading(true)
    try {
      const result = await lmsApi.upload(file)
      onUrl(result.url)
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Не удалось загрузить файл'))
    } finally {
      setUploading(false)
    }
  }

  if (builder.isLoading) return <div className="state">Загрузка урока…</div>
  if (builder.error) return <div className="alert alert-error">{errorMessage(builder.error)}</div>
  if (!builder.data) return null

  const lesson = builder.data

  return (
    <div className="stack">
      <PageHeader
        title={title || lesson.title}
        subtitle={`${lesson.course.title} · ${lesson.module.title} · версия ${builder.data.version}`}
        actions={
          <div className="row-actions">
            <Link className="button button-ghost" to={`/courses/${id}/edit`}>
              ← К курсу
            </Link>
            <Link className="button button-ghost" to={`/courses/${id}/preview`}>
              Предпросмотр курса
            </Link>
            <button className="button button-ghost" type="button" onClick={() => setPreviewMode((value) => !value)}>
              {previewMode ? 'Редактировать' : 'Предпросмотр урока'}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                if (!title.trim()) {
                  setError('Название урока не может быть пустым')
                  return
                }
                manualSave.mutate()
              }}
              disabled={manualSave.isPending || !title.trim()}
            >
              Сохранить версию
            </button>
          </div>
        }
      />

      <div className="row-actions">
        <span className={saveState === 'error' ? 'badge badge-rejected' : 'badge'}>
          {saveState === 'saving'
            ? 'Сохранение…'
            : saveState === 'error'
              ? 'Не сохранено'
              : savedAt
                ? `Сохранено в ${savedAt}`
                : 'Автосохранение включено'}
        </span>
        <span className="muted small">Блоков: {blocks.length}</span>
      </div>

      {note ? <div className="alert">{note}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {previewMode ? (
        <Section title="Предпросмотр урока" subtitle="Так урок увидит ученик">
          <input
            className="lesson-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Название урока"
          />
          <LessonBlocks blocks={blocks} />
        </Section>
      ) : (
        <div className="grid builder-grid">
          <div className="stack">
            <Section title="Урок" subtitle="Название и длительность">
              <div className="form-row">
                <label className="field">
                  <span>Название урока</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="field">
                  <span>Длительность, минут</span>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                  />
                </label>
              </div>
            </Section>

            <Section
              title="Конструктор"
              subtitle="Соберите урок из блоков: текст, медиа, файлы, задания, тесты и интерактив"
              action={
                <div className="palette">
                  {palette.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => setBlocks((current) => [...current, newBlock(type)])}
                    >
                      + {blockLabels[type]}
                    </button>
                  ))}
                </div>
              }
            >
              {blocks.length === 0 ? <Empty>Добавьте первый блок кнопками сверху.</Empty> : null}

              <div className="block-editor-list">
                {blocks.map((block, index) => (
                  <article className="block-card" key={block.id}>
                    <div className="block-card-head">
                      <span className="badge">{blockLabels[block.type]}</span>
                      <div className="row-actions">
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => moveBlock(index, -1)}
                          aria-label="Переместить блок выше"
                        >
                          ↑
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => moveBlock(index, 1)}
                          aria-label="Переместить блок ниже"
                        >
                          ↓
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}
                          aria-label="Удалить блок"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>

                    {block.type === 'text' ? (
                      <>
                        <label className="field">
                          <span>Заголовок</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Текст</span>
                          <textarea
                            rows={5}
                            value={block.text ?? ''}
                            onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}

                    {['image', 'video', 'audio', 'document', 'pdf', 'presentation', 'file'].includes(block.type) ? (
                      <>
                        <label className="field">
                          <span>Заголовок</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Ссылка на файл</span>
                          <input
                            value={block.url ?? ''}
                            onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                            placeholder="https://…"
                          />
                        </label>
                        <label className="field">
                          <span>Или загрузите файл (до 10 МБ)</span>
                          <input
                            type="file"
                            disabled={uploading}
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              if (file) upload(file, (url) => updateBlock(block.id, { url }))
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>Подпись</span>
                          <input
                            value={block.caption ?? ''}
                            onChange={(event) => updateBlock(block.id, { caption: event.target.value })}
                          />
                        </label>
                        {block.type !== 'link' ? (
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={block.allowDownload !== false}
                              onChange={(event) => updateBlock(block.id, { allowDownload: event.target.checked })}
                            />
                            Разрешить ученикам скачивать файл
                          </label>
                        ) : null}
                      </>
                    ) : null}

                    {block.type === 'link' ? (
                      <>
                        <label className="field">
                          <span>Заголовок</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Ссылка</span>
                          <input value={block.url ?? ''} onChange={(event) => updateBlock(block.id, { url: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Описание</span>
                          <input
                            value={block.description ?? ''}
                            onChange={(event) => updateBlock(block.id, { description: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}

                    {block.type === 'assignment' ? (
                      <>
                        <label className="field">
                          <span>Название задания</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Описание</span>
                          <textarea
                            rows={3}
                            value={block.description ?? ''}
                            onChange={(event) => updateBlock(block.id, { description: event.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Задание курса</span>
                          <select
                            value={block.homeworkId ?? ''}
                            onChange={(event) => updateBlock(block.id, { homeworkId: event.target.value || undefined })}
                          >
                            <option value="">Без привязки к заданию</option>
                            {lesson.homework.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Срок</span>
                          <input
                            type="datetime-local"
                            value={(block.dueAt ?? '').slice(0, 16)}
                            onChange={(event) => updateBlock(block.id, { dueAt: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}

                    {block.type === 'test' ? (
                      <>
                        <label className="field">
                          <span>Название теста</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Тест курса</span>
                          <select
                            value={block.testId ?? ''}
                            onChange={(event) => updateBlock(block.id, { testId: event.target.value || undefined })}
                          >
                            <option value="">Без привязки к тесту</option>
                            {lesson.tests.map((test) => (
                              <option key={test.id} value={test.id}>
                                {test.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Описание</span>
                          <input
                            value={block.description ?? ''}
                            onChange={(event) => updateBlock(block.id, { description: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}

                    {block.type === 'interactive' ? (
                      <>
                        <label className="field">
                          <span>Заголовок</span>
                          <input value={block.title ?? ''} onChange={(event) => updateBlock(block.id, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Вопрос</span>
                          <textarea
                            rows={2}
                            value={block.prompt ?? ''}
                            onChange={(event) => updateBlock(block.id, { prompt: event.target.value })}
                          />
                        </label>
                        <div className="field">
                          <span>Варианты ответа</span>
                          {(block.options ?? []).map((option, optionIndex) => (
                            <div className="row-actions" key={`${block.id}-opt-${optionIndex}`}>
                              <input
                                value={option}
                                onChange={(event) => {
                                  const options = [...(block.options ?? [])]
                                  options[optionIndex] = event.target.value
                                  updateBlock(block.id, { options })
                                }}
                              />
                              <label className="check-inline">
                                <input
                                  type="radio"
                                  name={`correct-${block.id}`}
                                  checked={block.correctOption === optionIndex}
                                  onChange={() => updateBlock(block.id, { correctOption: optionIndex })}
                                />
                                верный
                              </label>
                            </div>
                          ))}
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={() => updateBlock(block.id, { options: [...(block.options ?? []), ''] })}
                          >
                            + вариант
                          </button>
                        </div>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            </Section>
          </div>

          <div className="stack">
            <Section title="Материалы урока" subtitle="Файлы урока: скачивание можно разрешить или отключить">
              {lesson.materials.length === 0 ? <Empty>Материалов пока нет.</Empty> : null}
              <ul className="list">
                {lesson.materials.map((material) => (
                  <li key={material.id}>
                    <div>
                      <strong>{material.title}</strong>
                      <span className="muted small">
                        {' '}
                        · {material.type} · {material.allowDownload ? 'скачивание разрешено' : 'только просмотр'}
                      </span>
                    </div>
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => removeMaterial.mutate(material.id)}
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>

              <form
                className="stack-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  addMaterial.mutate()
                }}
              >
                <label className="field">
                  <span>Тип</span>
                  <select
                    value={materialForm.type}
                    onChange={(event) => setMaterialForm({ ...materialForm, type: event.target.value })}
                  >
                    {['VIDEO', 'AUDIO', 'DOCUMENT', 'PRESENTATION', 'PDF', 'FILE', 'IMAGE', 'LINK'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Название</span>
                  <input
                    value={materialForm.title}
                    onChange={(event) => setMaterialForm({ ...materialForm, title: event.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Ссылка</span>
                  <input
                    value={materialForm.url}
                    onChange={(event) => setMaterialForm({ ...materialForm, url: event.target.value })}
                    placeholder="https://…"
                    required
                  />
                </label>
                <label className="field">
                  <span>Или файл</span>
                  <input
                    type="file"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) upload(file, (url) => setMaterialForm((current) => ({ ...current, url })))
                    }}
                  />
                </label>
                {materialForm.type !== 'LINK' ? (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={materialForm.allowDownload}
                      onChange={(event) =>
                        setMaterialForm({ ...materialForm, allowDownload: event.target.checked })
                      }
                    />
                    Разрешить ученикам скачивать этот файл
                  </label>
                ) : null}
                <button className="button" type="submit" disabled={addMaterial.isPending}>
                  Добавить материал
                </button>
              </form>
            </Section>

            <LessonDiscussion lessonId={lessonId} canAnswer />

            <Section title="История версий урока" subtitle="Ручные сохранения">
              {versions.isLoading ? <p className="muted">Загрузка…</p> : null}
              {versions.data && versions.data.items.length === 0 ? (
                <Empty>Версий пока нет. Нажмите «Сохранить версию».</Empty>
              ) : null}
              <ul className="list">
                {versions.data?.items.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>Версия {version.version}</strong>
                      <span className="muted small"> · {formatDateTime(version.createdAt)}</span>
                      {version.note ? <p className="muted small">{version.note}</p> : null}
                    </div>
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Восстановить версию ${version.version}?`)) restore.mutate(version.version)
                      }}
                    >
                      Восстановить
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
