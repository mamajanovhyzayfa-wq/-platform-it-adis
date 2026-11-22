import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../api/access'
import { errorMessage, getSession } from '../api/client'
import {
  backupsApi,
  filesApi,
  type BackupRun,
  type FileAccess,
  type FileCategory,
  type RestoreRequest,
  type StorageFileItem,
} from '../api/files'

const categoryLabels: Record<FileCategory, string> = {
  DOCUMENT: 'Документ',
  IMAGE: 'Изображение',
  AUDIO: 'Аудио',
  VIDEO: 'Видео',
  PDF: 'PDF',
  PRESENTATION: 'Презентация',
  ARCHIVE: 'Архив',
  OTHER: 'Другое',
}

const accessLabels: Record<FileAccess, string> = {
  PRIVATE: 'Только я',
  STAFF: 'Сотрудники',
  BRANCH: 'Весь филиал',
}

const restoreLabels: Record<RestoreRequest['status'], string> = {
  DETECTED: 'Обнаружено',
  CHECKED: 'Копии проверены',
  PLANNED: 'План готов',
  AWAITING_APPROVAL: 'Ждёт подтверждения',
  APPROVED: 'Подтверждено',
  RUNNING: 'Восстановление…',
  VERIFIED: 'Проверено',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменено',
}

function formatBytes(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('ru-RU') : '—'
}

/**
 * Файловое облако филиала и административный экран хранения.
 * Администратор видит настройки, копии и пошаговое восстановление; остальные —
 * только те файлы, которые разрешены их ролью/владельцем.
 */
export function FilesPage() {
  const isAdmin = getSession()?.role === 'ADMIN'
  const [tab, setTab] = useState<'library' | 'admin'>('library')

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Файлы филиала</h1>
          <p className="muted">
            Облачное пространство документов, изображений, аудио, видео и архивов. Доступ проверяется
            на сервере, антивирусная проверка — до публикации.
          </p>
        </div>
        {isAdmin ? (
          <div className="row gap">
            <button className={tab === 'library' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('library')}>
              Библиотека
            </button>
            <button className={tab === 'admin' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('admin')}>
              Хранение и копии
            </button>
          </div>
        ) : null}
      </header>

      {tab === 'library' ? <LibraryTab /> : <StorageAdminTab />}
    </div>
  )
}

function LibraryTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FileCategory | ''>('')
  const [access, setAccess] = useState<FileAccess | ''>('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<StorageFileItem | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [uploadAccess, setUploadAccess] = useState<FileAccess>('BRANCH')

  const storage = useQuery({ queryKey: ['files-storage'], queryFn: filesApi.storage })
  const categories = useQuery({ queryKey: ['files-categories'], queryFn: filesApi.categories })
  const list = useQuery({
    queryKey: ['files', search, category, access, sort, page],
    queryFn: () =>
      filesApi.list({
        search: search.trim() || undefined,
        category: category || undefined,
        access: access || undefined,
        sort,
        page,
        limit: 24,
      }),
  })
  const history = useQuery({
    queryKey: ['files-history', selected?.id],
    queryFn: () => filesApi.history(selected!.id),
    enabled: Boolean(selected),
  })

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Выберите файл')
      return filesApi.upload(file, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        access: uploadAccess,
        tags: tags.trim() || undefined,
      })
    },
    onSuccess: (created) => {
      setMessage(`Файл «${created.title}» загружен и проверен.`)
      setError('')
      setFile(null)
      setTitle('')
      setDescription('')
      setTags('')
      void queryClient.invalidateQueries({ queryKey: ['files'] })
      void queryClient.invalidateQueries({ queryKey: ['files-storage'] })
      void queryClient.invalidateQueries({ queryKey: ['files-categories'] })
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const download = useMutation({
    mutationFn: filesApi.download,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files'] })
      if (selected) void queryClient.invalidateQueries({ queryKey: ['files-history', selected.id] })
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => filesApi.remove(id),
    onSuccess: () => {
      setMessage('Файл перемещён в удалённые; история операций сохранена.')
      setSelected(null)
      void queryClient.invalidateQueries({ queryKey: ['files'] })
      void queryClient.invalidateQueries({ queryKey: ['files-storage'] })
      void queryClient.invalidateQueries({ queryKey: ['files-categories'] })
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const usedPercent = storage.data ? Math.min(100, (storage.data.usedBytes / (storage.data.quotaMb * 1024 * 1024)) * 100) : 0

  return (
    <div className="stack">
      {message ? <div className="alert alert-success">{message}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="grid-2">
        <section className="card stack">
          <h2>Загрузить файл</h2>
          <p className="muted small">
            Лимит одного файла — {storage.data?.maxFileSizeMb ?? '…'} МБ. Проверяются MIME-тип, размер,
            SHA-256 и сигнатуры исполняемых файлов.
          </p>
          <label>
            Файл
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label>
            Название (необязательно)
            <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Например, методичка по математике" />
          </label>
          <label>
            Описание
            <textarea rows={2} value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            Теги через запятую
            <input value={tags} maxLength={500} onChange={(event) => setTags(event.target.value)} placeholder="математика, 9 класс" />
          </label>
          <label>
            Кто видит
            <select value={uploadAccess} onChange={(event) => setUploadAccess(event.target.value as FileAccess)}>
              <option value="BRANCH">Весь филиал</option>
              <option value="STAFF">Только сотрудники</option>
              <option value="PRIVATE">Только я</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? 'Проверяем и загружаем…' : 'Загрузить'}
          </button>
        </section>

        <section className="card stack">
          <h2>Хранилище</h2>
          <p className="muted small">Отдельное пространство филиала, ключи объектов изолированы префиксом.</p>
          <dl className="kv">
            <dt>Драйвер</dt>
            <dd>{storage.data?.driver === 's3' ? 'S3-совместимое облако' : 'Локальный диск сервера'}</dd>
            <dt>Использовано</dt>
            <dd>
              {formatBytes(storage.data?.usedBytes ?? null)} из {storage.data?.quotaMb ?? '…'} МБ
            </dd>
            <dt>Файлов</dt>
            <dd>{storage.data?.files ?? '…'}</dd>
            <dt>Префикс</dt>
            <dd className="mono small">{storage.data?.prefix ?? '—'}</dd>
          </dl>
          <progress max={100} value={usedPercent} aria-label="Использование квоты" />
          <div className="row gap wrap">
            {(categories.data ?? []).map((item) => (
              <button
                key={item.category}
                className={category === item.category ? 'badge badge-active' : 'badge'}
                type="button"
                onClick={() => {
                  setCategory(category === item.category ? '' : item.category)
                  setPage(1)
                }}
              >
                {categoryLabels[item.category]} · {item.count}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="filters">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder="Поиск по названию, описанию и тегам"
          aria-label="Поиск файлов"
        />
        <select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as FileCategory | '')
            setPage(1)
          }}
        >
          <option value="">Все категории</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={access} onChange={(event) => setAccess(event.target.value as FileAccess | '')}>
          <option value="">Все права</option>
          {Object.entries(accessLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
          <option value="name">По названию</option>
          <option value="size">По размеру</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Файл</th>
              <th>Категория</th>
              <th>Размер</th>
              <th>Доступ</th>
              <th>Владелец</th>
              <th>Загружен</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((item) => (
              <tr key={item.id} className={selected?.id === item.id ? 'row-active' : undefined} onClick={() => setSelected(item)}>
                <td>
                  <strong>{item.title}</strong>
                  <div className="muted small">{item.originalName} · {item.scanStatus}</div>
                </td>
                <td><span className="badge">{categoryLabels[item.category]}</span></td>
                <td>{formatBytes(item.sizeBytes)}</td>
                <td>{accessLabels[item.access]}</td>
                <td>{item.owner?.name ?? '—'}</td>
                <td className="small">{formatDate(item.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-small" type="button" onClick={(event) => { event.stopPropagation(); download.mutate(item) }}>
                      Скачать
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!list.isLoading && !(list.data?.items ?? []).length ? (
              <tr><td colSpan={7} className="muted">Файлы не найдены.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="row gap between">
        <span className="muted small">Всего: {list.data?.total ?? 0}</span>
        <div className="row gap">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Назад</button>
          <span className="small">Страница {list.data?.page ?? page} из {list.data?.pages ?? 1}</span>
          <button className="btn btn-small" disabled={page >= (list.data?.pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Вперёд</button>
        </div>
      </div>

      {selected ? (
        <section className="card stack">
          <div className="row gap between">
            <div>
              <h2>{selected.title}</h2>
              <p className="muted small">
                {selected.mimeType} · {formatBytes(selected.sizeBytes)} · {selected.scanStatus} · скачиваний: {selected.downloadCount}
              </p>
            </div>
            <button className="btn" onClick={() => setSelected(null)}>Закрыть</button>
          </div>
          {selected.description ? <p>{selected.description}</p> : null}
          {selected.tags.length ? <p className="muted small">Теги: {selected.tags.join(', ')}</p> : null}
          <div className="row gap">
            <button className="btn btn-primary" onClick={() => download.mutate(selected)}>Скачать</button>
            <button
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Удалить «${selected.title}»? История операций сохранится.`)) remove.mutate(selected.id)
              }}
            >
              Удалить
            </button>
          </div>
          <h3>История операций</h3>
          {history.isLoading ? <p className="muted">Загрузка…</p> : null}
          <ul className="timeline">
            {(history.data ?? []).map((item) => (
              <li key={item.id}>
                {formatDate(item.createdAt)} — {item.action} · {item.user ? `${item.user.firstName} ${item.user.lastName}` : 'система'}
                {item.ip ? ` · ${item.ip}` : ''}
              </li>
            ))}
            {!history.isLoading && !(history.data ?? []).length ? <li className="muted">История пуста.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function StorageAdminTab() {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [reason, setReason] = useState('')
  const [dbBackupId, setDbBackupId] = useState('')
  const [filesBackupId, setFilesBackupId] = useState('')
  const [selectedRestore, setSelectedRestore] = useState<RestoreRequest | null>(null)

  const overview = useQuery({ queryKey: ['backups-overview'], queryFn: backupsApi.overview })
  const runs = useQuery({ queryKey: ['backups-runs'], queryFn: backupsApi.runs })
  const restores = useQuery({ queryKey: ['backups-restores'], queryFn: backupsApi.restores })

  const branch = overview.data?.branches[0]
  const succeededDb = useMemo(
    () => (runs.data ?? []).filter((run) => run.kind === 'DATABASE' && run.status === 'SUCCEEDED'),
    [runs.data],
  )
  const succeededFiles = useMemo(
    () => (runs.data ?? []).filter((run) => run.kind === 'FILES' && run.status === 'SUCCEEDED'),
    [runs.data],
  )

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['backups-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['backups-runs'] })
    void queryClient.invalidateQueries({ queryKey: ['backups-restores'] })
  }

  const runBackup = useMutation({
    mutationFn: (kind: 'DATABASE' | 'FILES') => backupsApi.run(kind),
    onSuccess: (run: BackupRun) => {
      setMessage(
        run.status === 'SUCCEEDED'
          ? `Копия ${run.kind === 'DATABASE' ? 'БД' : 'файлов'} создана и проверена.`
          : `Копия создана со статусом ${run.status}: ${run.error ?? ''}`,
      )
      setError('')
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const verify = useMutation({
    mutationFn: (id: string) => backupsApi.verify(id),
    onSuccess: (run) => {
      setMessage(run.status === 'SUCCEEDED' ? 'Целостность копии подтверждена.' : `Проверка не прошла: ${run.error ?? ''}`)
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const settings = useMutation({
    mutationFn: (patch: Parameters<typeof backupsApi.updateSettings>[1]) =>
      backupsApi.updateSettings(branch!.id, patch),
    onSuccess: () => {
      setMessage('Настройки хранения сохранены.')
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const createRestore = useMutation({
    mutationFn: () =>
      backupsApi.createRestore({
        backupId: dbBackupId,
        filesBackupId: filesBackupId || undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (request) => {
      setSelectedRestore(request)
      setMessage('Копии проверены, план подготовлен. Восстановление ждёт подтверждения ответственного лица.')
      setError('')
      setReason('')
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const approve = useMutation({
    mutationFn: async (request: RestoreRequest) => {
      if (!password.trim()) throw new Error('Введите пароль для подтверждения')
      await accessApi.stepUp(password)
      return backupsApi.approve(request.id, phrase)
    },
    onSuccess: (request) => {
      setSelectedRestore(request)
      setMessage('Заявка подтверждена. Запуск восстановления — отдельное действие.')
      setError('')
      setPassword('')
      setPhrase('')
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const execute = useMutation({
    mutationFn: async (request: RestoreRequest) => {
      if (!password.trim()) throw new Error('Введите пароль для подтверждения')
      if (!window.confirm('Восстановление перезапишет текущие данные филиала. Продолжить?')) {
        throw new Error('Восстановление отменено')
      }
      await accessApi.stepUp(password)
      return backupsApi.execute(request.id)
    },
    onSuccess: (request) => {
      setSelectedRestore(request)
      setMessage('Восстановление завершено, целостность проверена.')
      setError('')
      setPassword('')
      refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })

  if (overview.isLoading) return <div className="state">Загрузка настроек хранения…</div>
  if (overview.error) return <div className="alert alert-error">{errorMessage(overview.error)}</div>
  if (!branch) return <div className="alert alert-error">Филиал не найден.</div>

  return (
    <div className="stack">
      {message ? <div className="alert alert-success">{message}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="card stack">
        <h2>Параметры филиала «{branch.name}»</h2>
        <p className="muted small">
          Драйвер файлов: {overview.data?.storageDriver === 's3' ? 'S3' : 'локальный'} · копии: {overview.data?.backup.directory} · команда: {overview.data?.backup.command}
        </p>
        <form
          className="grid-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            settings.mutate({
              backupEnabled: form.get('backupEnabled') === 'on',
              backupFrequencyHours: Number(form.get('backupFrequencyHours')),
              backupRetentionDays: Number(form.get('backupRetentionDays')),
              backupIncludeFiles: form.get('backupIncludeFiles') === 'on',
              fileMaxSizeMb: Number(form.get('fileMaxSizeMb')),
              fileQuotaMb: Number(form.get('fileQuotaMb')),
            })
          }}
        >
          <label className="checkbox-row">
            <input type="checkbox" name="backupEnabled" defaultChecked={branch.backupEnabled} key={`enabled-${branch.id}`} />
            Автоматическое резервное копирование
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="backupIncludeFiles" defaultChecked={branch.backupIncludeFiles} key={`files-${branch.id}`} />
            Копировать файлы вместе с БД
          </label>
          <label>
            Частота, часов
            <input type="number" name="backupFrequencyHours" min={1} max={168} defaultValue={branch.backupFrequencyHours} />
          </label>
          <label>
            Срок хранения, дней
            <input type="number" name="backupRetentionDays" min={1} max={365} defaultValue={branch.backupRetentionDays} />
          </label>
          <label>
            Лимит файла, МБ
            <input type="number" name="fileMaxSizeMb" min={1} max={1024} defaultValue={branch.fileMaxSizeMb} />
          </label>
          <label>
            Квота филиала, МБ
            <input type="number" name="fileQuotaMb" min={1} max={1048576} defaultValue={branch.fileQuotaMb} />
          </label>
          <button className="btn btn-primary" disabled={settings.isPending} type="submit">
            Сохранить настройки
          </button>
        </form>
        <p className="muted small">
          БД копируется ежедневно по умолчанию. Последняя копия: {formatDate(branch.lastBackupAt)} · статус: {branch.lastBackupStatus ?? 'нет'}.
        </p>
      </section>

      <section className="card stack">
        <div className="row gap between">
          <h2>Резервные копии</h2>
          <div className="row gap">
            <button className="btn" disabled={runBackup.isPending} onClick={() => runBackup.mutate('DATABASE')}>
              {runBackup.isPending ? 'Выполняется…' : 'Копия БД'}
            </button>
            <button className="btn" disabled={runBackup.isPending} onClick={() => runBackup.mutate('FILES')}>
              Копия файлов
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Начата</th><th>Тип</th><th>Статус</th><th>Размер</th><th>Проверена</th><th>Ошибка</th><th /></tr></thead>
            <tbody>
              {(runs.data ?? []).map((run) => (
                <tr key={run.id}>
                  <td className="small">{formatDate(run.startedAt)}</td>
                  <td>{run.kind === 'DATABASE' ? 'БД' : 'Файлы'}</td>
                  <td><span className="badge">{run.status}</span></td>
                  <td>{formatBytes(run.sizeBytes)}</td>
                  <td className="small">{formatDate(run.verifiedAt)}</td>
                  <td className="small">{run.error ?? '—'}</td>
                  <td>
                    <button className="btn btn-small" disabled={run.status !== 'SUCCEEDED' || verify.isPending} onClick={() => verify.mutate(run.id)}>
                      Проверить
                    </button>
                  </td>
                </tr>
              ))}
              {!(runs.data ?? []).length ? <tr><td colSpan={7} className="muted">Копий пока нет.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>План восстановления</h2>
        <p className="muted small">
          Шаги: обнаружение → проверка копий → план → подтверждение ответственного → восстановление → проверка → отчёт.
          Восстановление не запускается автоматически.
        </p>
        <div className="grid-2">
          <label>
            Копия БД
            <select value={dbBackupId} onChange={(event) => setDbBackupId(event.target.value)}>
              <option value="">Выберите копию</option>
              {succeededDb.map((run) => (
                <option key={run.id} value={run.id}>{formatDate(run.startedAt)} · {formatBytes(run.sizeBytes)}</option>
              ))}
            </select>
          </label>
          <label>
            Копия файлов (необязательно)
            <select value={filesBackupId} onChange={(event) => setFilesBackupId(event.target.value)}>
              <option value="">Не восстанавливать файлы</option>
              {succeededFiles.map((run) => (
                <option key={run.id} value={run.id}>{formatDate(run.startedAt)} · {formatBytes(run.sizeBytes)}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Причина/обнаруженная проблема
          <textarea rows={2} value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button className="btn" disabled={!dbBackupId || createRestore.isPending} onClick={() => createRestore.mutate()}>
          Проверить копии и подготовить план
        </button>
      </section>

      <section className="card stack">
        <h2>Заявки на восстановление</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Создана</th><th>Статус</th><th>Причина</th><th>Запросил</th><th>Подтвердил</th><th /></tr></thead>
            <tbody>
              {(restores.data ?? []).map((request) => (
                <tr key={request.id} onClick={() => setSelectedRestore(request)} className={selectedRestore?.id === request.id ? 'row-active' : undefined}>
                  <td className="small">{formatDate(request.detectedAt)}</td>
                  <td><span className="badge">{restoreLabels[request.status]}</span></td>
                  <td className="small">{request.reason ?? '—'}</td>
                  <td className="small">{request.requestedBy}</td>
                  <td className="small">{request.approvedBy ?? '—'}</td>
                  <td><button className="btn btn-small" onClick={(event) => { event.stopPropagation(); setSelectedRestore(request) }}>Открыть</button></td>
                </tr>
              ))}
              {!(restores.data ?? []).length ? <tr><td colSpan={6} className="muted">Заявок нет.</td></tr> : null}
            </tbody>
          </table>
        </div>

        {selectedRestore ? (
          <div className="card stack">
            <div className="row gap between">
              <h3>Заявка {selectedRestore.id.slice(0, 8)}</h3>
              <button className="btn btn-small" onClick={() => setSelectedRestore(null)}>Закрыть</button>
            </div>
            <p><strong>Статус:</strong> {restoreLabels[selectedRestore.status]}</p>
            {selectedRestore.plan?.warning ? <div className="alert alert-warning">{selectedRestore.plan.warning}</div> : null}
            {selectedRestore.plan?.steps ? (
              <ol className="small">
                {selectedRestore.plan.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            ) : null}
            {selectedRestore.error ? <div className="alert alert-error">{selectedRestore.error}</div> : null}
            {selectedRestore.report?.steps ? (
              <ul className="timeline">
                {selectedRestore.report.steps.map((step) => (
                  <li key={step.key}>{step.key}: {step.status}{step.detail ? ` — ${step.detail}` : ''}</li>
                ))}
              </ul>
            ) : null}

            {selectedRestore.status === 'AWAITING_APPROVAL' ? (
              <>
                <label>
                  Пароль для повторного подтверждения
                  <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <label>
                  Введите фразу <span className="mono">{`RESTORE ${branch.slug}`}</span>
                  <input value={phrase} onChange={(event) => setPhrase(event.target.value)} />
                </label>
                <button className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(selectedRestore)}>
                  Подтвердить ответственным лицом
                </button>
              </>
            ) : null}

            {selectedRestore.status === 'APPROVED' ? (
              <>
                <label>
                  Пароль для повторного подтверждения
                  <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <button className="btn btn-danger" disabled={execute.isPending} onClick={() => execute.mutate(selectedRestore)}>
                  {execute.isPending ? 'Восстанавливаем…' : 'Запустить восстановление'}
                </button>
              </>
            ) : null}

            {!['RUNNING', 'VERIFIED', 'FAILED', 'CANCELLED'].includes(selectedRestore.status) ? (
              <button
                className="btn"
                onClick={() => {
                  void backupsApi.cancel(selectedRestore.id).then((request) => {
                    setSelectedRestore(request)
                    refresh()
                  })
                }}
              >
                Отменить заявку
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
