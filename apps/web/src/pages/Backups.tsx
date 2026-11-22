import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../api/client'
import { accessApi } from '../api/access'
import {
  backupsApi,
  type BackupKind,
  type BackupRun,
  type BackupSettingsInput,
  type BranchBackupSettings,
  type BackupStatus,
  type RestoreRequest,
  type RestoreStatus,
} from '../api/backups'
import { Empty, PageHeader, Section, StatCard, formatDateTime } from '../components/ui'

const runStatusLabels: Record<BackupStatus, string> = {
  RUNNING: 'Выполняется',
  SUCCEEDED: 'Успешно',
  FAILED: 'Ошибка',
}

const runStatusTone: Record<BackupStatus, string> = {
  RUNNING: 'badge-scheduled',
  SUCCEEDED: 'badge-ok',
  FAILED: 'badge-failed',
}

const restoreStatusLabels: Record<RestoreStatus, string> = {
  DETECTED: 'Обнаружено',
  CHECKED: 'Проверено',
  PLANNED: 'Спланировано',
  AWAITING_APPROVAL: 'Ждёт подтверждения',
  APPROVED: 'Подтверждено',
  RUNNING: 'Восстанавливается',
  VERIFIED: 'Завершено',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменено',
}

const restoreStatusTone: Record<RestoreStatus, string> = {
  DETECTED: 'badge-new',
  CHECKED: 'badge-new',
  PLANNED: 'badge-new',
  AWAITING_APPROVAL: 'badge-warning',
  APPROVED: 'badge-approved',
  RUNNING: 'badge-scheduled',
  VERIFIED: 'badge-ok',
  FAILED: 'badge-failed',
  CANCELLED: 'badge-muted',
}

const kindLabels: Record<BackupKind, string> = {
  DATABASE: 'База данных',
  FILES: 'Файлы',
}

function formatBytes(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (value < 1024) return `${value} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 12)}…` : '—'
}

function settingsFrom(branch: BranchBackupSettings): Required<BackupSettingsInput> {
  return {
    backupEnabled: branch.backupEnabled,
    backupFrequencyHours: branch.backupFrequencyHours,
    backupRetentionDays: branch.backupRetentionDays,
    backupIncludeFiles: branch.backupIncludeFiles,
    fileMaxSizeMb: branch.fileMaxSizeMb,
    fileQuotaMb: branch.fileQuotaMb,
  }
}

export function BackupsPage() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedRestoreId, setSelectedRestoreId] = useState<string | null>(null)

  const overview = useQuery({ queryKey: ['backup-overview'], queryFn: backupsApi.overview })
  const runs = useQuery({ queryKey: ['backup-runs'], queryFn: backupsApi.runs })
  const restores = useQuery({ queryKey: ['backup-restores'], queryFn: backupsApi.restores })

  const branch = overview.data?.branches[0] ?? null
  const branchesLoaded = overview.isSuccess && overview.data.branches.length === 0

  const [settings, setSettings] = useState<Required<BackupSettingsInput>>({
    backupEnabled: true,
    backupFrequencyHours: 24,
    backupRetentionDays: 30,
    backupIncludeFiles: true,
    fileMaxSizeMb: 50,
    fileQuotaMb: 1024,
  })

  useEffect(() => {
    if (branch) setSettings(settingsFrom(branch))
  }, [branch])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['backup-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['backup-runs'] })
    void queryClient.invalidateQueries({ queryKey: ['backup-restores'] })
  }

  const runBackup = useMutation({
    mutationFn: (kind: BackupKind) => backupsApi.run(kind),
    onSuccess: (result) => {
      setActionError(null)
      setNotice(
        'kind' in result
          ? `Запущено резервное копирование: ${kindLabels[result.kind]}`
          : 'Копирование уже выполняется, дождитесь завершения',
      )
      invalidate()
    },
    onError: (error) => {
      setNotice(null)
      setActionError(errorMessage(error, 'Не удалось запустить резервное копирование'))
    },
  })

  const verifyRun = useMutation({
    mutationFn: (id: string) => backupsApi.verify(id),
    onSuccess: (run) => {
      setActionError(null)
      setNotice(
        run.status === 'SUCCEEDED'
          ? 'Копия проверена: контрольная сумма совпадает'
          : 'Проверка копии завершилась ошибкой',
      )
      invalidate()
    },
    onError: (error) => setActionError(errorMessage(error, 'Не удалось проверить копию')),
  })

  const saveSettings = useMutation({
    mutationFn: () => {
      if (!branch) throw new Error('Филиал не определён')
      return backupsApi.updateSettings(branch.id, settings)
    },
    onSuccess: () => {
      setActionError(null)
      setNotice('Настройки резервного копирования сохранены')
      invalidate()
    },
    onError: (error) => setActionError(errorMessage(error, 'Не удалось сохранить настройки')),
  })

  const restoreList = restores.data ?? []
  const successfulDatabaseBackups = (runs.data ?? []).filter(
    (run) => run.kind === 'DATABASE' && run.status === 'SUCCEEDED',
  )
  const successfulFilesBackups = (runs.data ?? []).filter(
    (run) => run.kind === 'FILES' && run.status === 'SUCCEEDED',
  )
  const pendingRestores = restoreList.filter((item) =>
    ['DETECTED', 'CHECKED', 'PLANNED', 'AWAITING_APPROVAL', 'APPROVED'].includes(item.status),
  )
  const selectedRestore = restoreList.find((item) => item.id === selectedRestoreId) ?? null

  return (
    <div className="stack">
      <PageHeader
        title="Резервное копирование"
        subtitle="Копии базы и файлов филиала, проверка целостности и пошаговое восстановление с подтверждением ответственного."
        actions={
          <div className="row-actions">
            <button
              className="button"
              type="button"
              disabled={!branch || runBackup.isPending}
              onClick={() => runBackup.mutate('DATABASE')}
            >
              {runBackup.isPending && runBackup.variables === 'DATABASE' ? 'Запускаем…' : 'Копия БД'}
            </button>
            <button
              className="button button-ghost"
              type="button"
              disabled={!branch || runBackup.isPending}
              onClick={() => runBackup.mutate('FILES')}
            >
              {runBackup.isPending && runBackup.variables === 'FILES' ? 'Запускаем…' : 'Копия файлов'}
            </button>
          </div>
        }
      />

      {notice ? <div className="alert">{notice}</div> : null}
      {actionError ? <div className="alert alert-error">{actionError}</div> : null}
      {overview.error ? <div className="alert alert-error">{errorMessage(overview.error)}</div> : null}
      {runs.error ? <div className="alert alert-error">{errorMessage(runs.error)}</div> : null}
      {restores.error ? <div className="alert alert-error">{errorMessage(restores.error)}</div> : null}

      {branchesLoaded ? <Empty>Филиал не зарегистрирован в управляющей базе — резервное копирование недоступно</Empty> : null}

      {overview.isLoading ? <div className="state">Загрузка состояния резервного копирования…</div> : null}

      {branch ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Хранилище"
              value={overview.data?.storageDriver ?? '—'}
              hint={`Каталог: ${overview.data?.backup.directory ?? '—'}`}
              icon="folder"
            />
            <StatCard
              label="Последняя копия"
              value={branch.lastBackupAt ? formatDateTime(branch.lastBackupAt) : 'Ещё не создавалась'}
              hint={branch.lastBackupStatus ? runStatusLabels[branch.lastBackupStatus] : 'Нет данных'}
              tone={branch.lastBackupStatus === 'FAILED' ? 'danger' : 'primary'}
              icon="check"
            />
            <StatCard
              label="Расписание"
              value={branch.backupEnabled ? `Каждые ${branch.backupFrequencyHours} ч` : 'Отключено'}
              hint={`Хранение ${branch.backupRetentionDays} дн. · файлы ${branch.backupIncludeFiles ? 'включены' : 'выключены'}`}
              tone={branch.backupEnabled ? 'success' : 'muted'}
              icon="calendar"
            />
            <StatCard
              label="Восстановления"
              value={pendingRestores.length}
              hint="Ожидают подтверждения или выполнения"
              tone={pendingRestores.length > 0 ? 'warning' : 'muted'}
              icon="shield"
            />
          </div>

          <Section
            title="История копий"
            subtitle="Проверка пересчитывает SHA-256 и структуру архива. Хранятся последние 100 запусков."
          >
            {runs.isLoading ? <p className="muted">Загрузка копий…</p> : null}
            {runs.data && runs.data.length === 0 ? <Empty>Резервных копий пока нет</Empty> : null}
            {runs.data && runs.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Начата</th>
                      <th>Тип</th>
                      <th>Статус</th>
                      <th>Размер</th>
                      <th>SHA-256</th>
                      <th>Проверена</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.data.map((run) => (
                      <tr key={run.id}>
                        <td className="small">{formatDateTime(run.startedAt)}</td>
                        <td>{kindLabels[run.kind]}</td>
                        <td>
                          <span className={`badge ${runStatusTone[run.status]}`}>
                            {runStatusLabels[run.status]}
                          </span>
                          {run.error ? <div className="muted small">{run.error}</div> : null}
                        </td>
                        <td>{formatBytes(run.sizeBytes)}</td>
                        <td className="small">{shortHash(run.sha256)}</td>
                        <td className="small">{run.verifiedAt ? formatDateTime(run.verifiedAt) : '—'}</td>
                        <td>
                          {run.status === 'SUCCEEDED' ? (
                            <button
                              className="button button-ghost button-small"
                              type="button"
                              disabled={verifyRun.isPending}
                              onClick={() => verifyRun.mutate(run.id)}
                            >
                              Проверить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <Section
            title="Настройки филиала"
            subtitle="Расписание автоматических копий и лимиты файлового хранилища. Значения применяются к текущему филиалу."
          >
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault()
                saveSettings.mutate()
              }}
            >
              <div className="form-grid">
                <label className="field">
                  <span>Автоматические копии</span>
                  <select
                    value={settings.backupEnabled ? 'on' : 'off'}
                    onChange={(event) =>
                      setSettings({ ...settings, backupEnabled: event.target.value === 'on' })
                    }
                  >
                    <option value="on">Включены</option>
                    <option value="off">Выключены</option>
                  </select>
                </label>

                <label className="field">
                  <span>Частота, часов</span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={settings.backupFrequencyHours}
                    onChange={(event) =>
                      setSettings({ ...settings, backupFrequencyHours: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="field">
                  <span>Хранение, дней</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={settings.backupRetentionDays}
                    onChange={(event) =>
                      setSettings({ ...settings, backupRetentionDays: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="field">
                  <span>Копировать файлы</span>
                  <select
                    value={settings.backupIncludeFiles ? 'on' : 'off'}
                    onChange={(event) =>
                      setSettings({ ...settings, backupIncludeFiles: event.target.value === 'on' })
                    }
                  >
                    <option value="on">Да</option>
                    <option value="off">Нет</option>
                  </select>
                </label>

                <label className="field">
                  <span>Лимит файла, МБ</span>
                  <input
                    type="number"
                    min={1}
                    max={512}
                    value={settings.fileMaxSizeMb}
                    onChange={(event) =>
                      setSettings({ ...settings, fileMaxSizeMb: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="field">
                  <span>Квота филиала, МБ</span>
                  <input
                    type="number"
                    min={1}
                    max={1048576}
                    value={settings.fileQuotaMb}
                    onChange={(event) =>
                      setSettings({ ...settings, fileQuotaMb: Number(event.target.value) })
                    }
                  />
                </label>
              </div>

              <div className="row-actions">
                <button className="button" type="submit" disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? 'Сохраняем…' : 'Сохранить настройки'}
                </button>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => setSettings(settingsFrom(branch))}
                >
                  Сбросить
                </button>
              </div>
            </form>
          </Section>

          <Section
            title="Восстановление"
            subtitle="Восстановление не запускается автоматически: сначала создаётся заявка, затем ответственный подтверждает её паролем и точной фразой."
          >
            {pendingRestores.length === 0 && restoreList.length === 0 ? (
              <p className="muted small">
                Заявок нет. Выберите успешную копию БД, чтобы подготовить восстановление.
              </p>
            ) : null}

            {successfulDatabaseBackups.length === 0 ? (
              <p className="muted small">Нет успешных копий базы данных — сначала создайте копию.</p>
            ) : (
              <RestoreCreateForm
                branch={branch}
                databaseBackups={successfulDatabaseBackups}
                filesBackups={successfulFilesBackups}
                onCreated={() => {
                  setActionError(null)
                  setNotice('Заявка на восстановление создана и ждёт подтверждения')
                  invalidate()
                }}
                onError={(message) => setActionError(message)}
              />
            )}

            {restoreList.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Создана</th>
                      <th>Копия</th>
                      <th>Причина</th>
                      <th>Статус</th>
                      <th>Запросил</th>
                      <th>План</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {restoreList.map((request) => (
                      <tr key={request.id}>
                        <td className="small">{formatDateTime(request.detectedAt)}</td>
                        <td className="small">
                          {request.backup ? kindLabels[request.backup.kind] : '—'}
                          <div className="muted small">
                            {request.backup ? formatDateTime(request.backup.startedAt) : ''}
                          </div>
                        </td>
                        <td className="small">{request.reason ?? '—'}</td>
                        <td>
                          <span className={`badge ${restoreStatusTone[request.status]}`}>
                            {restoreStatusLabels[request.status]}
                          </span>
                          {request.error ? <div className="muted small">{request.error}</div> : null}
                        </td>
                        <td className="small">{request.requestedBy}</td>
                        <td>
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={() => setSelectedRestoreId(request.id)}
                          >
                            Открыть
                          </button>
                        </td>
                        <td>
                          <RestoreActions
                            request={request}
                            onDone={(message) => {
                              setActionError(null)
                              setNotice(message)
                              invalidate()
                            }}
                            onError={(message) => setActionError(message)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {selectedRestore ? (
              <div className="card stack" style={{ marginTop: 16 }}>
                <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                  <h3>Заявка {selectedRestore.id.slice(0, 8)}</h3>
                  <button className="button button-ghost button-small" type="button" onClick={() => setSelectedRestoreId(null)}>
                    Закрыть
                  </button>
                </div>
                <p className="small">
                  <strong>Статус:</strong> {restoreStatusLabels[selectedRestore.status]}
                  {' · '}
                  <strong>Запросил:</strong> {selectedRestore.requestedBy}
                  {selectedRestore.approvedBy ? <> {' · '}<strong>Подтвердил:</strong> {selectedRestore.approvedBy}</> : null}
                </p>
                {selectedRestore.error ? <div className="alert alert-error">{selectedRestore.error}</div> : null}
                {selectedRestore.plan?.warning ? (
                  <div className="alert alert-warning">{selectedRestore.plan.warning}</div>
                ) : null}
                {selectedRestore.plan?.steps?.length ? (
                  <>
                    <h4>План восстановления</h4>
                    <ol className="small">
                      {selectedRestore.plan.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </>
                ) : null}
                {selectedRestore.plan?.checks ? (
                  <details>
                    <summary className="small">Проверенные копии и SHA-256</summary>
                    <pre className="small">{JSON.stringify(selectedRestore.plan.checks, null, 2)}</pre>
                  </details>
                ) : null}
                {selectedRestore.report?.steps?.length ? (
                  <>
                    <h4>Отчёт о результате</h4>
                    <ul className="small">
                      {selectedRestore.report.steps.map((step) => (
                        <li key={step.key}>
                          <strong>{step.key}</strong>: {step.status}
                          {step.detail ? ` — ${step.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                    {selectedRestore.report.checks ? (
                      <p className="muted small">
                        БД: {selectedRestore.report.checks.database ?? '—'} · пользователей:{' '}
                        {selectedRestore.report.checks.users ?? '—'} · курсов:{' '}
                        {selectedRestore.report.checks.courses ?? '—'} · файлов:{' '}
                        {selectedRestore.report.checks.restoredFiles ?? '—'}
                        {selectedRestore.report.checks.expectedFiles !== null &&
                        selectedRestore.report.checks.expectedFiles !== undefined
                          ? ` из ${selectedRestore.report.checks.expectedFiles}`
                          : ''}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </Section>
        </>
      ) : null}
    </div>
  )
}

function RestoreCreateForm({
  branch,
  databaseBackups,
  filesBackups,
  onCreated,
  onError,
}: {
  branch: BranchBackupSettings
  databaseBackups: BackupRun[]
  filesBackups: BackupRun[]
  onCreated: () => void
  onError: (message: string) => void
}) {
  const [backupId, setBackupId] = useState(databaseBackups[0]?.id ?? '')
  const [filesBackupId, setFilesBackupId] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!databaseBackups.some((run) => run.id === backupId)) {
      setBackupId(databaseBackups[0]?.id ?? '')
    }
  }, [backupId, databaseBackups])

  const create = useMutation({
    mutationFn: () => {
      if (!backupId) throw new Error('Выберите копию базы данных')
      return backupsApi.createRestore({
        backupId,
        ...(filesBackupId ? { filesBackupId } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
    },
    onSuccess: () => {
      setReason('')
      setFilesBackupId('')
      onCreated()
    },
    onError: (error) => onError(errorMessage(error, 'Не удалось создать заявку на восстановление')),
  })

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Копия базы данных</span>
          <select value={backupId} onChange={(event) => setBackupId(event.target.value)}>
            {databaseBackups.map((run) => (
              <option key={run.id} value={run.id}>
                {formatDateTime(run.startedAt)} · {formatBytes(run.sizeBytes)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Копия файлов (необязательно)</span>
          <select value={filesBackupId} onChange={(event) => setFilesBackupId(event.target.value)}>
            <option value="">Не восстанавливать файлы</option>
            {filesBackups.map((run) => (
              <option key={run.id} value={run.id}>
                {formatDateTime(run.startedAt)} · {formatBytes(run.sizeBytes)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Причина восстановления</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={`Например: повреждение данных в филиале ${branch.slug}`}
        />
      </label>

      <div className="alert alert-warning">
        Восстановление перезаписывает текущие данные филиала. Перед подтверждением проверьте выбранную копию
        и время её создания.
      </div>

      <button className="button" type="submit" disabled={create.isPending || !backupId}>
        {create.isPending ? 'Создаём заявку…' : 'Подготовить восстановление'}
      </button>
    </form>
  )
}

function RestoreActions({
  request,
  onDone,
  onError,
}: {
  request: RestoreRequest
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [confirm, setConfirm] = useState(false)
  const slug = request.plan?.branch?.slug ?? request.branch?.slug ?? ''
  const expectedPhrase = slug ? `RESTORE ${slug}` : 'RESTORE <slug>'

  const verifyIdentity = async () => {
    if (!password) throw new Error('Введите пароль для подтверждения действия')
    await accessApi.stepUp(password)
  }

  const approve = useMutation({
    mutationFn: async () => {
      await verifyIdentity()
      return backupsApi.approveRestore(request.id, phrase)
    },
    onSuccess: () => {
      setPassword('')
      onDone('Заявка подтверждена. Теперь можно запустить восстановление.')
    },
    onError: (error) => onError(errorMessage(error, 'Не удалось подтвердить заявку')),
  })

  const execute = useMutation({
    mutationFn: async () => {
      if (!confirm) throw new Error('Отметьте подтверждение восстановления')
      await verifyIdentity()
      return backupsApi.executeRestore(request.id)
    },
    onSuccess: () => {
      setPassword('')
      setConfirm(false)
      onDone('Восстановление запущено. Следите за статусом в таблице.')
    },
    onError: (error) => onError(errorMessage(error, 'Не удалось запустить восстановление')),
  })

  const cancel = useMutation({
    mutationFn: () => backupsApi.cancelRestore(request.id),
    onSuccess: () => onDone('Заявка отменена'),
    onError: (error) => onError(errorMessage(error, 'Не удалось отменить заявку')),
  })

  if (!['AWAITING_APPROVAL', 'APPROVED'].includes(request.status)) {
    return <span className="muted small">—</span>
  }

  return (
    <div className="stack" style={{ minWidth: 240 }}>
      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>

      {request.status === 'AWAITING_APPROVAL' ? (
        <>
          <label className="field">
            <span>Фраза {expectedPhrase}</span>
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={expectedPhrase}
            />
          </label>
          <button
            className="button button-small"
            type="button"
            disabled={approve.isPending || !password || phrase.trim() !== expectedPhrase}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? 'Подтверждаем…' : 'Подтвердить'}
          </button>
        </>
      ) : (
        <>
          <label className="switch">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            <span>Понимаю, что данные будут перезаписаны</span>
          </label>
          <button
            className="button button-small"
            type="button"
            disabled={execute.isPending || !password || !confirm}
            onClick={() => execute.mutate()}
          >
            {execute.isPending ? 'Запускаем…' : 'Восстановить'}
          </button>
        </>
      )}

      <button
        className="link-button"
        type="button"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        Отменить заявку
      </button>
    </div>
  )
}
