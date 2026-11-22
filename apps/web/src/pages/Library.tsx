import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../api/lms'
import { errorMessage } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

/** Библиотека ученика: материалы по курсам и группам, закладки, выделения и заметки. */
export function LibraryPage() {
  const queryClient = useQueryClient()
  const library = useQuery({ queryKey: ['lms-library'], queryFn: lmsApi.library })

  const bookmark = useMutation({
    mutationFn: (materialId: string) => lmsApi.toggleBookmark(materialId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lms-library'] }),
  })

  if (library.isLoading) return <div className="state">Загрузка библиотеки…</div>
  if (library.error) return <div className="alert alert-error">{errorMessage(library.error)}</div>
  if (!library.data) return null

  const data = library.data
  const hasContent = data.courses.length > 0

  return (
    <div className="stack">
      <PageHeader
        title="Библиотека"
        subtitle="Материалы курсов и групп: сохранённое, выделенное и личные заметки."
      />

      {!hasContent ? (
        <div className="card">
          <Empty>
            Библиотека пуста: материалы появляются после записи на курс. Откройте кабинет и выберите курс.
          </Empty>
        </div>
      ) : null}

      {data.saved.length > 0 ? (
        <Section title="Сохранённое" subtitle="Закладки и материалы с выделениями">
          <ul className="saved-grid">
            {data.saved.map((item) => (
              <li key={item.id} className="saved-card">
                <span className="badge">{item.type}</span>
                <strong>{item.title}</strong>
                <p className="muted small">{item.course}</p>
                <div className="row-actions">
                  <a className="button button-ghost button-small" href={item.url} target="_blank" rel="noreferrer">
                    Открыть
                  </a>
                  {item.type !== 'LINK' && item.allowDownload ? (
                    <a className="button button-ghost button-small" href={item.url} download target="_blank" rel="noreferrer">
                      Скачать
                    </a>
                  ) : null}
                  <Link
                    className="button button-ghost button-small"
                    to={`/learn/${item.courseId}?lesson=${item.lessonId}`}
                  >
                    К уроку
                  </Link>
                </div>
                {item.highlights > 0 ? <span className="muted small">выделений: {item.highlights}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.courses.map((course) => (
        <Section
          key={course.course.id}
          title={course.course.title}
          subtitle="Материалы по курсам и учебным группам"
          action={
            <Link className="link" to={`/learn/${course.course.id}`}>
              Открыть курс →
            </Link>
          }
        >
          {course.groups.length === 0 ? <Empty>В курсе пока нет материалов.</Empty> : null}
          <div className="library-groups">
            {course.groups.map((group) => (
              <div className="library-group" key={group.id}>
                <h3>{group.title}</h3>
                {group.lessons.map((lesson) => (
                  <div className="library-lesson" key={lesson.id}>
                    <Link to={`/learn/${course.course.id}?lesson=${lesson.id}`}>
                      <strong>{lesson.title}</strong>
                    </Link>

                    {lesson.note ? (
                      <div className="note-preview">
                        <span className="eyebrow">Моя заметка</span>
                        <p className="muted small">{lesson.note.slice(0, 240)}</p>
                        {lesson.noteUpdatedAt ? (
                          <span className="muted small">{formatDateTime(lesson.noteUpdatedAt)}</span>
                        ) : null}
                      </div>
                    ) : null}

                    <ul className="material-list">
                      {lesson.materials.map((material) => (
                        <li key={material.id} className="material-item">
                          <div className="material-head">
                            <span className="badge">{material.type}</span>
                            <a href={material.url} target="_blank" rel="noreferrer">
                              {material.title}
                            </a>
                            {material.type !== 'LINK' ? (
                              material.allowDownload ? (
                                <a className="button button-ghost button-small" href={material.url} download target="_blank" rel="noreferrer">
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
                              {material.bookmarked ? 'В закладках' : 'Сохранить'}
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
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  )
}
