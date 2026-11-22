import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type TeacherEarning } from '../../api/finance'
import { money, todayInput, toIso } from './format'

function TeacherRow({ teacher, from, to }: { teacher: TeacherEarning; from: string; to: string }) {
  const queryClient = useQueryClient()
  const [rate, setRate] = useState(String(teacher.lessonRateKgs))
  const [notice, setNotice] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => financeApi.updateTeacherRate(teacher.userId, Number(rate)),
    onSuccess: () => {
      setNotice('Ставка сохранена')
      void queryClient.invalidateQueries({ queryKey: ['finance-teacher-earnings', from, to] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  return (
    <tr>
      <td>
        <strong>{teacher.name}</strong>
        <div className="muted small">{teacher.email}</div>
        <div className="muted small">{teacher.specialization ?? '—'}</div>
      </td>
      <td>{teacher.lessons}</td>
      <td>
        <input type="number" min={0} value={rate} onChange={(event) => setRate(event.target.value)} style={{ maxWidth: 130 }} />
        {notice ? <div className="small muted">{notice}</div> : null}
      </td>
      <td className="amount-positive">{money(teacher.earnedKgs)}</td>
      <td>
        <button className="button button-small" type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          Сохранить
        </button>
      </td>
    </tr>
  )
}

export function TeachersTab() {
  const [period, setPeriod] = useState({ from: todayInput(-30), to: todayInput(1) })
  const earnings = useQuery({
    queryKey: ['finance-teacher-earnings', period.from, period.to],
    queryFn: () => financeApi.teacherEarnings({ from: toIso(period.from), to: toIso(period.to) }),
  })

  return (
    <div className="stack">
      <p className="muted">
        Заработок считается по фиксированной ставке за проведённое занятие. Это не полноценная зарплатная система:
        выплаты, налоги и удержания ведутся вне ITadis.
      </p>

      <div className="filters">
        <label className="field">
          <span>С даты</span>
          <input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
        </label>
        <label className="field">
          <span>По дату</span>
          <input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
        </label>
        {earnings.data ? (
          <span className="muted">
            Проведено занятий: {earnings.data.totals.lessons} · начислено {money(earnings.data.totals.earnedKgs)}
          </span>
        ) : null}
      </div>

      {earnings.error ? <div className="alert alert-error">{errorMessage(earnings.error)}</div> : null}
      {earnings.isLoading ? <div className="state">Считаем заработок…</div> : null}

      {earnings.data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Наставник</th>
                <th>Занятий</th>
                <th>Ставка, KGS</th>
                <th>Начислено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {earnings.data.items.map((teacher) => (
                <TeacherRow key={teacher.userId} teacher={teacher} from={period.from} to={period.to} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
