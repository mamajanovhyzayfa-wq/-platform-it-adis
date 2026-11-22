import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../api/lms'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

const approvalLabels: Record<string, string> = {
  DRAFT: 'Черновик',
  PENDING_REVIEW: 'На согласовании',
  APPROVED: 'Одобрен',
  REJECTED: 'Отклонён',
}

const approvalTones: Record<string, string> = {
  DRAFT: 'badge-draft',
  PENDING_REVIEW: 'badge-warning',
  APPROVED: 'badge-active',
  REJECTED: 'badge-rejected',
}

/** Курсы филиала: создание, копирование, согласование, переход в редактор. */
export function CoursesManagePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = getSession()
  const isAdmin = session?.role === 'ADMIN'
  const isTeacher = session?.role === 'TEACHER'

  const courses = useQuery({ queryKey: ['lms-courses'], queryFn: lmsApi.courses })
  const teachers = useQuery({ queryKey: ['lms-teachers'], queryFn: lmsApi.teachers })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    level: 'BEGINNER' as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
    teacherId: '',
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lms-courses'] })

  const createCourse = useMutation({
    mutationFn: () =>
      lmsApi.createCourse({
        title: form.title,
        description: form.description,
        level: form.level,
        ...(form.teacherId ? { teacherId: form.teacherId } : {}),
      }),
    onSuccess: (course) => {
      setError(null)
      setForm({ title: '', description: '', level: 'BEGINNER', teacherId: '' })
      invalidate()
      navigate(`/courses/${course.id}/edit`)
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать курс')),
  })

  const copyCourse = useMutation({
    mutationFn: (id: string) => lmsApi.copyCourse(id),
    onSuccess: (course) => {
      setNotice(`Создана копия: «${course.title}».`)
      invalidate()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось скопировать курс')),
  })

  const submit = useMutation({
    mutationFn: (id: string) => lmsApi.submit(id),
    onSuccess: () => {
      setNotice('Курс отправлен администратору на согласование.')
      invalidate()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось отправить курс')),
  })

  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      lmsApi.review(id, approve, approve ? undefined : window.prompt('Причина отклонения') ?? undefined),
    onSuccess: () => {
      setNotice('Решение сохранено.')
      invalidate()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить решение')),
  })

  return (
    <div className="stack">
      <PageHeader
        title="Курсы и уроки"
        subtitle="Полноценная LMS: конструктор уроков, копирование, версии и публикация после согласования."
      />

      {notice ? <div className="alert">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="grid two">
        <Section title="Новый курс" subtitle="Курсы создают администратор, менеджер и наставник">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              if (!isTeacher && !form.teacherId) return
              createCourse.mutate()
            }}
          >
            <label className="field">
              <span>Название</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                required
                minLength={3}
              />
            </label>
            <label className="field">
              <span>Описание</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={3}
                required
                minLength={10}
              />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Уровень</span>
                <select
                  value={form.level}
                  onChange={(event) => setForm({ ...form, level: event.target.value as typeof form.level })}
                >
                  <option value="BEGINNER">Начальный</option>
                  <option value="INTERMEDIATE">Средний</option>
                  <option value="ADVANCED">Продвинутый</option>
                </select>
              </label>
              <label className="field">
                <span>Наставник</span>
                <select
                  value={form.teacherId}
                  onChange={(event) => setForm({ ...form, teacherId: event.target.value })}
                >
                  <option value="">
                    {isTeacher ? 'Я — наставник (по умолчанию)' : 'Выберите наставника'}
                  </option>
                  {!isTeacher
                    ? teachers.data?.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
                        </option>
                      ))
                    : null}
                </select>
              </label>
            </div>
            <button
              className="button"
              type="submit"
              disabled={createCourse.isPending || (!isTeacher && !form.teacherId)}
            >
              {createCourse.isPending ? 'Создаём…' : 'Создать черновик'}
            </button>
            {!isTeacher && !form.teacherId ? (
              <p className="muted small">Чтобы создать курс, выберите наставника.</p>
            ) : null}
          </form>
        </Section>

        <Section title="Как устроена публикация" subtitle="Черновик → согласование → публикация">
          <ol className="steps">
            <li>
              <strong>Черновик.</strong> Наполните курс модулями и уроками в визуальном конструкторе. Сохранения
              автоматические, ручные версии сохраняются отдельно.
            </li>
            <li>
              <strong>Согласование.</strong> Наставник или менеджер отправляет курс администратору. До одобрения ученики
              курс не видят.
            </li>
            <li>
              <strong>Публикация.</strong> После одобрения все уроки открываются ученикам сразу — без постепенного
              раскрытия по датам.
            </li>
          </ol>
        </Section>
      </div>

      <Section title="Все курсы" subtitle="Черновики, согласование и опубликованные программы">
        {courses.isLoading ? <p className="muted">Загрузка…</p> : null}
        {courses.error ? <div className="alert alert-error">{errorMessage(courses.error)}</div> : null}
        {courses.data && courses.data.length === 0 ? <Empty>Курсов пока нет. Создайте первый черновик.</Empty> : null}

        {courses.data && courses.data.length > 0 ? (
          <div className="course-table">
            {courses.data.map((course) => (
              <article className="course-row" key={course.id}>
                <div className="course-row-main">
                  <div className="course-row-title">
                    <Link to={`/courses/${course.id}/edit`}>
                      <strong>{course.title}</strong>
                    </Link>
                    <span className={`badge ${approvalTones[course.approvalStatus] ?? ''}`}>
                      {approvalLabels[course.approvalStatus]}
                    </span>
                    {course.status === 'ACTIVE' ? <span className="badge badge-active">опубликован</span> : null}
                  </div>
                  <p className="muted small">
                    Наставник: {course.teacher}
                    {course.author ? ` · автор: ${course.author}` : ''} · модулей: {course.modules} · уроков:{' '}
                    {course.lessons} · учеников: {course.students}
                  </p>
                  {course.rejectionReason ? (
                    <p className="muted small">Причина отклонения: {course.rejectionReason}</p>
                  ) : null}
                  <p className="muted small">Обновлён {formatDateTime(course.updatedAt)}</p>
                </div>

                <div className="row-actions course-row-actions">
                  <Link className="button button-small" to={`/courses/${course.id}/edit`}>
                    Открыть
                  </Link>
                  <Link className="button button-ghost button-small" to={`/courses/${course.id}/preview`}>
                    Предпросмотр
                  </Link>
                  <button
                    className="button button-ghost button-small"
                    type="button"
                    onClick={() => copyCourse.mutate(course.id)}
                    disabled={copyCourse.isPending}
                  >
                    Копировать
                  </button>
                  {course.approvalStatus === 'DRAFT' || course.approvalStatus === 'REJECTED' ? (
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => submit.mutate(course.id)}
                      disabled={submit.isPending}
                    >
                      На согласование
                    </button>
                  ) : null}
                  {isAdmin && course.approvalStatus === 'PENDING_REVIEW' ? (
                    <>
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => review.mutate({ id: course.id, approve: true })}
                        disabled={review.isPending}
                      >
                        Одобрить
                      </button>
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        onClick={() => review.mutate({ id: course.id, approve: false })}
                        disabled={review.isPending}
                      >
                        Отклонить
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  )
}
