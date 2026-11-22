import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { certificateApi } from '../api/certificates'
import { errorMessage } from '../api/client'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value))

export function CertificateVerifyPage() {
  const { code = '' } = useParams()
  const verification = useQuery({
    queryKey: ['certificate-verify', code],
    queryFn: () => certificateApi.verify(code),
    retry: false,
    enabled: code.length > 0,
  })

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card stack" style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="brand-mark">IA</span>
          <div>
            <strong>IT Adis</strong>
            <div className="muted small">Проверка сертификата</div>
          </div>
        </div>

        {verification.isLoading ? <div className="state">Проверяем код…</div> : null}

        {verification.error ? (
          <div className="alert alert-error">
            {errorMessage(verification.error)}
            <div className="small" style={{ marginTop: 6 }}>
              Проверьте код: <strong>{code}</strong>
            </div>
          </div>
        ) : null}

        {verification.data ? (
          <>
            <div className={`alert ${verification.data.valid ? '' : 'alert-error'}`}>
              <strong>
                {verification.data.valid
                  ? 'Сертификат действителен'
                  : verification.data.status === 'REVOKED'
                    ? 'Сертификат отозван'
                    : verification.data.expired
                      ? 'Срок действия сертификата истёк'
                      : 'Сертификат недействителен'}
              </strong>
              {!verification.data.valid && verification.data.revokeReason ? (
                <div className="small" style={{ marginTop: 6 }}>
                  Причина: {verification.data.revokeReason}
                </div>
              ) : null}
            </div>

            <dl className="stack" style={{ margin: 0, gap: 8 }}>
              <div>
                <dt className="muted small">Номер</dt>
                <dd style={{ margin: 0 }}>
                  <strong>{verification.data.number}</strong>
                </dd>
              </div>
              <div>
                <dt className="muted small">Ученик</dt>
                <dd style={{ margin: 0 }}>
                  {verification.data.student.firstName} {verification.data.student.lastName}
                </dd>
              </div>
              <div>
                <dt className="muted small">Курс</dt>
                <dd style={{ margin: 0 }}>{verification.data.course.title}</dd>
              </div>
              <div>
                <dt className="muted small">Дата выдачи</dt>
                <dd style={{ margin: 0 }}>{formatDate(verification.data.issuedAt)}</dd>
              </div>
              {verification.data.expiresAt ? (
                <div>
                  <dt className="muted small">Действителен до</dt>
                  <dd style={{ margin: 0 }}>{formatDate(verification.data.expiresAt)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="muted small">Кем выдан</dt>
                <dd style={{ margin: 0 }}>{verification.data.issuedBy}</dd>
              </div>
            </dl>
            <p className="muted small" style={{ margin: 0 }}>
              Код проверки: {code.toUpperCase()}
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
