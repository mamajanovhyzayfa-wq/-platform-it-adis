import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gradingApi, type GradingScale } from '../api/assessment'
import { errorMessage } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

type BandDraft = { label: string; minPercent: number; maxPercent: number; description: string }

const emptyForm = {
  name: '',
  description: '',
  isDefault: false,
  // Пустая заготовка: конкретную шкалу задаёт образовательный центр.
  bands: [{ label: '', minPercent: 0, maxPercent: 100, description: '' }] as BandDraft[],
}

/**
 * Академическая шкала филиала. Платформа не навязывает обязательную шкалу:
 * диапазоны и подписи задаёт администратор. IT Coins здесь не участвуют.
 */
export function GradingPage() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<GradingScale | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const scales = useQuery({ queryKey: ['grading-scales'], queryFn: gradingApi.list })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['grading-scales'] })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? gradingApi.update(editing.id, form)
        : gradingApi.create(form),
    onSuccess: () => {
      setCreating(false)
      setEditing(null)
      setForm(emptyForm)
      setError(null)
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить шкалу')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => gradingApi.remove(id),
    onSuccess: refresh,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось удалить шкалу')),
  })

  const setDefault = useMutation({
    mutationFn: (id: string) => gradingApi.setDefault(id),
    onSuccess: refresh,
  })

  const startEdit = (scale: GradingScale) => {
    setEditing(scale)
    setCreating(true)
    setForm({
      name: scale.name,
      description: scale.description ?? '',
      isDefault: scale.isDefault,
      bands: scale.bands.map((band) => ({
        label: band.label,
        minPercent: band.minPercent,
        maxPercent: band.maxPercent,
        description: band.description ?? '',
      })),
    })
  }

  return (
    <div className="stack">
      <PageHeader
        title="Академическая шкала"
        subtitle="Настройка диапазонов и подписей филиала. Не связано с IT Coins."
        actions={
          <button
            className="button"
            type="button"
            onClick={() => {
              setEditing(null)
              setForm(emptyForm)
              setCreating((value) => !value)
            }}
          >
            {creating ? 'Свернуть' : 'Новая шкала'}
          </button>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {creating ? (
        <Section title={editing ? `Шкала «${editing.name}»` : 'Новая шкала'} subtitle="Диапазоны не должны пересекаться">
          <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
            <div className="form-row">
              <label className="field"><span>Название</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} /></label>
              <label className="field"><span>Описание</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            </div>
            <label className="switch">
              <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
              <span>Шкала по умолчанию</span>
            </label>

            <div className="field">
              <span>Диапазоны</span>
              {form.bands.map((band, index) => (
                <div className="row-actions" key={`band-${index}`}>
                  <input value={band.label} placeholder="Подпись (например, «Отлично»)" onChange={(event) => setForm({ ...form, bands: form.bands.map((row, rowIndex) => (rowIndex === index ? { ...row, label: event.target.value } : row)) })} />
                  <input type="number" min={0} max={100} value={band.minPercent} aria-label="Минимум, %" onChange={(event) => setForm({ ...form, bands: form.bands.map((row, rowIndex) => (rowIndex === index ? { ...row, minPercent: Number(event.target.value) } : row)) })} />
                  <span>—</span>
                  <input type="number" min={0} max={100} value={band.maxPercent} aria-label="Максимум, %" onChange={(event) => setForm({ ...form, bands: form.bands.map((row, rowIndex) => (rowIndex === index ? { ...row, maxPercent: Number(event.target.value) } : row)) })} />
                  <input value={band.description} placeholder="Пояснение" onChange={(event) => setForm({ ...form, bands: form.bands.map((row, rowIndex) => (rowIndex === index ? { ...row, description: event.target.value } : row)) })} />
                  <button className="button button-ghost button-small" type="button" onClick={() => setForm({ ...form, bands: form.bands.filter((_, rowIndex) => rowIndex !== index) })}>×</button>
                </div>
              ))}
              <button className="button button-ghost button-small" type="button" onClick={() => setForm({ ...form, bands: [...form.bands, { label: '', minPercent: 0, maxPercent: 0, description: '' }] })}>
                + диапазон
              </button>
            </div>

            <button className="button" type="submit" disabled={save.isPending}>Сохранить шкалу</button>
          </form>
        </Section>
      ) : null}

      <Section title="Шкалы филиала" subtitle="Используются в тестах, экзаменах и заданиях по выбору">
        {scales.isLoading ? <p className="muted">Загрузка…</p> : null}
        {scales.data && scales.data.length === 0 ? (
          <Empty>Шкал пока нет. Создайте первую шкалу с диапазонами, принятыми в вашем центре.</Empty>
        ) : null}
        <div className="course-table">
          {scales.data?.map((scale) => (
            <article className="course-row" key={scale.id}>
              <div className="course-row-main">
                <div className="course-row-title">
                  <strong>{scale.name}</strong>
                  {scale.isDefault ? <span className="badge badge-active">по умолчанию</span> : null}
                </div>
                {scale.description ? <p className="muted small">{scale.description}</p> : null}
                <p className="small">
                  {scale.bands.map((band) => `${band.label}: ${band.minPercent}–${band.maxPercent}%`).join(' · ')}
                </p>
                <p className="muted small">
                  Тестов: {scale.usage.tests} · экзаменов: {scale.usage.exams} · заданий: {scale.usage.homework} · обновлено {formatDateTime(scale.updatedAt)}
                </p>
              </div>
              <div className="row-actions">
                <button className="button button-ghost button-small" type="button" onClick={() => startEdit(scale)}>Изменить</button>
                {!scale.isDefault ? (
                  <button className="button button-ghost button-small" type="button" onClick={() => setDefault.mutate(scale.id)}>Сделать основной</button>
                ) : null}
                <button
                  className="button button-ghost button-small"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Удалить шкалу «${scale.name}»?`)) remove.mutate(scale.id)
                  }}
                >
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </div>
  )
}
