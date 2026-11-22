import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../api/lms'
import { errorMessage } from '../api/client'
import { Empty, Progress, formatDateTime } from '../components/ui'
import { LessonBlocks } from '../components/LessonBlocks'
import { LessonDiscussion } from '../components/LessonDiscussion'

/** Учебный просмотр курса: все уроки открыты сразу, материалы, заметки, закладки и выделения. */
export function LearnCoursePage() {
  const { courseId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const course = useQuery({
    queryKey: ['learn-course', courseId],
    queryFn: () => lmsApi.learnCourse(courseId),
    enabled: Boolean(courseId),
  })
  const lessonId = params.get('lesson') ?? ''

  useEffect(() => {
    if (!lessonId && course.data) {
      const first = course.data.modules.flatMap((module) => module.lessons)[0]
      if (first) setParams({ lesson: first.id }, { replace: true })
    }
  }, [lessonId, course.data, setParams])

  const lesson = useQuery({
    queryKey: ['learn-lesson', lessonId],
    queryFn: () => lmsApi.learnLesson(lessonId),
    enabled: Boolean(lessonId),
  })

  const [note, setNote] = useState('')
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null)
  const [highlightDraft, setHighlightDraft] = useState<Record<string, { quote: string; note: string; color: string }>>({})

  useEffect(() => {
    if (lesson.data) {
      setNote(lesson.data.note)
      setNoteSavedAt(null)
    }
  }, [lesson.data?.id, lesson.data?.note])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['learn-lesson', lessonId] })
    queryClient.invalidateQueries({ queryKey: ['learn-course', courseId] })
    queryClient.invalidateQueries({ queryKey: ['portal-student'] })
    queryClient.invalidateQueries({ queryKey: ['lms-library'] })
  }

  const bookmark = useMutation({
    mutationFn: (materialId: string) => lmsApi.toggleBookmark(materialId),
    onSuccess: invalidate,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить закладку')),
  })

  const highlight = useMutation({
    mutationFn: ({ materialId, quote, noteText, color }: { materialId: string; quote: string; noteText: string; color: string }) =>
      lmsApi.addHighlight(materialId, { quote, ...(noteText ? { note: noteText } : {}), color }),
    onSuccess: () => {
      setHighlightDraft({})
      invalidate()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить выделение')),
  })

  const saveNote = useMutation({
    mutationFn: () => lmsApi.saveNote(lessonId, note),
    onSuccess: (result) => {
      setNoteSavedAt(new Date(result.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      queryClient.invalidateQueries({ queryKey: ['lms-library'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить заметку')),
  })

  const complete = useMutation({
    mutationFn: () => lmsApi.complete(lessonId),
    onSuccess: invalidate,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось завершить урок')),
  })

  if (course.isLoading) return <div className="state">Загрузка курса…</div>
  if (course.error) return <div className="alert alert-error">{errorMessage(course.error)}</div>
  if (!course.data) return null

  const data = course.data
  const allLessons = data.modules.flatMap((module) => module.lessons)

  return (
    <div className="stack">
      <div className="learn-head">
        <div>
          <Link className="link" to="/student">
            ← В кабинет
          </Link>
          <h1>{data.title}</h1>
          <p className="muted small">
            Наставник: {data.teacher} · уроков: {data.lessonsCount} · доступны все уроки сразу
          </p>
        </div>
        <div className="learn-progress">
          <Progress value={data.progress} label="Прогресс курса" />
          <span className="muted small">
            {data.completedLessons} из {data.lessonsCount} уроков
          </span>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="learn-layout">
        <aside className="card learn-sidebar" aria-label="Программа курса">
          {data.modules.map((module) => (
            <div key={module.id} className="learn-module">
              <h3>{module.title}</h3>
              <ul>
                {module.lessons.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === lessonId ? 'learn-lesson learn-lesson-active' : 'learn-lesson'}
                      onClick={() => setParams({ lesson: item.id })}
                      aria-current={item.id === lessonId ? 'page' : undefined}
                    >
                      <span className={item.completed ? 'lesson-dot lesson-dot-done' : 'lesson-dot'} aria-hidden="true" />
                      <span>{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="card learn-content">
          {lesson.isLoading ? <p className="muted">Загрузка урока…</p> : null}
          {lesson.error ? <div className="alert alert-error">{errorMessage(lesson.error)}</div> : null}
          {!lessonId || allLessons.length === 0 ? <Empty>В курсе пока нет уроков.</Empty> : null}

          {lesson.data ? (
            <div className="stack">
              <header>
                <p className="eyebrow">{lesson.data.module.title}</p>
                <h2>{lesson.data.title}</h2>
                <p className="muted small">
                  {lesson.data.durationMinutes} мин
                  {lesson.data.progress?.completedAt ? ` · завершён ${formatDateTime(lesson.data.progress.completedAt)}` : ''}
                </p>
              </header>

              {lesson.data.description ? <p className="muted">{lesson.data.description}</p> : null}
              <LessonBlocks
                blocks={lesson.data.blocks}
                studentMode
                testIds={lesson.data.tests.map((test) => test.id)}
              />

              {lesson.data.materials.length > 0 ? (
                <section>
                  <h3>Материалы</h3>
                  <ul className="material-list">
                    {lesson.data.materials.map((material) => {
                      const draft = highlightDraft[material.id] ?? { quote: '', note: '', color: 'yellow' }
                      return (
                        <li key={material.id} className="material-item">
                          <div className="material-head">
                            <span className="badge">{material.type}</span>
                            <a href={material.url} target="_blank" rel="noreferrer">
                              {material.title}
                            </a>
                            {material.type !== 'LINK' ? (
                              material.allowDownload ? (
                                <a
                                  className="button button-ghost button-small"
                                  href={material.url}
                                  download
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Скачать
                                </a>
                              ) : (
                                <span className="chip">только просмотр</span>
                              )
                            ) : null}
                            <button
                              className={material.bookmarked ? 'button button-small' : 'button button-ghost button-small'}
                              type="button"
                              onClick={() => bookmark.mutate(material.id)}
                              aria-pressed={material.bookmarked}
                            >
                              {material.bookmarked ? 'В закладках' : 'В закладки'}
                            </button>
                          </div>

                          {material.highlights.length > 0 ? (
                            <ul className="highlight-list">
                              {material.highlights.map((item) => (
                                <li key={item.id} className={`highlight highlight-${item.color}`}>
                                  <blockquote>«{item.quote}»</blockquote>
                                  {item.note ? <p className="muted small">{item.note}</p> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          <form
                            className="highlight-form"
                            onSubmit={(event) => {
                              event.preventDefault()
                              if (draft.quote.trim().length < 2) return
                              highlight.mutate({
                                materialId: material.id,
                                quote: draft.quote,
                                noteText: draft.note,
                                color: draft.color,
                              })
                            }}
                          >
                            <input
                              placeholder="Выделить фрагмент или мысль"
                              value={draft.quote}
                              onChange={(event) =>
                                setHighlightDraft({ ...highlightDraft, [material.id]: { ...draft, quote: event.target.value } })
                              }
                              aria-label={`Выделение для материала ${material.title}`}
                            />
                            <select
                              value={draft.color}
                              onChange={(event) =>
                                setHighlightDraft({ ...highlightDraft, [material.id]: { ...draft, color: event.target.value } })
                              }
                              aria-label="Цвет выделения"
                            >
                              <option value="yellow">жёлтый</option>
                              <option value="green">зелёный</option>
                              <option value="blue">синий</option>
                              <option value="pink">розовый</option>
                            </select>
                            <input
                              placeholder="Комментарий"
                              value={draft.note}
                              onChange={(event) =>
                                setHighlightDraft({ ...highlightDraft, [material.id]: { ...draft, note: event.target.value } })
                              }
                              aria-label="Комментарий к выделению"
                            />
                            <button className="button button-ghost button-small" type="submit">
                              Выделить
                            </button>
                          </form>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ) : null}

              {lesson.data.homework ? (
                <section className="block block-note">
                  <span className="badge">Домашнее задание</span>
                  <strong>{lesson.data.homework.title}</strong>
                  <p>{lesson.data.homework.description}</p>
                  <p className="muted small">Срок: {formatDateTime(lesson.data.homework.dueAt)}</p>
                </section>
              ) : null}

              <section>
                <h3>Мои заметки</h3>
                <textarea
                  rows={4}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Конспект урока: виден только вам"
                  aria-label="Личная заметка к уроку"
                />
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <button className="button button-small" type="button" onClick={() => saveNote.mutate()} disabled={saveNote.isPending}>
                    Сохранить заметку
                  </button>
                  {noteSavedAt ? <span className="muted small">Сохранено в {noteSavedAt}</span> : null}
                </div>
              </section>

              <LessonDiscussion lessonId={lesson.data.id} />

              <div className="row-actions learn-nav">
                {lesson.data.prevLesson ? (
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={() => setParams({ lesson: lesson.data?.prevLesson?.id ?? '' })}
                  >
                    ← {lesson.data.prevLesson.title}
                  </button>
                ) : null}
                <button
                  className="button"
                  type="button"
                  onClick={() => complete.mutate()}
                  disabled={lesson.data.progress?.status === 'COMPLETED'}
                >
                  {lesson.data.progress?.status === 'COMPLETED' ? 'Урок завершён' : 'Завершить урок'}
                </button>
                {lesson.data.nextLesson ? (
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={() => setParams({ lesson: lesson.data?.nextLesson?.id ?? '' })}
                  >
                    {lesson.data.nextLesson.title} →
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
