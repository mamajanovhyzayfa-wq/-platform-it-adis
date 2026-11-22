import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { certificateApi, type Certificate } from '../api/certificates'
import { errorMessage } from '../api/client'

const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(value))

export function MyCertificatesPage() {
  const certificates = useQuery({ queryKey: ['my-certificates'], queryFn: certificateApi.my })
  const [notice, setNotice] = useState<string | null>(null)

  const open = async (certificate: Certificate) => {
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
      if (!win) return
      win.document.open()
      win.document.write(html)
      win.document.close()
    } catch (error) {
      win?.close()
      setNotice(errorMessage(error))
    }
  }

  const download = async (certificate: Certificate) => {
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

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Мои сертификаты</h1>
          <p className="muted">Документы, которые выдал администратор. Скачайте файл или откройте для печати.</p>
        </div>
      </header>

      {notice ? <div className="alert">{notice}</div> : null}
      {certificates.isLoading ? <div className="state">Загрузка сертификатов…</div> : null}
      {certificates.error ? <div className="alert alert-error">{errorMessage(certificates.error)}</div> : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Сертификат</th>
              <th>Курс</th>
              <th>Дата выдачи</th>
              <th>Код проверки</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(certificates.data ?? []).map((certificate) => (
              <tr key={certificate.id}>
                <td>
                  <strong>{certificate.number}</strong>
                  {certificate.fileName ? <div className="muted small">{certificate.fileName}</div> : null}
                </td>
                <td>{certificate.course.title}</td>
                <td className="small">{formatDate(certificate.issuedAt)}</td>
                <td>
                  <code className="small">{certificate.verificationCode}</code>
                </td>
                <td>
                  <span className={`badge badge-${certificate.status === 'ISSUED' ? 'approved' : 'rejected'}`}>
                    {certificate.status === 'ISSUED' ? 'Действителен' : 'Отозван'}
                  </span>
                  {certificate.revokeReason ? <div className="muted small">{certificate.revokeReason}</div> : null}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="button button-ghost button-small" type="button" onClick={() => void open(certificate)}>
                      Открыть
                    </button>
                    {certificate.fileUrl ? (
                      <button className="button button-ghost button-small" type="button" onClick={() => void download(certificate)}>
                        Скачать
                      </button>
                    ) : null}
                    <a className="button button-ghost button-small" href={`/verify/${certificate.verificationCode}`} target="_blank" rel="noreferrer">
                      Проверить
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(certificates.data ?? []).length === 0 && !certificates.isLoading ? <div className="state">Сертификатов пока нет.</div> : null}
    </div>
  )
}
