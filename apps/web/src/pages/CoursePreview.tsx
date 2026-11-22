import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { lmsApi } from '../api/lms'
import { errorMessage } from '../api/client'
import { Empty, PageHeader } from '../components/ui'
import { LessonBlocks } from '../components/LessonBlocks'

/** Предпросмотр курса: как ученик увидит модули, уроки и материалы после публикации. */
export function CoursePreviewPage() {
  const { id = '' } = useParams()
  const preview = useQuery({ queryKey: ['lms-preview', id], queryFn: () => lmsApi.preview(id), enabled: Boolean(id) })

  if (preview.isLoading) return <div className="state">Загрузка предпросмотра…</div>
  if (preview.error) return <div className="alert alert-error">{errorMessage(preview.error)}</div>
  if (!preview.data) return null

  const course = preview.data

  return (
    <div className="stack">
      <PageHeader
        title="Предпросмотр курса"
        subtitle="Так курс увидят ученики. Черновик доступен только сотрудникам филиала."
        actions={
          <Link className="button button-ghost" to={`/courses/${course.id}/edit`}>
            ← Редактировать
          </Link>
        }
      />

      <section className="course-hero">
        {course.coverUrl ? <img src={course.coverUrl} alt="" className="course-cover" /> : <div className="course-cover course-cover-empty" />}
        <div className="course-hero-body">
          <span className="badge">{course.level}</span>
          <h1>{course.title}</h1>
          <p className="muted">{course.description}</p>
          <p className="muted small">
            Наставник: {course.teacher.name}
            {course.author ? ` · автор: ${course.author.name}` : ''} · учеников: {course.students}
          </p>
        </div>
      </section>

      {course.tests.length > 0 ? (
        <section className="card">
          <h2>Тесты курса</h2>
          <ul className="list">
            {course.tests.map((test) => (
              <li key={test.id}>
                <strong>{test.title}</strong>
                <span className={`badge ${test.isPublished ? 'badge-active' : 'badge-draft'}`}>
                  {test.isPublished ? 'опубликован' : 'черновик'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {course.modules.length === 0 ? <Empty>В курсе пока нет модулей.</Empty> : null}

      {course.modules.map((module) => (
        <section className="card" key={module.id}>
          <h2>{module.title}</h2>
          {module.description ? <p className="muted small">{module.description}</p> : null}

          <div className="stack" style={{ marginTop: 14 }}>
            {module.lessons.map((lesson) => (
              <details className="preview-lesson" key={lesson.id} open>
                <summary>
                  <strong>{lesson.title}</strong>
                  <span className="muted small">
                    {' '}
                    · {lesson.durationMinutes} мин · блоков: {lesson.blocks.length}
                  </span>
                </summary>
                <div className="preview-lesson-body">
                  {lesson.description ? <p className="muted">{lesson.description}</p> : null}
                  <LessonBlocks blocks={lesson.blocks} />

                  {lesson.materials.length > 0 ? (
                    <ul className="material-list">
                      {lesson.materials.map((material) => (
                        <li key={material.id}>
                          <span className="badge">{material.type}</span>
                          <a href={material.url} target="_blank" rel="noreferrer">
                            {material.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
