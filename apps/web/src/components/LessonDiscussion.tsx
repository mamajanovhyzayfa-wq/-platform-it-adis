import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { communityApi } from '../api/community'
import { errorMessage, getSession } from '../api/client'

/** Комментарии и вопросы под уроком: история обсуждения и ответы наставника. */
export function LessonDiscussion({ lessonId, canAnswer = false }: { lessonId: string; canAnswer?: boolean }) {
  const session = getSession()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [questionTitle, setQuestionTitle] = useState('')
  const [questionBody, setQuestionBody] = useState('')
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const comments = useQuery({
    queryKey: ['lesson-comments', lessonId],
    queryFn: () => communityApi.lessonComments(lessonId),
    enabled: Boolean(lessonId),
  })
  const questions = useQuery({
    queryKey: ['lesson-questions', lessonId],
    queryFn: () => communityApi.lessonQuestions(lessonId),
    enabled: Boolean(lessonId),
  })

  const addComment = useMutation({
    mutationFn: () => communityApi.addComment(lessonId, comment.trim(), replyTo ?? undefined),
    onSuccess: () => {
      setComment('')
      setReplyTo(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['lesson-comments', lessonId] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const answerQuestion = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) => communityApi.answerQuestion(id, answer),
    onSuccess: () => {
      setAnswerDraft({})
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['lesson-questions', lessonId] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const askQuestion = useMutation({
    mutationFn: () => communityApi.askQuestion(lessonId, questionTitle.trim(), questionBody.trim()),
    onSuccess: () => {
      setQuestionTitle('')
      setQuestionBody('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['lesson-questions', lessonId] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  return (
    <div className="stack lesson-discussion">
      <section>
        <h3>Обсуждение урока</h3>
        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="stack">
          {(comments.data ?? []).map((item) => (
            <article key={item.id} className="community-message">
              <div className="community-message-meta">
                <strong>
                  {item.user.firstName} {item.user.lastName}
                </strong>
                <time className="muted small">{new Date(item.createdAt).toLocaleString('ru-RU')}</time>
              </div>
              <p>{item.body}</p>
              {(item.attachments ?? []).map((file) => (
                <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="file-link">
                  📎 {file.name}
                </a>
              ))}
              <button className="link-button" type="button" onClick={() => setReplyTo(item.id)}>
                Ответить
              </button>

              {item.replies.length ? (
                <div className="stack" style={{ marginLeft: 16 }}>
                  {item.replies.map((reply) => (
                    <article key={reply.id} className="community-message">
                      <div className="community-message-meta">
                        <strong>
                          {reply.user.firstName} {reply.user.lastName}
                        </strong>
                        <time className="muted small">{new Date(reply.createdAt).toLocaleString('ru-RU')}</time>
                      </div>
                      <p>{reply.body}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {(comments.data ?? []).length === 0 && !comments.isLoading ? <p className="muted">Комментариев пока нет.</p> : null}
        </div>

        <form
          className="stack"
          style={{ marginTop: 10 }}
          onSubmit={(event) => {
            event.preventDefault()
            if (comment.trim().length === 0) return
            addComment.mutate()
          }}
        >
          {replyTo ? (
            <div className="muted small">
              Ответ на комментарий{' '}
              <button className="link-button" type="button" onClick={() => setReplyTo(null)}>
                отменить
              </button>
            </div>
          ) : null}
          <textarea
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Комментарий к уроку"
            aria-label="Комментарий к уроку"
          />
          <button className="button button-small" type="submit" disabled={addComment.isPending}>
            Отправить комментарий
          </button>
        </form>
      </section>

      <section>
        <h3>Вопросы по уроку</h3>
        <div className="stack">
          {(questions.data ?? []).map((item) => (
            <article key={item.id} className="notice">
              <div className="row-between">
                <strong>{item.title}</strong>
                <span className="badge">{item.status === 'ANSWERED' ? 'есть ответ' : 'ожидает ответа'}</span>
              </div>
              <p>{item.body}</p>
              <span className="muted small">
                {item.student.firstName} {item.student.lastName} · {new Date(item.createdAt).toLocaleString('ru-RU')}
              </span>
              {item.answer ? (
                <div className="block block-note">
                  <strong>Ответ наставника</strong>
                  <p>{item.answer}</p>
                </div>
              ) : null}
              {canAnswer && !item.answer ? (
                <form
                  className="stack"
                  style={{ marginTop: 8 }}
                  onSubmit={(event) => {
                    event.preventDefault()
                    const answer = (answerDraft[item.id] ?? '').trim()
                    if (answer.length < 3) return
                    answerQuestion.mutate({ id: item.id, answer })
                  }}
                >
                  <textarea
                    rows={2}
                    value={answerDraft[item.id] ?? ''}
                    onChange={(event) => setAnswerDraft({ ...answerDraft, [item.id]: event.target.value })}
                    placeholder="Ответить ученику"
                    aria-label={`Ответ на вопрос ${item.title}`}
                  />
                  <button className="button button-small" type="submit" disabled={answerQuestion.isPending}>
                    Ответить
                  </button>
                </form>
              ) : null}
            </article>
          ))}
          {(questions.data ?? []).length === 0 && !questions.isLoading ? <p className="muted">Вопросов пока нет.</p> : null}
        </div>

        {session?.role === 'STUDENT' ? (
          <form
            className="stack"
            style={{ marginTop: 10 }}
            onSubmit={(event) => {
              event.preventDefault()
              if (questionTitle.trim().length < 3 || questionBody.trim().length < 3) return
              askQuestion.mutate()
            }}
          >
            <input
              value={questionTitle}
              onChange={(event) => setQuestionTitle(event.target.value)}
              placeholder="Тема вопроса"
              aria-label="Тема вопроса"
            />
            <textarea
              rows={2}
              value={questionBody}
              onChange={(event) => setQuestionBody(event.target.value)}
              placeholder="Опишите, что осталось непонятным"
              aria-label="Вопрос по уроку"
            />
            <button className="button button-small" type="submit" disabled={askQuestion.isPending}>
              Задать вопрос наставнику
            </button>
          </form>
        ) : null}
      </section>
    </div>
  )
}
