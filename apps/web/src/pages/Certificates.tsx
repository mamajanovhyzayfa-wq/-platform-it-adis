import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { certificateApi, type Certificate, type CertificateStatus } from '../api/certificates'
import { appUrl, errorMessage } from '../api/client'

const statusLabels: Record<CertificateStatus, string> = {
  ISSUED: 'Действителен',
  REVOKED: 'Отозван',
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(new Date(value))

export function CertificatesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CertificateStatus | ''>('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [studentSearch, setStudentSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [grade, setGrade] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const certificates = useQuery({
    queryKey: ['certificates', page, search, status],
    queryFn: () => certificateApi.list({ page, limit: 20, search, status }),
  })

  const candidates = useQuery({
    queryKey: ['certificate-candidates', studentSearch],
    queryFn: () => certificateApi.candidates(studentSearch),
    enabled: formOpen && studentSearch.trim().length >= 2,
  })

  const selectedStudent = candidates.data?.find((candidate) => candidate.id === studentId) ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['certificates'] })
  }

  const issue = useMutation({
    mutationFn: async () => {
      if (!studentId) throw new Error('Выберите ученика')
      if (!courseId) throw new Error('Выберите курс')
      const value = grade.trim() ? Number(grade) : undefined
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 100)) {
        throw new Error('Балл должен быть целым числом от 0 до 100')
      }
      if (!file) throw new Error('Загрузите готовый файл сертификата')
      const uploaded = await certificateApi.upload(file)
      return certificateApi.issue({
        studentId,
        courseId,
        ...(value !== undefined ? { grade: value } : {}),
        ...(issuedAt ? { issuedAt: new Date(issuedAt).toISOString() } : {}),
        fileUrl: uploaded.url,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.size,
      })
    },
    onSuccess: (certificate) => {
      setNotice(`Сертификат ${certificate.number} выдан и доступен ученику в разделе «Мои сертификаты».`)
      setFormOpen(false)
      setStudentId('')
      setStudentSearch('')
      setCourseId('')
      setGrade('')
      setIssuedAt('')
      setFile(null)
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const revoke = useMutation({
    mutationFn: (certificate: Certificate) => {
      const reason = window.prompt(`Причина отзыва сертификата ${certificate.number}`, '')
      if (reason === null) throw new Error('Отзыв отменён')
      if (reason.trim().length < 5) throw new Error('Причина должна быть не короче 5 символов')
      return certificateApi.revoke(certificate.id, reason.trim())
    },
    onSuccess: () => {
      setNotice('Сертификат отозван, ученик уведомлён')
      invalidate()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const openDocument = async (certificate: Certificate) => {
    const win = window.open('', '_blank')
    try {
      if (certificate.hasFile) {
        const blob = await certificateApi.file(certificate.id)
        const url = URL.createObjectURL(blob)
        if (!win) {
          URL.revokeObjectURL(url)
          setNotice('Разрешите всплывающие окна, чтобы открыть сертификат')
          return
        }
        win.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        return
      }
      const html = await certificateApi.html(certificate.id)
      if (!win) {
        setNotice('Разрешите всплывающие окна, чтобы открыть сертификат')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
    } catch (error) {
      win?.close()
      setNotice(errorMessage(error))
    }
  }

  const downloadDocument = async (certificate: Certificate) => {
    if (!certificate.fileUrl) return
    try {
      const blob = await certificateApi.file(certificate.id, true)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = certificate.fileName ?? `${certificate.number}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const copyLink = async (certificate: Certificate) => {
    const link = `${window.location.origin}${appUrl(`/verify/${certificate.verificationCode}`)}`
    try {
      await navigator.clipboard.writeText(link)
      setNotice(`Ссылка на проверку скопирована: ${link}`)
    } catch {
      setNotice(`Ссылка на проверку: ${link}`)
    }
  }

  const totalPages = certificates.data?.pages ?? 1

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Сертификаты</h1>
          <p className="muted">Выдача сертификатов об окончании курса, печать и проверка по коду.</p>
        </div>
      </header>

      {notice ? <div className="alert">{notice}</div> : null}

      <div className="filters">
        <input
          placeholder="Поиск: номер, ученик, курс, код"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as CertificateStatus | '')
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          <option value="ISSUED">Действителен</option>
          <option value="REVOKED">Отозван</option>
        </select>
        <button className="button" type="button" onClick={() => setFormOpen(!formOpen)}>
          {formOpen ? 'Скрыть форму' : 'Выдать сертификат'}
        </button>
      </div>

      {formOpen ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault()
            issue.mutate()
          }}
        >
          <h2>Новый сертификат</h2>
          <div className="form-grid">
            <label className="field">
              <span>Ученик (поиск)</span>
              <input
                value={studentSearch}
                onChange={(event) => {
                  setStudentSearch(event.target.value)
                  setStudentId('')
                }}
                placeholder="Имя или email"
              />
            </label>
            <label className="field">
              <span>Найденный ученик</span>
              <select
                value={studentId}
                onChange={(event) => {
                  setStudentId(event.target.value)
                  setCourseId('')
                }}
              >
                <option value="">— выберите —</option>
                {(candidates.data ?? []).map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} · {student.email}
                  </option>
                ))}
              </select>
              {candidates.isFetched && studentSearch.trim().length >= 2 && (candidates.data ?? []).length === 0 ? (
                <span className="muted small">Нет учеников с курсами без сертификата</span>
              ) : null}
            </label>
            <label className="field">
              <span>Курс</span>
              <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                <option value="">— выберите —</option>
                {(selectedStudent?.courses ?? []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Итоговый балл (необязательно)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                placeholder="0–100"
              />
            </label>
            <label className="field">
              <span>Дата выдачи</span>
              <input type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
            </label>
            <label className="field">
              <span>Готовый файл (PDF или изображение)</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>
          </div>
          <p className="muted small">
            Сертификат выдаётся только вручную администратором: загрузите готовый файл и назначьте ученику. Файл хранится
            в защищённом хранилище платформы, ученик получает уведомление.
          </p>
          <div className="row-actions">
            <button className="button" type="submit" disabled={issue.isPending}>
              {issue.isPending ? 'Выдаём…' : 'Выдать и уведомить'}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {certificates.isLoading ? <div className="state">Загрузка сертификатов…</div> : null}
      {certificates.error ? <div className="alert alert-error">{errorMessage(certificates.error)}</div> : null}

      {certificates.data ? (
        <>
          <div className="row-between">
            <h2>История выдачи</h2>
            <span className="muted small">Всего: {certificates.data.total}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Сертификат</th>
                  <th>Ученик</th>
                  <th>Курс</th>
                  <th>Выдан</th>
                  <th>Балл</th>
                  <th>Код проверки</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {certificates.data.items.map((certificate) => (
                  <tr key={certificate.id}>
                    <td>
                      <strong>{certificate.number}</strong>
                      <div className="muted small">{certificate.issuedBy}</div>
                      {certificate.fileName ? <div className="muted small">{certificate.fileName}</div> : null}
                    </td>
                    <td>
                      {certificate.student.name}
                      <div className="muted small">{certificate.student.email}</div>
                    </td>
                    <td>{certificate.course.title}</td>
                    <td className="small">{formatDate(certificate.issuedAt)}</td>
                    <td>{certificate.grade ?? '—'}</td>
                    <td>
                      <code className="small">{certificate.verificationCode}</code>
                    </td>
                    <td>
                      <span className={`badge badge-${certificate.status === 'ISSUED' ? 'approved' : 'rejected'}`}>
                        {statusLabels[certificate.status]}
                      </span>
                      {certificate.revokedAt ? (
                        <div className="muted small">Отозван {formatDate(certificate.revokedAt)}</div>
                      ) : null}
                      {certificate.revokeReason ? (
                        <div className="muted small">{certificate.revokeReason}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void openDocument(certificate)}
                        >
                          {certificate.fileUrl ? 'Открыть' : 'Печать'}
                        </button>
                        {certificate.fileUrl ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={() => void downloadDocument(certificate)}
                          >
                            Скачать
                          </button>
                        ) : null}
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void copyLink(certificate)}
                        >
                          Ссылка
                        </button>
                        {certificate.status === 'ISSUED' ? (
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(certificate)}
                          >
                            Отозвать
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {certificates.data.items.length === 0 ? <div className="state">Сертификатов пока нет.</div> : null}

          <div className="pagination">
            <button className="button button-ghost" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Назад
            </button>
            <span className="muted">
              Страница {page} из {totalPages} · всего {certificates.data.total}
            </span>
            <button
              className="button button-ghost"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Вперёд
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
