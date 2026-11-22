import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { homeworkApi, gradingApi, type Attachment, type HomeworkDetail, type HomeworkVersion, type AiHomeworkReview } from '../api/assessment'
import { lmsApi } from '../api/lms'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, StatusBadge, formatDateTime } from '../components/ui'

const statusLabels: Record<string, string> = {
  SUBMITTED: 'На проверке',
  REVIEWED: 'Принято',
  RETURNED: 'На доработке',
  NOT_SUBMITTED: 'Не сдано',
}

const eventLabels: Record<string, string> = {
  CREATED: 'Задание создано',
  UPDATED: 'Настройки изменены',
  SUBMITTED: 'Отправлена версия',
  REVIEWED: 'Работа принята',
  RETURNED: 'Работа возвращена',
  AI_REVIEW: 'AI-предпроверка',
}

function toLocalInput(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

/** Домашние задания. Наставник создаёт и проверяет, ученик отправляет версии работы. */
export function HomeworkPage() {
  const role = getSession()?.role
  return role === 'STUDENT' ? <StudentHomework /> : <StaffHomework />
}

// ---------- наставник ----------

function StaffHomework() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['homework-list'], queryFn: homeworkApi.list })
  const courses = useQuery({ queryKey: ['lms-courses'], queryFn: lmsApi.courses })
  const scales = useQuery({ queryKey: ['grading-scales'], queryFn: gradingApi.list })

  useEffect(() => {
    if (!selected && list.data && list.data.length > 0) setSelected(list.data[0]?.id ?? null)
  }, [list.data, selected])

  const detail = useQuery({
    queryKey: ['homework-detail', selected],
    queryFn: () => homeworkApi.detail(selected!),
    enabled: Boolean(selected),
  })

  const [form, setForm] = useState({
    courseId: '',
    lessonId: '',
    title: '',
    description: '',
    dueAt: toLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString()),
    maxScore: 10,
    maxAttempts: 2,
    allowResubmit: false,
    allowLate: true,
    latePenalty: 10,
    assignAll: true,
    gradingScaleId: '',
  })
  const [studentIds, setStudentIds] = useState<string[]>([])
  const [materials, setMaterials] = useState<Attachment[]>([])
  const [criteria, setCriteria] = useState<Array<{ title: string; weight: number; description: string }>>([
    { title: 'Соответствие заданию', weight: 50, description: '' },
    { title: 'Качество решения', weight: 50, description: '' },
  ])
  const [uploading, setUploading] = useState(false)

  const coursePreview = useQuery({
    queryKey: ['lms-preview', form.courseId],
    queryFn: () => lmsApi.preview(form.courseId),
    enabled: Boolean(form.courseId),
  })
  const participants = useQuery({
    queryKey: ['lms-participants', form.courseId],
    queryFn: () => lmsApi.participants(form.courseId),
    enabled: Boolean(form.courseId) && !form.assignAll,
  })

  const create = useMutation({
    mutationFn: () =>
      homeworkApi.create({
        courseId: form.courseId,
        ...(form.lessonId ? { lessonId: form.lessonId } : {}),
        title: form.title,
        description: form.description,
        dueAt: new Date(form.dueAt).toISOString(),
        maxScore: form.maxScore,
        maxAttempts: form.maxAttempts,
        allowResubmit: form.allowResubmit,
        allowLate: form.allowLate,
        latePenalty: form.latePenalty,
        assignAll: form.assignAll,
        studentIds,
        materials,
        criteria,
        ...(form.gradingScaleId ? { gradingScaleId: form.gradingScaleId } : {}),
      }),
    onSuccess: (homework) => {
      setCreating(false)
      setError(null)
      setSelected(homework.id)
      setStudentIds([])
      queryClient.invalidateQueries({ queryKey: ['homework-list'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать задание')),
  })

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const result = await lmsApi.upload(file)
      setMaterials((current) => [...current, { name: result.name, url: result.url, type: result.mimeType, size: result.size }])
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Не удалось загрузить файл'))
    } finally {
      setUploading(false)
    }
  }

  const lessons = coursePreview.data?.modules.flatMap((module) => module.lessons) ?? []

  return (
    <div className="stack">
      <PageHeader
        title="Домашние задания"
        subtitle="Создание, адресная выдача, несколько версий работы и проверка с AI-предпроверкой."
        actions={
          <button className="button" type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? 'Свернуть форму' : 'Новое задание'}
          </button>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {creating ? (
        <Section title="Новое задание" subtitle="Курс — это группа: можно выдать всем или выбрать учеников">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <div className="form-row">
              <label className="field">
                <span>Группа (курс)</span>
                <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value, lessonId: '' })} required>
                  <option value="">Выберите курс</option>
                  {courses.data?.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Урок (необязательно)</span>
                <select value={form.lessonId} onChange={(event) => setForm({ ...form, lessonId: event.target.value })}>
                  <option value="">Без привязки к уроку</option>
                  {lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {lesson.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Название</span>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={3} />
            </label>
            <label className="field">
              <span>Описание и требования</span>
              <textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
            </label>

            <div className="form-row">
              <label className="field">
                <span>Срок сдачи</span>
                <input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} required />
              </label>
              <label className="field">
                <span>Максимальный балл</span>
                <input type="number" min={1} max={1000} value={form.maxScore} onChange={(event) => setForm({ ...form, maxScore: Number(event.target.value) })} />
              </label>
            </div>

            <div className="form-row">
              <label className="field">
                <span>Версий отправки</span>
                <input type="number" min={1} max={10} value={form.maxAttempts} onChange={(event) => setForm({ ...form, maxAttempts: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Штраф за просрочку, %</span>
                <input type="number" min={0} max={100} value={form.latePenalty} onChange={(event) => setForm({ ...form, latePenalty: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Шкала оценивания</span>
                <select value={form.gradingScaleId} onChange={(event) => setForm({ ...form, gradingScaleId: event.target.value })}>
                  <option value="">Без шкалы</option>
                  {scales.data?.map((scale) => (
                    <option key={scale.id} value={scale.id}>
                      {scale.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="switch">
              <input type="checkbox" checked={form.allowLate} onChange={(event) => setForm({ ...form, allowLate: event.target.checked })} />
              <span>Принимать работы после срока</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.allowResubmit}
                onChange={(event) => setForm({ ...form, allowResubmit: event.target.checked })}
              />
              <span>Разрешить новую версию после принятой работы</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.assignAll} onChange={(event) => setForm({ ...form, assignAll: event.target.checked })} />
              <span>Выдать всей группе курса</span>
            </label>

            {!form.assignAll ? (
              <div className="field">
                <span>Ученики</span>
                {!form.courseId ? <p className="muted small">Сначала выберите курс.</p> : null}
                {participants.data?.items.map((student) => (
                  <label className="check-inline" key={student.id}>
                    <input
                      type="checkbox"
                      checked={studentIds.includes(student.id)}
                      onChange={(event) =>
                        setStudentIds((current) =>
                          event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id),
                        )
                      }
                    />
                    {student.name} · {student.email}
                  </label>
                ))}
              </div>
            ) : null}

            <div className="field">
              <span>Материалы задания</span>
              <input type="file" disabled={uploading} onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }} />
              <ul className="list">
                {materials.map((material) => (
                  <li key={material.url}>
                    <a href={material.url} target="_blank" rel="noreferrer">{material.name}</a>
                    <button className="button button-ghost button-small" type="button" onClick={() => setMaterials((current) => current.filter((item) => item.url !== material.url))}>
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="field">
              <span>Критерии оценивания</span>
              {criteria.map((item, index) => (
                <div className="row-actions" key={`criterion-${index}`}>
                  <input
                    value={item.title}
                    placeholder="Критерий"
                    onChange={(event) => setCriteria((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, title: event.target.value } : row)))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.weight}
                    aria-label="Вес критерия"
                    onChange={(event) => setCriteria((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, weight: Number(event.target.value) } : row)))}
                  />
                  <button className="button button-ghost button-small" type="button" onClick={() => setCriteria((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                    Убрать
                  </button>
                </div>
              ))}
              <button className="button button-ghost button-small" type="button" onClick={() => setCriteria((current) => [...current, { title: '', weight: 0, description: '' }])}>
                + критерий
              </button>
            </div>

            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать задание'}
            </button>
          </form>
        </Section>
      ) : null}

      <div className="homework-layout">
        <aside className="card homework-list" aria-label="Список заданий">
          <h2>Задания</h2>
          {list.isLoading ? <p className="muted">Загрузка…</p> : null}
          {list.data && list.data.length === 0 ? <Empty>Заданий пока нет.</Empty> : null}
          <ul>
            {list.data?.map((homework) => (
              <li key={homework.id}>
                <button
                  type="button"
                  className={homework.id === selected ? 'learn-lesson learn-lesson-active' : 'learn-lesson'}
                  onClick={() => setSelected(homework.id)}
                >
                  <span>{homework.title}</span>
                  <span className="muted small">{homework.submissions} работ</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="stack">
          {detail.isLoading ? <div className="state">Загрузка задания…</div> : null}
          {detail.error ? <div className="alert alert-error">{errorMessage(detail.error)}</div> : null}
          {detail.data ? <StaffHomeworkDetail homework={detail.data} /> : null}
        </div>
      </div>
    </div>
  )
}

function StaffHomeworkDetail({ homework }: { homework: HomeworkDetail }) {
  const queryClient = useQueryClient()
  const [openSubmission, setOpenSubmission] = useState<HomeworkVersion | null>(null)
  const history = useQuery({ queryKey: ['homework-history', homework.id], queryFn: () => homeworkApi.history(homework.id) })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['homework-detail', homework.id] })
    queryClient.invalidateQueries({ queryKey: ['homework-list'] })
    queryClient.invalidateQueries({ queryKey: ['homework-history', homework.id] })
  }

  return (
    <>
      <Section
        title={homework.title}
        subtitle={`${homework.course.title} · до ${formatDateTime(homework.dueAt)} · ${homework.maxScore} баллов`}
      >
        <p>{homework.description}</p>
        <div className="row-actions">
          <span className="badge">{homework.assignAll ? 'вся группа' : `учеников: ${homework.targets.length}`}</span>
          <span className="badge">версий: {homework.maxAttempts}</span>
          <span className="badge">{homework.allowResubmit ? 'повторная сдача после принятия' : 'без повторной сдачи'}</span>
          {homework.allowLate ? <span className="badge">просрочка −{homework.latePenalty}%</span> : <span className="badge">без просрочки</span>}
        </div>

        {homework.materials && homework.materials.length > 0 ? (
          <ul className="material-list">
            {homework.materials.map((material) => (
              <li key={material.url} className="material-item">
                <a href={material.url} target="_blank" rel="noreferrer">{material.name}</a>
              </li>
            ))}
          </ul>
        ) : null}

        {homework.criteria && homework.criteria.length > 0 ? (
          <div>
            <h3>Критерии</h3>
            <ul className="list">
              {homework.criteria.map((criterion) => (
                <li key={criterion.title}>
                  <span>{criterion.title}</span>
                  <span className="muted small">{criterion.weight}%</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {homework.stats ? (
          <div className="metrics">
            <div><dt>Назначено</dt><dd>{homework.stats.assigned}</dd></div>
            <div><dt>Сдали</dt><dd>{homework.stats.submitted}</dd></div>
            <div><dt>На проверке</dt><dd>{homework.stats.pending}</dd></div>
            <div><dt>Принято</dt><dd>{homework.stats.reviewed}</dd></div>
            <div><dt>Возвращено</dt><dd>{homework.stats.returned}</dd></div>
          </div>
        ) : null}
      </Section>

      <Section title="Ученики" subtitle="Нажмите на работу, чтобы проверить версию">
        {homework.students && homework.students.length === 0 ? <Empty>В группе пока нет учеников.</Empty> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Статус</th>
                <th>Версий</th>
                <th>Балл</th>
                <th>Сдано</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {homework.students?.map((student) => {
                const latest = homework.submissions?.find((submission) => submission.id === student.latestSubmissionId)
                return (
                  <tr key={student.id}>
                    <td><strong>{student.name}</strong><p className="muted small">{student.email}</p></td>
                    <td><span className={`badge badge-${student.status.toLowerCase()}`}>{statusLabels[student.status] ?? student.status}</span></td>
                    <td>{student.versions}</td>
                    <td>{student.score !== null ? `${student.score} / ${homework.maxScore}` : '—'}</td>
                    <td className="muted small">{formatDateTime(student.submittedAt)}</td>
                    <td>
                      {latest ? (
                        <button className="button button-small" type="button" onClick={() => setOpenSubmission(latest)}>
                          Проверить
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Все версии работ" subtitle="Дата, файлы, комментарии и результат проверки">
        {homework.submissions && homework.submissions.length === 0 ? <Empty>Работ пока нет.</Empty> : null}
        <ul className="version-list">
          {homework.submissions?.map((submission) => (
            <li key={submission.id} className="version-card">
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{submission.student?.name} · версия {submission.attempt}</strong>
                  <p className="muted small">{formatDateTime(submission.submittedAt)}</p>
                </div>
                <div className="row-actions">
                  <span className={`badge badge-${submission.status.toLowerCase()}`}>{statusLabels[submission.status] ?? submission.status}</span>
                  {submission.score !== null ? <span className="badge">{submission.score} / {homework.maxScore}</span> : null}
                  <button className="button button-ghost button-small" type="button" onClick={() => setOpenSubmission(submission)}>
                    Открыть
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {openSubmission ? (
        <SubmissionReview
          key={openSubmission.id}
          homework={homework}
          submission={openSubmission}
          onClose={() => setOpenSubmission(null)}
          onSaved={() => {
            setOpenSubmission(null)
            refresh()
          }}
        />
      ) : null}

      <Section title="История изменений" subtitle="Все действия по заданию">
        {history.data && history.data.length === 0 ? <Empty>История пуста.</Empty> : null}
        <ul className="list">
          {history.data?.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{eventLabels[event.type] ?? event.type}</strong>
                {event.message ? <span className="muted small"> · {event.message}</span> : null}
                <p className="muted small">{formatDateTime(event.createdAt)} · {event.actor}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function SubmissionReview({
  homework,
  submission,
  onClose,
  onSaved,
}: {
  homework: HomeworkDetail
  submission: HomeworkVersion
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [score, setScore] = useState(submission.review?.score ?? submission.score ?? 0)
  const [comment, setComment] = useState(submission.review?.comment ?? '')
  const [returnForRevision, setReturn] = useState(false)
  const [criteriaScores, setCriteriaScores] = useState<Array<{ title: string; score: number }>>(
    (homework.criteria ?? []).map((criterion) => ({
      title: criterion.title,
      score: submission.review?.criteriaScores?.find((item) => item.title === criterion.title)?.score ?? 0,
    })),
  )
  const [ai, setAi] = useState<AiHomeworkReview | null>(submission.aiFeedback ?? null)
  const [error, setError] = useState<string | null>(null)

  const review = useMutation({
    mutationFn: () =>
      homeworkApi.review(submission.id, {
        score,
        comment,
        returnForRevision,
        criteriaScores,
      }),
    onSuccess: onSaved,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить проверку')),
  })

  const aiCheck = useMutation({
    mutationFn: () => homeworkApi.aiReview(submission.id),
    onSuccess: (result) => {
      setAi(result)
      queryClient.invalidateQueries({ queryKey: ['homework-detail', homework.id] })
      queryClient.invalidateQueries({ queryKey: ['homework-history', homework.id] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'AI-проверка недоступна')),
  })

  return (
    <Section
      title={`Проверка: ${submission.student?.name ?? 'ученик'}, версия ${submission.attempt}`}
      subtitle={`Сдано ${formatDateTime(submission.submittedAt)}`}
      action={<button className="button button-ghost button-small" type="button" onClick={onClose}>Закрыть</button>}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      {submission.text ? <div className="code-block">{submission.text}</div> : null}
      {submission.projectUrl ? (
        <p><a href={submission.projectUrl} target="_blank" rel="noreferrer">Ссылка на работу</a></p>
      ) : null}
      {submission.files && submission.files.length > 0 ? (
        <ul className="material-list">
          {submission.files.map((file) => (
            <li key={file.url} className="material-item">
              <span className="badge">{file.type ?? 'файл'}</span>
              <a href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {submission.comments?.map((item, index) => (
        <p key={`comment-${index}`} className="muted small">Комментарий ученика: {item.text}</p>
      ))}

      <div className="ai-panel">
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <strong>AI-предпроверка</strong>
          <button className="button button-ghost button-small" type="button" onClick={() => aiCheck.mutate()} disabled={aiCheck.isPending}>
            {aiCheck.isPending ? 'Анализируем…' : 'Проверить с AI'}
          </button>
        </div>
        {ai ? (
          <div className="stack-sm">
            <p className="muted small">{ai.disclaimer}</p>
            <p><strong>Предложение AI:</strong> {ai.scoreSuggestion} из {ai.maxScore} · уверенность {ai.confidence}%</p>
            <p>{ai.summary}</p>
            {ai.strengths.length > 0 ? <p className="small"><strong>Сильные стороны:</strong> {ai.strengths.join('; ')}</p> : null}
            {ai.improvements.length > 0 ? <p className="small"><strong>Что улучшить:</strong> {ai.improvements.join('; ')}</p> : null}
            {ai.risks.length > 0 ? <p className="small"><strong>Риски:</strong> {ai.risks.join('; ')}</p> : null}
            <button className="button button-ghost button-small" type="button" onClick={() => setScore(ai.scoreSuggestion)}>
              Подставить балл (решение за вами)
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="stack-sm"
        onSubmit={(event) => {
          event.preventDefault()
          review.mutate()
        }}
      >
        <label className="field">
          <span>Балл (0–{homework.maxScore})</span>
          <input type="number" min={0} max={homework.maxScore} value={score} onChange={(event) => setScore(Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Подробный комментарий</span>
          <textarea
            rows={4}
            required={returnForRevision}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>

        {criteriaScores.length > 0 ? (
          <div className="field">
            <span>По критериям</span>
            {criteriaScores.map((criterion, index) => (
              <div className="row-actions" key={criterion.title}>
                <span>{criterion.title}</span>
                <input
                  type="number"
                  min={0}
                  max={homework.maxScore}
                  value={criterion.score}
                  aria-label={`Балл по критерию ${criterion.title}`}
                  onChange={(event) =>
                    setCriteriaScores((current) =>
                      current.map((row, rowIndex) => (rowIndex === index ? { ...row, score: Number(event.target.value) } : row)),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : null}

        <label className="switch">
          <input type="checkbox" checked={returnForRevision} onChange={(event) => setReturn(event.target.checked)} />
          <span>Вернуть на исправление</span>
        </label>

        <button className="button" type="submit" disabled={review.isPending}>
          {returnForRevision ? 'Вернуть на доработку' : 'Принять работу'}
        </button>
      </form>
    </Section>
  )
}

// ---------- ученик ----------

function StudentHomework() {
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['homework-list'], queryFn: homeworkApi.list })

  useEffect(() => {
    if (!selected && list.data && list.data.length > 0) setSelected(list.data[0]?.id ?? null)
  }, [list.data, selected])

  return (
    <div className="stack">
      <PageHeader title="Домашние задания" subtitle="Все версии отправки, комментарии преподавателя и результаты." />
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="homework-layout">
        <aside className="card homework-list" aria-label="Мои задания">
          {list.isLoading ? <p className="muted">Загрузка…</p> : null}
          {list.data && list.data.length === 0 ? <Empty>Заданий пока нет.</Empty> : null}
          <ul>
            {list.data?.map((homework) => (
              <li key={homework.id}>
                <button
                  type="button"
                  className={homework.id === selected ? 'learn-lesson learn-lesson-active' : 'learn-lesson'}
                  onClick={() => setSelected(homework.id)}
                >
                  <span>{homework.title}</span>
                  <span className="muted small">
                    {homework.mySubmission ? statusLabels[homework.mySubmission.status] ?? homework.mySubmission.status : 'не сдано'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="stack">
          {selected ? <StudentHomeworkDetail id={selected} onError={setError} /> : <Empty>Выберите задание.</Empty>}
        </div>
      </div>
    </div>
  )
}

function StudentHomeworkDetail({ id, onError }: { id: string; onError: (message: string) => void }) {
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['homework-detail', id], queryFn: () => homeworkApi.detail(id) })
  const [text, setText] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)

  const submit = useMutation({
    mutationFn: () =>
      homeworkApi.submit(id, {
        text,
        ...(projectUrl ? { projectUrl } : {}),
        files,
        comment,
      }),
    onSuccess: () => {
      setText('')
      setProjectUrl('')
      setComment('')
      setFiles([])
      queryClient.invalidateQueries({ queryKey: ['homework-detail', id] })
      queryClient.invalidateQueries({ queryKey: ['homework-list'] })
    },
    onError: (mutationError) => onError(errorMessage(mutationError, 'Не удалось отправить работу')),
  })

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const result = await lmsApi.upload(file)
      setFiles((current) => [...current, { name: result.name, url: result.url, type: result.mimeType, size: result.size }])
    } catch (uploadError) {
      onError(errorMessage(uploadError, 'Не удалось загрузить файл'))
    } finally {
      setUploading(false)
    }
  }

  if (detail.isLoading) return <div className="state">Загрузка…</div>
  if (detail.error) return <div className="alert alert-error">{errorMessage(detail.error)}</div>
  if (!detail.data) return null
  const homework = detail.data

  return (
    <>
      <Section
        title={homework.title}
        subtitle={`${homework.course.title} · срок ${formatDateTime(homework.dueAt)} · ${homework.maxScore} баллов`}
      >
        <p>{homework.description}</p>
        <div className="row-actions">
          <span className="badge">версий: {homework.attemptsUsed ?? 0} из {homework.maxAttempts}</span>
          {homework.allowResubmit ? <span className="badge">повторная сдача разрешена</span> : null}
          {homework.allowLate ? <span className="badge">просрочка −{homework.latePenalty}%</span> : null}
        </div>
        {homework.materials && homework.materials.length > 0 ? (
          <ul className="material-list">
            {homework.materials.map((material) => (
              <li key={material.url} className="material-item">
                <a href={material.url} target="_blank" rel="noreferrer">{material.name}</a>
              </li>
            ))}
          </ul>
        ) : null}
        {homework.criteria && homework.criteria.length > 0 ? (
          <div>
            <h3>Критерии оценивания</h3>
            <ul className="list">
              {homework.criteria.map((criterion) => (
                <li key={criterion.title}><span>{criterion.title}</span><span className="muted small">{criterion.weight}%</span></li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Мои версии" subtitle={`Использовано ${homework.attemptsUsed} из ${homework.maxAttempts}`}>
        {homework.mySubmissions && homework.mySubmissions.length === 0 ? <Empty>Работа ещё не отправлена.</Empty> : null}
        <ul className="version-list">
          {homework.mySubmissions?.map((version) => (
            <li key={version.id} className="version-card">
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>Версия {version.attempt}</strong>
                  <p className="muted small">{formatDateTime(version.submittedAt)}</p>
                </div>
                <div className="row-actions">
                  <StatusBadge status={version.status} />
                  {version.score !== null ? <span className="badge">{version.score} / {homework.maxScore}</span> : null}
                </div>
              </div>
              {version.text ? <p className="muted small">{version.text.slice(0, 300)}</p> : null}
              {version.projectUrl ? (
                <p className="muted small">
                  <a href={version.projectUrl} target="_blank" rel="noreferrer">Ссылка на работу</a>
                </p>
              ) : null}
              {version.files?.length ? (
                <ul className="material-list">
                  {version.files.map((file) => (
                    <li key={file.url} className="material-item">
                      <a href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {version.comments?.map((item, index) => (
                <p key={`${version.id}-comment-${index}`} className="muted small">Мой комментарий: {item.text}</p>
              ))}
              {version.review ? (
                <div className="ai-panel">
                  <p><strong>Комментарий преподавателя:</strong> {version.review.comment ?? '—'}</p>
                  {version.review.returnForRevision ? <p className="badge badge-returned">Возвращено на доработку</p> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {homework.canSubmit ? (
        <Section title="Отправить новую версию" subtitle="Текст, ссылка, изображения, документы, аудио и видео">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              if (!text.trim() && !projectUrl.trim() && files.length === 0) {
                onError('Добавьте текст решения, ссылку или файлы')
                return
              }
              submit.mutate()
            }}
          >
            <label className="field">
              <span>Решение</span>
              <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
            </label>
            <label className="field">
              <span>Ссылка (GitHub, диск, видео)</span>
              <input value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://…" />
            </label>
            <label className="field">
              <span>Файлы (до 10 МБ каждый)</span>
              <input
                type="file"
                multiple
                disabled={uploading}
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
                onChange={(event) => {
                  const selectedFiles = Array.from(event.target.files ?? [])
                  void (async () => {
                    for (const file of selectedFiles) await upload(file)
                  })()
                }}
              />
            </label>
            {files.length > 0 ? (
              <ul className="list">
                {files.map((file) => (
                  <li key={file.url}>
                    <span>{file.name}</span>
                    <button className="button button-ghost button-small" type="button" onClick={() => setFiles((current) => current.filter((item) => item.url !== file.url))}>
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="field">
              <span>Комментарий к версии</span>
              <input value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
            <button className="button" type="submit" disabled={submit.isPending || uploading}>
              {submit.isPending ? 'Отправляем…' : 'Отправить версию'}
            </button>
          </form>
        </Section>
      ) : (
        <div className="alert">
          {homework.submitBlockedReason ?? 'Отправка новой версии сейчас недоступна.'}
        </div>
      )}
    </>
  )
}
