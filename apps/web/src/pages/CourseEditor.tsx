import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../api/lms'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, StatusBadge, formatDateTime } from '../components/ui'

const approvalLabels: Record<string, string> = {
  DRAFT: 'Черновик',
  PENDING_REVIEW: 'На согласовании',
  APPROVED: 'Одобрен',
  REJECTED: 'Отклонён',
}

/** Редактор курса: метаданные, модули, уроки, версии, согласование и статистика. */
export function CourseEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = getSession()

  const preview = useQuery({ queryKey: ['lms-preview', id], queryFn: () => lmsApi.preview(id), enabled: Boolean(id) })
  const versions = useQuery({
    queryKey: ['lms-course-versions', id],
    queryFn: () => lmsApi.courseVersions(id),
    enabled: Boolean(id),
  })
  const [tab, setTab] = useState<'content' | 'stats' | 'participants'>('content')
  const stats = useQuery({
    queryKey: ['lms-stats', id],
    queryFn: () => lmsApi.stats(id),
    enabled: Boolean(id) && tab === 'stats',
  })
  const participants = useQuery({
    queryKey: ['lms-participants', id],
    queryFn: () => lmsApi.participants(id),
    enabled: Boolean(id) && tab === 'participants',
  })

  const teachers = useQuery({ queryKey: ['lms-teachers'], queryFn: lmsApi.teachers })
  const [meta, setMeta] = useState<{
    title: string
    description: string
    coverUrl: string
    level: string
    teacherId: string
  } | null>(null)
  const [moduleTitle, setModuleTitle] = useState('')
  const [lessonDraft, setLessonDraft] = useState<Record<string, string>>({})
  const [uploadingCover, setUploadingCover] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canReassign = session?.role === 'ADMIN' || session?.role === 'MANAGER'

  useEffect(() => {
    if (preview.data && meta === null) {
      setMeta({
        title: preview.data.title,
        description: preview.data.description,
        coverUrl: preview.data.coverUrl ?? '',
        level: preview.data.level,
        teacherId: preview.data.teacher.id,
      })
    }
  }, [preview.data, meta])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['lms-preview', id] })
    queryClient.invalidateQueries({ queryKey: ['lms-courses'] })
    queryClient.invalidateQueries({ queryKey: ['lms-course-versions', id] })
  }

  const saveMeta = useMutation({
    mutationFn: () =>
      lmsApi.updateCourse(id, {
        title: meta?.title,
        description: meta?.description,
        level: meta?.level,
        coverUrl: meta?.coverUrl.trim() || null,
        ...(canReassign && meta?.teacherId ? { teacherId: meta.teacherId } : {}),
      }),
    onSuccess: () => {
      setError(null)
      setNote('Настройки курса сохранены.')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить курс')),
  })

  const addModule = useMutation({
    mutationFn: () => lmsApi.createModule(id, { title: moduleTitle }),
    onSuccess: () => {
      setModuleTitle('')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось добавить модуль')),
  })

  const addLesson = useMutation({
    mutationFn: (moduleId: string) =>
      lmsApi.createLesson(moduleId, {
        title: lessonDraft[moduleId] ?? '',
        durationMinutes: 0,
      }),
    onSuccess: () => {
      setLessonDraft({})
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось добавить урок')),
  })

  const copyLesson = useMutation({
    mutationFn: (lessonId: string) => lmsApi.copyLesson(lessonId),
    onSuccess: () => {
      setNote('Урок скопирован.')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось скопировать урок')),
  })

  const removeModule = useMutation({
    mutationFn: (moduleId: string) => lmsApi.removeModule(moduleId),
    onSuccess: refresh,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось удалить модуль')),
  })

  const submit = useMutation({
    mutationFn: () => lmsApi.submit(id),
    onSuccess: () => {
      setNote('Курс отправлен на согласование администратору.')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось отправить курс')),
  })

  const review = useMutation({
    mutationFn: (approve: boolean) =>
      lmsApi.review(id, approve, approve ? undefined : window.prompt('Причина отклонения') ?? undefined),
    onSuccess: refresh,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить решение')),
  })

  const copyCourse = useMutation({
    mutationFn: () => lmsApi.copyCourse(id),
    onSuccess: (course) => navigate(`/courses/${course.id}/edit`),
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось скопировать курс')),
  })

  const uploadCover = async (file: File) => {
    setUploadingCover(true)
    setError(null)
    try {
      const result = await lmsApi.upload(file)
      setMeta((current) => (current ? { ...current, coverUrl: result.url } : current))
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Не удалось загрузить обложку'))
    } finally {
      setUploadingCover(false)
    }
  }

  const saveVersion = useMutation({
    mutationFn: () => lmsApi.saveCourseVersion(id, 'Ручное сохранение'),
    onSuccess: () => {
      setNote('Версия курса сохранена.')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить версию')),
  })

  const restoreVersion = useMutation({
    mutationFn: (version: number) => lmsApi.restoreCourseVersion(id, version),
    onSuccess: () => {
      setNote('Версия восстановлена.')
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось восстановить версию')),
  })

  if (preview.isLoading) return <div className="state">Загрузка курса…</div>
  if (preview.error) return <div className="alert alert-error">{errorMessage(preview.error)}</div>
  if (!preview.data) return null

  const course = preview.data
  const isAdmin = session?.role === 'ADMIN'
  const lessonCount = course.modules.reduce((sum, module) => sum + module.lessons.length, 0)

  return (
    <div className="stack">
      <PageHeader
        title={course.title}
        subtitle={`Наставник: ${course.teacher.name}${course.author ? ` · автор: ${course.author.name}` : ''} · версия ${course.version}`}
        actions={
          <div className="row-actions">
            <Link className="button button-ghost" to="/courses">
              ← Все курсы
            </Link>
            <Link className="button button-ghost" to={`/courses/${course.id}/preview`}>
              Предпросмотр
            </Link>
            <button className="button button-ghost" type="button" onClick={() => copyCourse.mutate()}>
              Копировать курс
            </button>
          </div>
        }
      />

      <div className="row-actions">
        <span className="badge">{approvalLabels[course.approvalStatus]}</span>
        <StatusBadge status={course.status} />
        <span className="muted small">
          {course.modules.length} модулей · {lessonCount} уроков · {course.students} учеников
        </span>
      </div>

      {course.rejectionReason ? <div className="alert alert-error">Отклонён: {course.rejectionReason}</div> : null}
      {course.approvalStatus === 'APPROVED' ? (
        <div className="alert alert-warning">
          Курс опубликован. Любое изменение содержания или настроек вернёт его в черновик и снимет
          с публикации до повторного одобрения администратора.
        </div>
      ) : null}
      {note ? <div className="alert">{note}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {course.approvalStatus === 'PENDING_REVIEW' && isAdmin ? (
        <div className="alert">
          Курс ждёт согласования.{' '}
          <button className="button button-small" type="button" onClick={() => review.mutate(true)}>
            Одобрить и опубликовать
          </button>{' '}
          <button className="button button-ghost button-small" type="button" onClick={() => review.mutate(false)}>
            Отклонить
          </button>
        </div>
      ) : null}

      {course.approvalStatus !== 'PENDING_REVIEW' && course.approvalStatus !== 'APPROVED' ? (
        <div className="alert">
          Публикация доступна только после одобрения администратором.
          <button
            className="button button-small"
            type="button"
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            style={{ marginLeft: 10 }}
          >
            Отправить на согласование
          </button>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Разделы курса">
        {(
          [
            ['content', 'Содержание'],
            ['stats', 'Статистика'],
            ['participants', 'Участники'],
          ] as Array<['content' | 'stats' | 'participants', string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'content' ? (
        <>
          <Section title="Настройки курса" subtitle="Название, описание, обложка и уровень">
            {meta ? (
              <form
                className="stack-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveMeta.mutate()
                }}
              >
                <div className="form-row">
                  <label className="field">
                    <span>Название</span>
                    <input value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Уровень</span>
                    <select value={meta.level} onChange={(event) => setMeta({ ...meta, level: event.target.value })}>
                      <option value="BEGINNER">Начальный</option>
                      <option value="INTERMEDIATE">Средний</option>
                      <option value="ADVANCED">Продвинутый</option>
                    </select>
                  </label>
                  {canReassign ? (
                    <label className="field">
                      <span>Наставник</span>
                      <select
                        value={meta.teacherId}
                        onChange={(event) => setMeta({ ...meta, teacherId: event.target.value })}
                      >
                        {teachers.data?.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <label className="field">
                  <span>Описание</span>
                  <textarea
                    rows={3}
                    value={meta.description}
                    onChange={(event) => setMeta({ ...meta, description: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Обложка (ссылка на изображение)</span>
                  <input
                    value={meta.coverUrl}
                    onChange={(event) => setMeta({ ...meta, coverUrl: event.target.value })}
                    placeholder="https://…"
                  />
                </label>
                <div className="row-actions cover-editor-row">
                  {meta.coverUrl ? <img className="course-cover-preview" src={meta.coverUrl} alt="Обложка курса" /> : null}
                  <label className="button button-ghost button-small upload-button">
                    {uploadingCover ? 'Загружаем…' : 'Загрузить обложку'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingCover}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadCover(file)
                      }}
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button className="button" type="submit" disabled={saveMeta.isPending}>
                    Сохранить настройки
                  </button>
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={() => saveVersion.mutate()}
                    disabled={saveVersion.isPending}
                  >
                    Сохранить версию курса
                  </button>
                </div>
              </form>
            ) : null}
          </Section>

          <Section
            title="Модули и уроки"
            subtitle="Все уроки открываются ученику сразу после публикации курса"
            action={
              <form
                className="row-actions"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (moduleTitle.trim().length >= 2) addModule.mutate()
                }}
              >
                <input
                  value={moduleTitle}
                  onChange={(event) => setModuleTitle(event.target.value)}
                  placeholder="Название модуля"
                  aria-label="Название нового модуля"
                />
                <button className="button button-small" type="submit" disabled={addModule.isPending}>
                  Добавить модуль
                </button>
              </form>
            }
          >
            {course.modules.length === 0 ? <Empty>Добавьте первый модуль — например, «Введение».</Empty> : null}

            <div className="module-list">
              {course.modules.map((module) => (
                <article className="module-card" key={module.id}>
                  <div className="module-head">
                    <div>
                      <h3>{module.title}</h3>
                      <span className="muted small">{module.lessons.length} уроков</span>
                    </div>
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => {
                        if (window.confirm('Удалить модуль без уроков?')) removeModule.mutate(module.id)
                      }}
                    >
                      Удалить
                    </button>
                  </div>

                  {module.lessons.length > 0 ? (
                    <ul className="lesson-list">
                      {module.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <div>
                            <strong>{lesson.title}</strong>
                            <span className="muted small">
                              {' '}
                              · блоков: {lesson.blocks.length} · материалов: {lesson.materials.length} · версия {lesson.version}
                            </span>
                          </div>
                          <div className="row-actions">
                            <Link className="button button-small" to={`/courses/${course.id}/lessons/${lesson.id}`}>
                              Конструктор
                            </Link>
                            <button
                              className="button button-ghost button-small"
                              type="button"
                              onClick={() => copyLesson.mutate(lesson.id)}
                            >
                              Копировать
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>В модуле пока нет уроков.</Empty>
                  )}

                  <form
                    className="row-actions"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if ((lessonDraft[module.id] ?? '').trim().length >= 3) addLesson.mutate(module.id)
                    }}
                  >
                    <input
                      value={lessonDraft[module.id] ?? ''}
                      onChange={(event) => setLessonDraft({ ...lessonDraft, [module.id]: event.target.value })}
                      placeholder="Название нового урока"
                      aria-label={`Название урока в модуле ${module.title}`}
                    />
                    <button className="button button-ghost button-small" type="submit" disabled={addLesson.isPending}>
                      Добавить урок
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </Section>

          <Section
            title="История версий курса"
            subtitle="Снимки содержания и восстановление предыдущего состояния"
          >
            {versions.isLoading ? <p className="muted">Загрузка версий…</p> : null}
            {versions.data && versions.data.items.length === 0 ? (
              <Empty>Сохранённых версий пока нет. Нажмите «Сохранить версию курса».</Empty>
            ) : null}
            {versions.data && versions.data.items.length > 0 ? (
              <ul className="list">
                {versions.data.items.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>Версия {version.version}</strong>
                      <span className="muted small">
                        {' '}
                        · {formatDateTime(version.createdAt)}
                        {version.note ? ` · ${version.note}` : ''}
                      </span>
                    </div>
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Восстановить версию ${version.version}? Текущее содержание будет заменено.`)) {
                          restoreVersion.mutate(version.version)
                        }
                      }}
                    >
                      Восстановить
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title="Тесты курса" subtitle="Проверочные работы, привязанные к урокам и программе">
            {course.tests.length === 0 ? (
              <Empty>Тестов пока нет. Создайте его в разделе «Тесты» и выберите этот курс.</Empty>
            ) : (
              <ul className="list">
                {course.tests.map((test) => (
                  <li key={test.id}>
                    <div>
                      <strong>{test.title}</strong>
                      <span className={`badge ${test.isPublished ? 'badge-active' : 'badge-draft'}`}>
                        {test.isPublished ? 'опубликован' : 'черновик'}
                      </span>
                    </div>
                    <Link className="button button-ghost button-small" to={`/tests/${test.id}/edit`}>
                      Открыть тест
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}

      {tab === 'stats' ? (
        <Section title="Статистика курса" subtitle="Прогресс и вовлечённость учеников">
          {stats.isLoading ? <p className="muted">Считаем…</p> : null}
          {stats.data ? (
            <div className="stack">
              <div className="metrics">
                <div>
                  <dt>Ученики</dt>
                  <dd>{stats.data.enrollments}</dd>
                </div>
                <div>
                  <dt>Средний прогресс</dt>
                  <dd>{stats.data.averageProgress}%</dd>
                </div>
                <div>
                  <dt>Завершение уроков</dt>
                  <dd>{stats.data.completionRate}%</dd>
                </div>
                <div>
                  <dt>Материалы</dt>
                  <dd>{stats.data.materials}</dd>
                </div>
                <div>
                  <dt>Тесты</dt>
                  <dd>{stats.data.tests}</dd>
                </div>
                <div>
                  <dt>Задания</dt>
                  <dd>{stats.data.homework}</dd>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Урок</th>
                      <th>Завершили</th>
                      <th>Материалов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.data.lessonStats.map((lesson) => (
                      <tr key={lesson.id}>
                        <td>{lesson.title}</td>
                        <td>{lesson.completed}</td>
                        <td>{lesson.materials}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {tab === 'participants' ? (
        <Section title="Участники" subtitle="Записанные ученики и их прогресс">
          {participants.isLoading ? <p className="muted">Загрузка…</p> : null}
          {participants.data && participants.data.items.length === 0 ? <Empty>На курс пока никто не записан.</Empty> : null}
          {participants.data && participants.data.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Статус</th>
                    <th>Прогресс</th>
                    <th>Уроков завершено</th>
                    <th>Записан</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <p className="muted small">{item.email}</p>
                      </td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>{item.progress}%</td>
                      <td>
                        {item.completedLessons} / {participants.data.totalLessons}
                      </td>
                      <td className="muted small">{formatDateTime(item.enrolledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  )
}
