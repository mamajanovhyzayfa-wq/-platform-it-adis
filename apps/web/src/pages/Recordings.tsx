import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { schedulingApi, type Recording } from '../api/scheduling'
import { errorMessage } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

const transferLabels: Record<string, string> = {
  PENDING: 'Ожидает переноса',
  DOWNLOADING: 'Переносится в ITadis',
  IN_PROGRESS: 'Переносится в ITadis',
  STORED: 'Сохранена в ITadis',
  FAILED: 'Ошибка переноса',
  DELETED: 'Удалена по окончании курса',
}

/** Записи занятий доступны наставнику и ученикам группы до окончания курса. */
export function RecordingsPage() {
  const queryClient = useQueryClient()
  const recordings = useQuery({ queryKey: ['recordings'], queryFn: schedulingApi.recordings })
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const retry = useMutation({
    mutationFn: (id: string) => schedulingApi.retryTransfer(id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось повторить перенос')),
  })

  useEffect(() => () => {
    if (playing) URL.revokeObjectURL(playing.url)
  }, [playing])

  const open = async (recording: Recording) => {
    setError(null)
    try {
      const blob = await schedulingApi.recordingFile(recording.id)
      const url = URL.createObjectURL(blob)
      setPlaying((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return { id: recording.id, url }
      })
    } catch (openError) {
      setError(errorMessage(openError, 'Запись ещё не готова или срок хранения истёк'))
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Записи занятий" subtitle="Сначала запись хранится у LiveDigital, затем переносится в файловое хранилище ITadis." />
      {error ? <div className="alert alert-error">{error}</div> : null}
      {playing ? (
        <Section title="Просмотр записи" action={<button className="button button-ghost button-small" type="button" onClick={() => setPlaying(null)}>Закрыть</button>}>
          <video className="recording-player" src={playing.url} controls autoPlay playsInline />
        </Section>
      ) : null}

      <Section title="Доступные записи" subtitle="Доступ проверяется по вашей роли и группе; ссылка не работает без авторизации">
        {recordings.isLoading ? <p className="muted">Загрузка…</p> : null}
        {recordings.data?.length === 0 ? <Empty>Записей пока нет.</Empty> : null}
        <ul className="list">
          {recordings.data?.map((recording) => (
            <li key={recording.id}>
              <div>
                <strong>{recording.schedule.title}</strong>
                <p className="muted small">
                  {recording.schedule.course.title} · {formatDateTime(recording.startedAt)}
                  {recording.durationSeconds ? ` · ${Math.round(recording.durationSeconds / 60)} мин` : ''}
                </p>
                <p className="muted small">
                  {transferLabels[recording.transferStatus] ?? recording.transferStatus}
                  {recording.attempts ? ` · попыток: ${recording.attempts}` : ''}
                  {recording.available ? '' : ' · недоступна'}
                </p>
                {recording.error ? <p className="alert alert-error small">{recording.error}</p> : null}
              </div>
              <div className="row-actions">
                {recording.available ? (
                  <button className="button button-small" type="button" onClick={() => void open(recording)}>Смотреть</button>
                ) : null}
                {recording.transferStatus === 'FAILED' ? (
                  <button className="button button-ghost button-small" type="button" onClick={() => retry.mutate(recording.id)}>Повторить перенос</button>
                ) : null}
                <Link className="button button-ghost button-small" to={`/lesson/${recording.schedule.id}`}>Занятие</Link>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
